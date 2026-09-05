# CLI Slimming (PR 3 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the CLI out of `src/index.ts` into `src/cli/*` with one exit path (`main(argv): Promise<number>`), typed `CliError`s classified at the source, `config print-default` / `config validate` subcommands, `manifest` derived from the Commander program, `healthcheck` and `--prompt` driven by the resolved config, plus the small fixes owed from the PR 2 reviews.

**Architecture:** `src/index.ts` becomes a three-line bin that calls `main`. `src/cli/program.ts` builds the Commander program and owns `main`; every action returns an exit code through an `onExit` callback instead of calling `process.exit`. `src/cli/run.ts` is the default command (config resolution, flags, `runDigest`, output, state). `src/cli/commands.ts` holds `manifest`, `healthcheck`, `config print-default`, `config validate`. `src/cli/adapters.ts` holds the `fetchText` / `translate` adapters and `src/cli/errors.ts` the `CliError` type plus fetch-error classification. The pipeline (`src/pipeline.ts`, `src/digest.ts`, …) is untouched except for one `titleSimilarity` fix. CLI tests move to `test/cli/*.test.ts` on a shared harness in `test/helpers/cli.ts`.

**Tech Stack:** Bun (runtime, `bun test`, `Bun.serve`, `Bun.spawn`), TypeScript strict, `commander` 15, `zod` 4 (via the existing `parseConfig`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-unified-config-refactor-design.md` — section 3 "CLI and errors" is the authority for this PR; section 4 gives the `src/cli/*` layout; "Staging" item 3 lists the scope. Sections 4's `pipeline/` and `output/` folders, the final `core.ts` and deleting `lib.ts` are PR 4 and intentionally absent here.

**Base:** branch `refactor/unified-pipeline` (PR #59, HEAD `a3a640a`). If #59 has merged by the time a task runs, nothing changes for the implementer; the controller rebases the branch onto `main` before opening the PR.

## Global Constraints

- Bun-only runtime: `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.serve`; `node:fs/promises` is already used in `src/state.ts` and may stay there. No build step; `bin` stays `./src/index.ts`.
- TypeScript strict; relative imports (`./x`, `../x`), never `src/x`.
- Heuristics and region knowledge live only in the config (`src/config/default.json`); no UAE constants in `src/*.ts`.
- stdout carries results only; progress, warnings and errors go to stderr (`console.error`).
- Every user-facing error says what failed, why, and what to do. Existing message texts asserted by tests are kept character for character unless a step says otherwise.
- No `process.exit` anywhere under `src/cli/`; actions return exit codes. Exit codes: 0 success; 1 for usage, config, network, timeout, or "no topic fetched".
- Translation stays opt-in (`--target-lang` + `DEEPL_AUTH_KEY`).
- Before every commit: `bun run typecheck && bun test && bun run smoke:pack` all green. Test count never drops below the previous task's count.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012vhmvw58yLQtdrK7QnxKVo
  ```
- No new dependencies.

---

### Task 0: Worktree and plan (controller)

Already done by the controller: worktree `/Users/anton/Personal/repos/uae-news-digest-cli-slimming`, branch `refactor/cli-slimming` from `refactor/unified-pipeline`; this plan committed as the first commit. Baseline at branch point: 189 tests, typecheck clean, smoke:pack exit 0.

---

### Task 1: CLI test harness and split

Pure test refactor. Behaviour of the CLI does not change; the test count stays at 189.

**Files:**
- Create: `test/helpers/cli.ts`
- Create: `test/cli/digest.test.ts` (default command + config discovery)
- Create: `test/cli/commands.test.ts` (`--version`, `--prompt`, `manifest`, `healthcheck`)
- Delete: `test/cli.test.ts`

**Interfaces:**
- Produces: `startCliHarness(): CliHarness` with `baseUrl`, `run`, `runFromCwd`, `requests()`, `reset()`, `stop()`; `tmpStateFile()`, `feedConfig(feedUrl, topicOverrides?, configOverrides?)`, `cleanupTempDirs()`, `expectExitCode()`, `formatRunResult()`; constants `CLI`, `PACKAGE_JSON`, `TEXT_GOLDEN`, `FIXTURES`, `RSS_XML`, `RSS_EMPTY`, `DEEPL_RESPONSE`, `TEST_NOW`. Later tasks add tests to `test/cli/commands.test.ts` using exactly these names.

- [ ] **Step 1: Write `test/helpers/cli.ts`**

```ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import defaultConfig from '../../src/config/default.json';

// ── Canned responses ──────────────────────────────────────────

export const TEST_NOW = new Date('2026-03-22T08:00:00Z');
const oneHourAgo = new Date(TEST_NOW.getTime() - 3_600_000).toUTCString();
const twoHoursAgo = new Date(TEST_NOW.getTime() - 7_200_000).toUTCString();

export const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>Dubai airport reopens after rain</title><link>https://news.google.com/rss/articles/dubai-airport</link><pubDate>${oneHourAgo}</pubDate><source url="https://example.com">Reuters</source></item>
  <item><title>Abu Dhabi market overview</title><pubDate>${twoHoursAgo}</pubDate><source url="https://example.com">Gulf News</source></item>
</channel></rss>`;

export const RSS_EMPTY = `<?xml version="1.0"?><rss><channel></channel></rss>`;

export const DEEPL_RESPONSE = JSON.stringify({
  translations: [
    { detected_source_language: 'EN', text: 'Flughafen Dubai öffnet nach Regen wieder' },
    { detected_source_language: 'EN', text: 'Marktübersicht Abu Dhabi' },
  ],
});

// ── Paths ─────────────────────────────────────────────────────

export const CLI = join(import.meta.dir, '..', '..', 'src', 'index.ts');
export const PACKAGE_JSON = join(import.meta.dir, '..', '..', 'package.json');
export const FIXTURES = join(import.meta.dir, '..', 'fixtures');
export const TEXT_GOLDEN = join(FIXTURES, 'cli-default-output.txt');

// ── Results and diagnostics ───────────────────────────────────

export type CapturedRequest = { method: string; path: string; body: unknown };

export type CliRunResult = {
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number | 'unknown';
  requests: CapturedRequest[];
};

const CLI_TIMEOUT_CLEANUP_MS = 1_000;

function formatRequests(requests: CapturedRequest[]): string {
  if (requests.length === 0) return '(none)';
  return requests.map((req) => {
    const body = req.body === null ? '' : ` body=${JSON.stringify(req.body)}`;
    return `${req.method} ${req.path}${body}`;
  }).join('\n');
}

export function formatRunResult(result: CliRunResult): string {
  return [
    `command: ${result.command.join(' ')}`,
    `exitCode: ${result.exitCode}`,
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
    `requests:\n${formatRequests(result.requests)}`,
  ].join('\n');
}

export function expectExitCode(result: CliRunResult, expected: number): void {
  if (result.exitCode !== expected) {
    throw new Error(`Expected exit code ${expected}\n${formatRunResult(result)}`);
  }
}

// ── Harness: mock server + CLI spawner ────────────────────────

export type CliHarness = {
  baseUrl: string;
  /** Requests the mock server has seen since the last reset(). */
  requests(): CapturedRequest[];
  reset(): void;
  stop(): void;
  /** Spawn the CLI with HOME/XDG neutralised and the test clock set; keys in `env` win. */
  run(args: string[], env?: Record<string, string>, options?: { timeoutMs?: number }): Promise<CliRunResult>;
  /** Spawn the CLI in `cwd` with the real environment plus `env` (config-discovery tests). */
  runFromCwd(args: string[], opts: { cwd: string; env?: Record<string, string> }, options?: { timeoutMs?: number }): Promise<CliRunResult>;
};

export function startCliHarness(): CliHarness {
  let history: CapturedRequest[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === 'POST' ? await req.clone().json().catch(() => null) : null;
      history.push({ method: req.method, path: url.pathname, body });

      if (url.pathname === '/rss') {
        return new Response(RSS_XML, { headers: { 'content-type': 'application/xml' } });
      }
      if (url.pathname === '/rss/fixture') {
        return new Response(await Bun.file(join(FIXTURES, 'sample-feed.xml')).text(), { headers: { 'content-type': 'application/xml' } });
      }
      if (url.pathname === '/rss/empty') {
        return new Response(RSS_EMPTY, { headers: { 'content-type': 'application/xml' } });
      }
      if (url.pathname === '/rss/error') {
        return new Response('Internal Server Error', { status: 500 });
      }
      if (url.pathname === '/rss/html') {
        return new Response('<!doctype html><html><body>Service unavailable</body></html>', { headers: { 'content-type': 'text/html' } });
      }
      if (url.pathname === '/translate' && req.method === 'POST') {
        return new Response(DEEPL_RESPONSE, { headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname === '/translate/error' && req.method === 'POST') {
        return new Response('DeepL unavailable', { status: 500 });
      }
      if (url.pathname === '/rss/hang') {
        return new Promise<Response>(() => {
          // Intentionally never resolves — the CLI's timeout must fire.
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  });
  const baseUrl = `http://localhost:${server.port}`;

  async function spawnCli(
    command: string[],
    spawnOptions: { cwd?: string; env: Record<string, string | undefined> },
    timeoutMs: number,
  ): Promise<CliRunResult> {
    const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', cwd: spawnOptions.cwd, env: spawnOptions.env });
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();
    let timeout: Timer | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timeout = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    const exitOrTimeout = await Promise.race([proc.exited, timedOut]);
    if (timeout) clearTimeout(timeout);

    if (exitOrTimeout === 'timeout') {
      proc.kill();
      const result = await Promise.race<CliRunResult>([
        Promise.all([stdoutPromise, stderrPromise, proc.exited]).then(([stdout, stderr, exitCode]) =>
          ({ command, stdout, stderr, exitCode, requests: [...history] })),
        new Promise<CliRunResult>((resolve) => {
          setTimeout(() => resolve({
            command,
            stdout: '<unavailable: process did not exit after kill>',
            stderr: '<unavailable: process did not exit after kill>',
            exitCode: 'unknown',
            requests: [...history],
          }), CLI_TIMEOUT_CLEANUP_MS);
        }),
      ]);
      throw new Error(`CLI command timed out after ${timeoutMs}ms\n${formatRunResult(result)}`);
    }

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return { command, stdout, stderr, exitCode: exitOrTimeout, requests: [...history] };
  }

  return {
    baseUrl,
    requests: () => [...history],
    reset: () => { history = []; },
    stop: () => server.stop(true),
    run: (args, env, options = {}) => spawnCli(
      ['bun', CLI, ...args],
      // Neutralize HOME/XDG so the user's real ~/.config/uae-news-digest/topics.json cannot bleed in via auto-detect.
      { env: { ...process.env, HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent', UAE_NEWS_DIGEST_NOW: TEST_NOW.toISOString(), ...env } },
      options.timeoutMs ?? 5_000,
    ),
    runFromCwd: (args, opts, options = {}) => spawnCli(
      ['bun', CLI, ...args],
      { cwd: opts.cwd, env: { ...process.env, ...opts.env } },
      options.timeoutMs ?? 10_000,
    ),
  };
}

// ── Temp files ────────────────────────────────────────────────

const tempDirs: string[] = [];

export function tmpStateFile(): string {
  return join(tmpdir(), `uae-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
}

/**
 * A config identical to the built-in UAE one, except the single topic fetches `feedUrl`.
 * `configOverrides` are spread over the top level (pass `{ agentPrompt: undefined }` to drop a key).
 * Returns the `--config` path; call cleanupTempDirs() in afterAll.
 */
export function feedConfig(
  feedUrl: string,
  topicOverrides: Record<string, unknown> = {},
  configOverrides: Record<string, unknown> = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-feed-'));
  tempDirs.push(dir);
  const path = join(dir, 'digest.config.json');
  writeFileSync(path, JSON.stringify({
    ...defaultConfig,
    ...configOverrides,
    topics: [{ ...defaultConfig.topics[0], feedUrl, ...topicOverrides }],
  }));
  return path;
}

export function cleanupTempDirs(): void {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  tempDirs.length = 0;
}
```

- [ ] **Step 2: Create `test/cli/digest.test.ts`**

Header:

```ts
import { describe, expect, test, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startCliHarness, tmpStateFile, feedConfig, cleanupTempDirs, expectExitCode, formatRunResult,
  CLI, TEXT_GOLDEN,
} from '../helpers/cli';

const cli = startCliHarness();
afterAll(() => { cli.stop(); cleanupTempDirs(); });
beforeEach(() => cli.reset());
```

Move these tests verbatim from `test/cli.test.ts` into a `describe('CLI digest', …)` block, replacing `run(` → `cli.run(`, `runFromCwd(` → `cli.runFromCwd(`, and `${baseUrl}` → `${cli.baseUrl}`: "CLI diagnostics include mock request history", "default text output with items", "--json produces agent-friendly envelope", "--json enriches items with importance, signals, and tier", "--dry-run does not write state file", "translation via DeepL with --target-lang", "translation failure warns and falls back to original titles", "--json includes warnings when translation falls back", "--target-lang without DEEPL_AUTH_KEY exits with error", "invalid test clock exits with error", "RSS timeout shows timeout message and exits 1", "CLI helper times out hung commands with diagnostics", "RSS network failure shows network message and exits 1", "RSS HTTP error shows message and exits 1", "HTTP 200 body that is not a feed (HTML error page) exits 1 with a parse message", "--json still prints the envelope when every topic fails, and exits 1", "one failing topic is a warning, not a failure: exit 0 and the other section still renders", "empty RSS feed shows no-news message", "state file is written when not dry-run", "state file is not written when zero items were produced (not dry-run)", "--limit caps items per topic", "heuristics from the config file drive emoji and the Important block".

Move the whole `describe('config discovery', …)` block (its `writeTopicsCwd` helper included) with the same replacements.

Delete the old imports of `defaultConfig`, `Server`, `beforeAll`; the harness owns the server now. Any test that read `requestHistory` directly uses `result.requests` (already the case) or `cli.requests()`.

- [ ] **Step 3: Create `test/cli/commands.test.ts`**

```ts
import { describe, expect, test, afterAll, beforeEach } from 'bun:test';
import { startCliHarness, cleanupTempDirs, expectExitCode, PACKAGE_JSON } from '../helpers/cli';

const cli = startCliHarness();
afterAll(() => { cli.stop(); cleanupTempDirs(); });
beforeEach(() => cli.reset());

describe('CLI commands', () => {
  // moved verbatim (with cli.run / cli.baseUrl): "--version prints version string and exits 0",
  // "manifest reports package version and bin name", "healthcheck supports deterministic RSS URL",
  // "healthcheck reports non-200 RSS URL as unhealthy"

  test('--prompt prints the filter criterion and exits 0', async () => {
    const { stdout, exitCode } = await cli.run(['--prompt']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('news filter for an expat family in the UAE');
  });
});
```

(The old `--prompt` test spawned `bun` by hand without neutralising HOME; the harness version is the replacement.)

- [ ] **Step 4: Delete `test/cli.test.ts`, run the suite**

Run: `bun test`
Expected: `189 pass`, `0 fail` — same count as before this task (23 + 4 + 1 tests moved out of one file into two; nothing added or dropped). If the count differs, a test was lost in the move: diff the `test(` names of the old file (`git show HEAD:test/cli.test.ts | grep -n "^\s*test("`) against the two new files.

Run: `bun run typecheck && bun run smoke:pack`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add test/helpers/cli.ts test/cli/digest.test.ts test/cli/commands.test.ts
git rm -q test/cli.test.ts
git commit -m "test(cli): shared harness in test/helpers/cli.ts, split e2e tests by command"
```

---

### Task 2: `CliError` and the fetch/translate adapters

**Files:**
- Create: `src/cli/errors.ts`
- Create: `src/cli/adapters.ts`
- Create: `test/unit/cli-errors.test.ts`
- Create: `test/unit/cli-adapters.test.ts`
- Modify: `src/index.ts` (delete the local `makeFetchText`, `makeTranslate`, `USER_AGENT`; import from `./cli/adapters`)

**Interfaces:**
- Produces:
  - `export type CliErrorKind = 'usage' | 'config' | 'network' | 'timeout'`
  - `export class CliError extends Error { readonly kind: CliErrorKind; constructor(kind: CliErrorKind, message: string) }`
  - `export function classifyFetchError(err: unknown, ctx: { url: string; timeoutMs: number }): CliError`
  - `export const USER_AGENT = 'Mozilla/5.0 (uae-news-digest)'`
  - `export function makeFetchText(timeoutMs: number): FetchText`
  - `export function makeTranslate(deeplAuthKey: string | undefined): Translate | undefined`
- Consumes: `FetchText`, `Translate` from `../pipeline`; `translateDeepL` from `../translate`.

- [ ] **Step 1: Write the failing unit tests**

`test/unit/cli-errors.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { CliError, classifyFetchError } from '../../src/cli/errors';

describe('CliError', () => {
  test('carries its kind and message', () => {
    const err = new CliError('usage', 'Invalid --hours: abc');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CliError');
    expect(err.kind).toBe('usage');
    expect(err.message).toBe('Invalid --hours: abc');
  });
});

describe('classifyFetchError', () => {
  const ctx = { url: 'http://localhost:1/rss', timeoutMs: 15000 };

  test('TimeoutError and AbortError become a timeout with the retry hint', () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const err = classifyFetchError(Object.assign(new Error('The operation timed out'), { name }), ctx);
      expect(err.kind).toBe('timeout');
      expect(err.message).toBe('RSS request timed out after 15000ms — retry, or pass --timeout-ms 30000');
    }
  });

  test('connection failures become a network error naming the host and the code', () => {
    const err = classifyFetchError(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }), ctx);
    expect(err.kind).toBe('network');
    expect(err.message).toBe('Unable to connect to localhost:1 — check your connection (ECONNREFUSED)');
  });

  test('falls back to the message, then to String(err), when there is no code', () => {
    expect(classifyFetchError(new Error('boom'), ctx).message).toContain('(boom)');
    expect(classifyFetchError('weird', ctx).message).toContain('(weird)');
  });

  test('an unparseable URL is echoed as-is instead of throwing', () => {
    const err = classifyFetchError(new Error('x'), { url: 'not a url', timeoutMs: 1 });
    expect(err.message).toBe('Unable to connect to not a url — check your connection (x)');
  });
});
```

`test/unit/cli-adapters.test.ts`:

```ts
import { afterAll, describe, expect, test } from 'bun:test';
import { makeFetchText, makeTranslate, USER_AGENT } from '../../src/cli/adapters';
import { CliError } from '../../src/cli/errors';

let seenUserAgent: string | null = null;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    seenUserAgent = req.headers.get('user-agent');
    if (path === '/ok') return new Response('<rss/>');
    if (path === '/error') return new Response('nope', { status: 503, statusText: 'Service Unavailable' });
    return new Promise<Response>(() => { /* hang */ });
  },
});
afterAll(() => server.stop(true));
const base = `http://localhost:${server.port}`;

async function rejection(p: Promise<unknown>): Promise<CliError> {
  try { await p; } catch (err) { return err as CliError; }
  throw new Error('expected a rejection');
}

describe('makeFetchText', () => {
  test('returns the body and sends the tool user-agent', async () => {
    expect(await makeFetchText(5_000)(`${base}/ok`)).toBe('<rss/>');
    expect(seenUserAgent).toBe(USER_AGENT);
  });

  test('non-2xx is a network CliError with the status line', async () => {
    const err = await rejection(makeFetchText(5_000)(`${base}/error`));
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe('network');
    expect(err.message).toBe('RSS fetch failed: HTTP 503 Service Unavailable');
  });

  test('a hung server is a timeout CliError after timeoutMs', async () => {
    const err = await rejection(makeFetchText(50)(`${base}/hang`));
    expect(err.kind).toBe('timeout');
    expect(err.message).toBe('RSS request timed out after 50ms — retry, or pass --timeout-ms 30000');
  });

  test('a closed port is a network CliError', async () => {
    const err = await rejection(makeFetchText(5_000)('http://localhost:1/rss'));
    expect(err.kind).toBe('network');
    expect(err.message).toStartWith('Unable to connect to localhost:1');
  });
});

describe('makeTranslate', () => {
  test('is undefined without an auth key and a function with one', () => {
    expect(makeTranslate(undefined)).toBeUndefined();
    expect(makeTranslate('')).toBeUndefined();
    expect(typeof makeTranslate('key')).toBe('function');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test test/unit/cli-errors.test.ts test/unit/cli-adapters.test.ts`
Expected: FAIL — cannot resolve `../../src/cli/errors` / `../../src/cli/adapters`.

- [ ] **Step 3: Write `src/cli/errors.ts`**

```ts
export type CliErrorKind = 'usage' | 'config' | 'network' | 'timeout';

/** A user-facing failure: the message says what failed, why, and what to do; `kind` is for tests and callers. */
export class CliError extends Error {
  readonly kind: CliErrorKind;

  constructor(kind: CliErrorKind, message: string) {
    super(message);
    this.name = 'CliError';
    this.kind = kind;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Turn a rejected fetch() into a CliError at the source, so nothing upstream matches on message text. */
export function classifyFetchError(err: unknown, ctx: { url: string; timeoutMs: number }): CliError {
  const e = err as { name?: string; code?: string; message?: string };
  if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    return new CliError('timeout', `RSS request timed out after ${ctx.timeoutMs}ms — retry, or pass --timeout-ms 30000`);
  }
  const detail = e.code ?? e.message ?? String(err);
  return new CliError('network', `Unable to connect to ${hostOf(ctx.url)} — check your connection (${detail})`);
}
```

- [ ] **Step 4: Write `src/cli/adapters.ts`**

```ts
import type { FetchText, Translate } from '../pipeline';
import { translateDeepL } from '../translate';
import { CliError, classifyFetchError } from './errors';

export const USER_AGENT = 'Mozilla/5.0 (uae-news-digest)';

/** fetch with a timeout and human-readable failures; one call per topic feed. */
export function makeFetchText(timeoutMs: number): FetchText {
  return async (url) => {
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw classifyFetchError(err, { url, timeoutMs });
    }
    if (!response.ok) {
      throw new CliError('network', `RSS fetch failed: HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  };
}

export function makeTranslate(deeplAuthKey: string | undefined): Translate | undefined {
  if (!deeplAuthKey) return undefined;
  return (texts, targetLang) => translateDeepL(texts, deeplAuthKey, targetLang);
}
```

- [ ] **Step 5: Point `src/index.ts` at the adapters**

Delete `USER_AGENT`, `makeFetchText`, `makeTranslate` from `src/index.ts`; add `import { makeFetchText, makeTranslate } from './cli/adapters';` and drop the now-unused `translateDeepL` and `FetchText`/`Translate` imports. Edit in place (`sed`/Edit) — do not recreate the file, it must keep mode 100755.

- [ ] **Step 6: Verify**

Run: `bun run typecheck && bun test && bun run smoke:pack`
Expected: typecheck clean; `199 pass` (189 + 5 in cli-errors + 5 in cli-adapters), 0 fail; smoke exit 0. `git ls-files -s src/index.ts` shows `100755`.

- [ ] **Step 7: Commit**

```bash
git add src/cli/errors.ts src/cli/adapters.ts src/index.ts test/unit/cli-errors.test.ts test/unit/cli-adapters.test.ts
git commit -m "feat(cli): CliError with source-level fetch classification, adapters module"
```

---

### Task 3: Small fixes owed from the PR 2 reviews

Four independent one-file edits, batched. Each has its own test.

**Files:**
- Modify: `src/state.ts` (`writeSeenKeys` creates the directory), `test/unit/state.test.ts`
- Modify: `src/meta.ts` (JSON import, `DESCRIPTION`), create `test/unit/meta.test.ts`
- Modify: `src/index.ts` (`--limit` must be an integer; `DESCRIPTION` from meta; drop the `mkdir`), `test/cli/digest.test.ts`
- Modify: `src/scoring.ts` (`titleSimilarity` on empty word sets), `test/unit/scoring.test.ts`

**Interfaces:**
- Produces: `export const DESCRIPTION: string` in `src/meta.ts`; `validatePositiveInteger(name, raw): number` in `src/index.ts` (moved to `src/cli/run.ts` in Task 4).

- [ ] **Step 1: Failing tests**

Append to `test/unit/state.test.ts` inside the existing `describe`:

```ts
  test('writeSeenKeys creates missing parent directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'state-nested-'));
    const file = join(dir, 'a', 'b', 'seen.txt');
    await writeSeenKeys(file, new Set(['k1', 'k2']));
    expect(await readSeenKeys(file)).toEqual(new Set(['k1', 'k2']));
    rmSync(dir, { recursive: true, force: true });
  });
```

(Import `mkdtempSync`, `rmSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path` if the file does not already.)

Create `test/unit/meta.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BIN_NAME, DESCRIPTION, TOOL_ID, VERSION } from '../../src/meta';

test('meta mirrors package.json without reading it at runtime', async () => {
  const pkg = await Bun.file(join(import.meta.dir, '..', '..', 'package.json')).json();
  expect(TOOL_ID).toBe('uae-news-digest');
  expect(VERSION).toBe(pkg.version);
  expect(BIN_NAME).toBe(Object.keys(pkg.bin)[0]);
  expect(DESCRIPTION).toBe(pkg.description);
});
```

Append to `describe('CLI digest', …)` in `test/cli/digest.test.ts`:

```ts
  test('--limit rejects non-integers with a usage error', async () => {
    const result = await cli.run(['--config', feedConfig(`${cli.baseUrl}/rss`), '--state-file', tmpStateFile(), '--limit', '2.5', '--dry-run']);
    expectExitCode(result, 1);
    expect(result.stderr).toContain('Invalid --limit: 2.5 — expected a positive integer');
    expect(result.requests).toEqual([]);
  });
```

In `test/unit/scoring.test.ts` replace the test `'empty titles return 1'` with:

```ts
  test('titles with no words never match (empty sets are not "identical")', () => {
    expect(titleSimilarity('', '', dedupe)).toBe(0);
    // Non-Latin titles reduce to empty word sets under ASCII extraction; they must not collapse into one item.
    expect(titleSimilarity('الإمارات تطلق قمراً', 'ارتفاع أسعار النفط', dedupe)).toBe(0);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test test/unit/state.test.ts test/unit/meta.test.ts test/unit/scoring.test.ts test/cli/digest.test.ts`
Expected: 4 failures (ENOENT on the nested write; `DESCRIPTION` not exported; `--limit 2.5` currently accepted; similarity returns 1).

- [ ] **Step 3: `src/state.ts`**

Add `mkdir` to the `node:fs/promises` import and, as the first line of `writeSeenKeys`:

```ts
  const dir = dirname(stateFile);
  await mkdir(dir, { recursive: true });
```

(Replace the existing `const dir = dirname(stateFile);` line — do not declare it twice.)

- [ ] **Step 4: `src/meta.ts`**

```ts
import packageJson from '../package.json';

export const TOOL_ID = 'uae-news-digest';
export const VERSION: string = packageJson.version;
export const BIN_NAME: string = Object.keys(packageJson.bin ?? {})[0] ?? TOOL_ID;
export const DESCRIPTION: string = packageJson.description;
```

`bun run build` (tsc with `rootDir: src`) has been verified to accept this import; no tsconfig change.

- [ ] **Step 5: `src/index.ts`**

- Replace `const DESCRIPTION = '...'` with `import { BIN_NAME, DESCRIPTION, TOOL_ID, VERSION } from './meta';` (extend the existing meta import).
- Add after `validatePositiveNumber`:

```ts
function validatePositiveInteger(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid --${name}: ${raw} — expected a positive integer`);
  }
  return value;
}
```

- Use it for `--limit`: `const limitOverride = options.limit === undefined ? undefined : validatePositiveInteger('limit', options.limit);`
- Delete the line `await Bun.$\`mkdir -p ${dirname(options.stateFile)}\`.quiet();` and the now-unused `import { dirname } from 'node:path';`.

- [ ] **Step 6: `src/scoring.ts`**

Replace the two empty-set lines in `titleSimilarity` with one:

```ts
  if (wa.size === 0 || wb.size === 0) return 0;
```

- [ ] **Step 7: Verify**

Run: `bun run typecheck && bun test && bun run smoke:pack`
Expected: all green; test count = previous + 3 (state, meta, --limit; the scoring test was replaced). `git ls-files -s src/index.ts` → `100755`.

- [ ] **Step 8: Commit**

```bash
git add src/state.ts src/meta.ts src/index.ts src/scoring.ts test/unit/state.test.ts test/unit/meta.test.ts test/unit/scoring.test.ts test/cli/digest.test.ts
git commit -m "fix: state dir auto-created, package.json imported, integer --limit, no dedupe on wordless titles"
```

---

### Task 4: `src/cli/program.ts`, `run.ts`, `commands.ts`; `index.ts` becomes the bin

Mechanical move: every observable behaviour (messages, exit codes, outputs) stays identical; the only change is that no code under `src/cli/` calls `process.exit`. Task 5 changes behaviour.

**Files:**
- Create: `src/cli/program.ts`, `src/cli/run.ts`, `src/cli/commands.ts`
- Modify: `src/index.ts` (→ 3 lines)
- Create: `test/unit/cli-main.test.ts`

**Interfaces:**
- Produces:
  - `run.ts`: `export type CliEnv = Record<string, string | undefined>`; `export type RunFlags = { json: boolean; config?: string; stateFile: string; hours: string | number; limit?: string | number; timeoutMs: string | number; targetLang?: string; dryRun: boolean; prompt: boolean }`; `export async function resolveConfig(explicit: string | undefined, env: CliEnv, cwd: string): Promise<{ config: DigestConfig; source: string }>`; `export async function runDefault(flags: RunFlags, env: CliEnv, cwd: string): Promise<number>`.
  - `commands.ts`: `export function manifest(program: Command): number`; `export async function healthcheck(opts: { rssUrl?: string }, env: CliEnv, cwd: string): Promise<number>`.
  - `program.ts`: `export function buildProgram(onExit: (code: number) => void, env: CliEnv, cwd: string): Command`; `export async function main(argv: string[], env?: CliEnv, cwd?: string): Promise<number>`.
- Consumes: Task 2's adapters and `CliError`; Task 3's `DESCRIPTION`, `validatePositiveInteger`.

- [ ] **Step 1: Failing test for `main`**

`test/unit/cli-main.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { main } from '../../src/cli/program';

const NOISE = ['bun', 'index.ts'];

describe('main', () => {
  test('--version and --help exit 0 through the single exit path', async () => {
    expect(await main([...NOISE, '--version'])).toBe(0);
    expect(await main([...NOISE, '--help'])).toBe(0);
  });

  test('an unknown option exits 1 (commander prints the usage error)', async () => {
    expect(await main([...NOISE, '--bogus'])).toBe(1);
  });

  test('a usage error from the default command exits 1 with its message on stderr', async () => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
    try {
      expect(await main([...NOISE, '--hours', 'abc', '--config', '/nonexistent/config.json'], { HOME: '/nonexistent' }, '/')).toBe(1);
    } finally {
      console.error = original;
    }
    expect(lines.join('\n')).toContain('Invalid --hours: abc');
  });
});
```

(`--help`/`--version` write to stdout; that is acceptable noise in a unit test.)

- [ ] **Step 2: Run it to see it fail**

Run: `bun test test/unit/cli-main.test.ts`
Expected: FAIL — cannot resolve `../../src/cli/program`.

- [ ] **Step 3: Write `src/cli/run.ts`**

```ts
import { readSeenKeys, writeSeenKeys } from '../state';
import { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from '../config/load';
import type { DigestConfig } from '../config/schema';
import { runDigest } from '../pipeline';
import { renderText } from '../render';
import { toJson } from '../json';
import { TOOL_ID, VERSION } from '../meta';
import { makeFetchText, makeTranslate } from './adapters';
import { CliError } from './errors';

export type CliEnv = Record<string, string | undefined>;

/** Commander's option object for the default command (camelCased flag names). */
export type RunFlags = {
  json: boolean;
  config?: string;
  stateFile: string;
  hours: string | number;
  limit?: string | number;
  timeoutMs: string | number;
  targetLang?: string;
  dryRun: boolean;
  prompt: boolean;
};

export function validatePositiveNumber(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError('usage', `Invalid --${name}: ${raw}`);
  }
  return value;
}

export function validatePositiveInteger(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError('usage', `Invalid --${name}: ${raw} — expected a positive integer`);
  }
  return value;
}

export function resolveNow(raw: string | undefined): Date {
  if (!raw) return new Date();
  const now = new Date(raw);
  if (Number.isNaN(now.getTime())) {
    throw new CliError('usage', `Invalid UAE_NEWS_DIGEST_NOW: ${raw}`);
  }
  return now;
}

/** The config to run with, plus a label for messages: the file path, or "built-in default config". */
export async function resolveConfig(explicit: string | undefined, env: CliEnv, cwd: string): Promise<{ config: DigestConfig; source: string }> {
  try {
    const path = await resolveConfigPath({ explicit, cwd, env });
    if (!path) return { config: DEFAULT_CONFIG, source: 'built-in default config' };
    return { config: await loadConfig(path), source: path };
  } catch (err) {
    throw new CliError('config', err instanceof Error ? err.message : String(err));
  }
}

/** The default command. Returns the exit code; throws CliError for usage/config problems. */
export async function runDefault(flags: RunFlags, env: CliEnv, cwd: string): Promise<number> {
  if (flags.prompt) {
    const prompt = DEFAULT_CONFIG.agentPrompt;
    if (!prompt) throw new CliError('config', 'The built-in config has no agentPrompt; nothing to print.');
    process.stdout.write(prompt + '\n');
    return 0;
  }

  const hours = validatePositiveNumber('hours', flags.hours);
  const limitOverride = flags.limit === undefined ? undefined : validatePositiveInteger('limit', flags.limit);
  const timeoutMs = validatePositiveNumber('timeout-ms', flags.timeoutMs);
  const deeplAuthKey = env.DEEPL_AUTH_KEY;
  const now = resolveNow(env.UAE_NEWS_DIGEST_NOW);

  if (flags.targetLang && !deeplAuthKey) {
    throw new CliError('usage', '--target-lang requires DEEPL_AUTH_KEY — set it to your DeepL Free API key, or drop --target-lang.');
  }

  const { config } = await resolveConfig(flags.config, env, cwd);
  const seenKeys = await readSeenKeys(flags.stateFile);

  if (flags.targetLang && deeplAuthKey) {
    console.error(`Translating to ${flags.targetLang} via DeepL...`);
  }

  const result = await runDigest({
    config,
    seenKeys,
    hours,
    limitOverride,
    now,
    fetchText: makeFetchText(timeoutMs),
    translate: makeTranslate(deeplAuthKey),
    targetLang: flags.targetLang,
  });

  if (flags.json) {
    const json = toJson(result, { tool: TOOL_ID, version: VERSION, hours, limit: limitOverride, targetLang: flags.targetLang, now });
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
  } else {
    for (const warning of result.warnings) console.error(warning);
    process.stdout.write(renderText(result, config, now) + '\n');
  }

  if (result.fetchedTopics === 0) {
    if (flags.json) for (const warning of result.warnings) console.error(warning);
    return 1;
  }

  if (flags.dryRun) console.error('(dry run — state file not updated)');
  const producedItems = result.sections.some((s) => s.items.length > 0);
  if (producedItems && !flags.dryRun) {
    await writeSeenKeys(flags.stateFile, result.nextSeenKeys);
  }
  return 0;
}
```

- [ ] **Step 4: Write `src/cli/commands.ts`**

```ts
import type { Command } from 'commander';
import { DEFAULT_CONFIG } from '../config/load';
import { buildFeedUrl } from '../url';
import { BIN_NAME, DESCRIPTION, TOOL_ID, VERSION } from '../meta';
import type { CliEnv } from './run';

const FLAGS = [
  '--config <path>',
  '--hours <n>',
  '--limit <n>',
  '--state-file <path>',
  '--timeout-ms <n>',
  '--target-lang <code>',
  '--dry-run',
  '--prompt',
  '--json',
];

/** `manifest`: machine-readable tool descriptor on stdout. */
export function manifest(_program: Command): number {
  console.log(JSON.stringify({
    id: TOOL_ID,
    version: VERSION,
    runtime: 'bun',
    bin: BIN_NAME,
    description: DESCRIPTION,
    commands: [
      {
        name: '(default)',
        description: 'Fetch and print news digest',
        flags: FLAGS,
        examples: ['uae-news-digest --hours 12 --limit 10'],
      },
    ],
    envVars: ['DEEPL_AUTH_KEY'],
  }, null, 2));
  return 0;
}

/** `healthcheck`: GET the feed URL and report {ok, version, latencyMs} on stdout. */
export async function healthcheck(opts: { rssUrl?: string }, _env: CliEnv, _cwd: string): Promise<number> {
  const start = performance.now();
  try {
    const rssUrl = opts.rssUrl ?? buildFeedUrl(DEFAULT_CONFIG.topics[0]!);
    const res = await fetch(rssUrl, { signal: AbortSignal.timeout(10_000) });
    const result = { ok: res.ok, version: VERSION, latencyMs: Math.round(performance.now() - start) };
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ ok: false, version: VERSION, latencyMs: Math.round(performance.now() - start), error: message }));
    return 1;
  }
}
```

(The `_program`, `_env`, `_cwd` parameters are used by Task 5; they are in the signature now so Task 5 does not change call sites.)

- [ ] **Step 5: Write `src/cli/program.ts`**

Move the `HELP` string from `src/index.ts` verbatim (it is long; copy it, do not retype). Then:

```ts
import { Command, CommanderError } from 'commander';
import { DEFAULT_STATE_FILE } from '../state';
import { DESCRIPTION, TOOL_ID, VERSION } from '../meta';
import { runDefault, type CliEnv, type RunFlags } from './run';
import { healthcheck, manifest } from './commands';

const HELP = `...moved verbatim from src/index.ts...`;

/**
 * The Commander program. Actions never exit the process: each one hands its exit code to `onExit`,
 * and `main` turns that (or a thrown error) into the return value.
 */
export function buildProgram(onExit: (code: number) => void, env: CliEnv, cwd: string): Command {
  const program = new Command();
  program.exitOverride(); // before .command(): subcommands inherit it at creation time

  program
    .name(TOOL_ID)
    .description(DESCRIPTION)
    .version(VERSION)
    .option('--json', 'output as JSON', false)
    .option('--config <path>', 'path to the digest config JSON (overrides auto-detect)')
    .option('--state-file <path>', 'path to seen-items state file', DEFAULT_STATE_FILE)
    .option('--hours <number>', 'lookback window in hours', '36')
    .option('--limit <number>', "max items per topic (overrides each topic's limit)")
    .option('--timeout-ms <number>', 'RSS fetch timeout in milliseconds', '15000')
    .option('--target-lang <code>', 'translate via DeepL (requires DEEPL_AUTH_KEY)')
    .option('--dry-run', 'print digest without updating state file', false)
    .option('--prompt', 'print the agent filter prompt and exit', false)
    .addHelpText('after', HELP)
    .action(async (flags: RunFlags) => onExit(await runDefault(flags, env, cwd)));

  program
    .command('manifest')
    .description('Print tool manifest as JSON')
    .action(() => onExit(manifest(program)));

  program
    .command('healthcheck')
    .description('Run smoke test and report status')
    .option('--rss-url <url>', 'RSS URL for deterministic smoke testing')
    .action(async function (this: Command) {
      const opts = this.optsWithGlobals() as { rssUrl?: string };
      onExit(await healthcheck(opts, env, cwd));
    });

  return program;
}

/** Parse argv and run; the only place that decides the exit code. Never throws. */
export async function main(argv: string[], env: CliEnv = process.env, cwd: string = process.cwd()): Promise<number> {
  let exitCode = 0;
  const program = buildProgram((code) => { exitCode = code; }, env, cwd);
  try {
    await program.parseAsync(argv);
    return exitCode;
  } catch (err) {
    // --help / --version (exitCode 0) and usage errors (exitCode 1, message already printed by commander)
    if (err instanceof CommanderError) return err.exitCode;
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
```

- [ ] **Step 6: Rewrite `src/index.ts` in place**

Edit the existing file (keep mode 100755) so its entire content is:

```ts
#!/usr/bin/env bun
import { main } from './cli/program';

process.exitCode = await main(process.argv);
```

Ruling recorded here: the spec says `index.ts` "calls `process.exit`"; we set `process.exitCode` instead so buffered stdout is never truncated (the reason PR 2 moved off `process.exit`). Same observable exit code.

- [ ] **Step 7: Verify**

Run: `bun run typecheck && bun test && bun run smoke:pack`
Expected: all green, count = previous + 3. Run `grep -rn "process.exit" src/` — expected: no hits under `src/cli/`, and only `process.exitCode` in `src/index.ts`. `git ls-files -s src/index.ts` → `100755`.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts src/cli/program.ts src/cli/run.ts src/cli/commands.ts test/unit/cli-main.test.ts
git commit -m "refactor(cli): split index.ts into cli/program, run, commands; one exit path via main()"
```

---

### Task 5: Command behaviour — derived manifest, config-driven healthcheck and --prompt, `config` subcommands

**Files:**
- Modify: `src/cli/commands.ts`, `src/cli/program.ts`, `src/cli/run.ts`
- Modify: `test/cli/commands.test.ts`
- Modify: `scripts/smoke-pack.ts`

**Interfaces:**
- Produces: `export function configPrintDefault(): number`; `export async function configValidate(explicit: string | undefined, env: CliEnv, cwd: string): Promise<number>`; `healthcheck(opts: { rssUrl?: string; config?: string }, env, cwd)`.
- Consumes: `resolveConfig` from `./run`; `resolveConfigPath`, `loadConfig` from `../config/load`; the raw `../config/default.json`.

- [ ] **Step 1: Failing e2e tests** — append inside `describe('CLI commands', …)` in `test/cli/commands.test.ts`. Add these imports at the top of the file: `import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import defaultConfig from '../../src/config/default.json'; import { buildProgram } from '../../src/cli/program';` and `feedConfig` from the helpers.

```ts
  test('manifest lists exactly the flags defined on the program, and the subcommands', async () => {
    const { stdout, exitCode } = await cli.run(['manifest']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const expectedFlags = buildProgram(() => {}, {}, '/').options.filter((o) => o.long !== '--version').map((o) => o.flags);
    expect(parsed.commands[0].name).toBe('(default)');
    expect(parsed.commands[0].flags).toEqual(expectedFlags);
    expect(parsed.commands.slice(1).map((c: { name: string }) => c.name)).toEqual(['manifest', 'healthcheck', 'config']);
  });

  test('healthcheck without --rss-url probes the first topic of the resolved config', async () => {
    const result = await cli.run(['healthcheck', '--config', feedConfig(`${cli.baseUrl}/rss`)]);
    expectExitCode(result, 0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss', body: null }]);
  });

  test('--prompt prints agentPrompt from the resolved config', async () => {
    const config = feedConfig(`${cli.baseUrl}/rss`, {}, { agentPrompt: 'Custom prompt for tests' });
    const { stdout, exitCode } = await cli.run(['--prompt', '--config', config]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('Custom prompt for tests\n');
  });

  test('--prompt fails cleanly when the config has no agentPrompt', async () => {
    const config = feedConfig(`${cli.baseUrl}/rss`, {}, { agentPrompt: undefined });
    const result = await cli.run(['--prompt', '--config', config]);
    expectExitCode(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Config at ${config} has no "agentPrompt"`);
  });

  test('config print-default prints the built-in config as JSON', async () => {
    const { stdout, exitCode } = await cli.run(['config', 'print-default']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(defaultConfig);
  });

  test('config validate <path> reports ok for a valid file', async () => {
    const config = feedConfig(`${cli.baseUrl}/rss`);
    const result = await cli.run(['config', 'validate', config]);
    expectExitCode(result, 0);
    expect(result.stdout).toStartWith('ok');
    expect(result.stdout).toContain('1 topic(s)');
  });

  test('config validate lists every issue with its JSON path and exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-broken-'));
    const path = join(dir, 'broken.json');
    writeFileSync(path, JSON.stringify({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A' }], bogus: 1 }));
    try {
      const result = await cli.run(['config', 'validate', path]);
      expectExitCode(result, 1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`Invalid config at ${path}`);
      expect(result.stderr).toContain('topics[0].query');
      expect(result.stderr).toContain('bogus');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('config validate with a missing explicit path exits 1', async () => {
    const result = await cli.run(['config', 'validate', '/nonexistent/digest.config.json']);
    expectExitCode(result, 1);
    expect(result.stderr).toContain('Config not found: /nonexistent/digest.config.json');
  });

  test('config validate without a path and nothing discoverable says so', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cli-nocfg-'));
    try {
      const result = await cli.runFromCwd(['config', 'validate'], { cwd, env: { HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent' } });
      expectExitCode(result, 1);
      expect(result.stderr).toContain('No config found');
      expect(result.stderr).toContain('config print-default');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `bun test test/cli/commands.test.ts`
Expected: the 9 new tests fail (unknown command `config`, hard-coded flags, healthcheck ignoring `--config`, `--prompt` reading the built-in config).

- [ ] **Step 3: `src/cli/commands.ts`**

Replace the file with:

```ts
import type { Command } from 'commander';
import defaultJson from '../config/default.json';
import { loadConfig, resolveConfigPath } from '../config/load';
import { buildFeedUrl } from '../url';
import { BIN_NAME, DESCRIPTION, TOOL_ID, VERSION } from '../meta';
import { CliError } from './errors';
import { resolveConfig, type CliEnv } from './run';

/** `manifest`: machine-readable tool descriptor on stdout; flags and subcommands come from the program itself. */
export function manifest(program: Command): number {
  const flags = program.options.filter((o) => o.long !== '--version').map((o) => o.flags);
  console.log(JSON.stringify({
    id: TOOL_ID,
    version: VERSION,
    runtime: 'bun',
    bin: BIN_NAME,
    description: DESCRIPTION,
    commands: [
      {
        name: '(default)',
        description: 'Fetch and print news digest',
        flags,
        examples: ['uae-news-digest --hours 12 --limit 10'],
      },
      ...program.commands.map((c) => ({ name: c.name(), description: c.description() })),
    ],
    envVars: ['DEEPL_AUTH_KEY'],
  }, null, 2));
  return 0;
}

/** `healthcheck`: GET `--rss-url`, else the first topic of the resolved config; {ok, version, latencyMs} on stdout. */
export async function healthcheck(opts: { rssUrl?: string; config?: string }, env: CliEnv, cwd: string): Promise<number> {
  const start = performance.now();
  try {
    const rssUrl = opts.rssUrl ?? buildFeedUrl((await resolveConfig(opts.config, env, cwd)).config.topics[0]!);
    const res = await fetch(rssUrl, { signal: AbortSignal.timeout(10_000) });
    const result = { ok: res.ok, version: VERSION, latencyMs: Math.round(performance.now() - start) };
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ ok: false, version: VERSION, latencyMs: Math.round(performance.now() - start), error: message }));
    return 1;
  }
}

/** `config print-default`: the built-in config exactly as shipped, for copying into digest.config.json. */
export function configPrintDefault(): number {
  console.log(JSON.stringify(defaultJson, null, 2));
  return 0;
}

/** `config validate [path]`: run the file (or the discovered config) through the schema. */
export async function configValidate(explicit: string | undefined, env: CliEnv, cwd: string): Promise<number> {
  let path: string | null;
  try {
    path = await resolveConfigPath({ explicit, cwd, env });
  } catch (err) {
    throw new CliError('config', err instanceof Error ? err.message : String(err));
  }
  if (!path) {
    console.error('No config found — pass a path, or create ./digest.config.json (start from `config print-default`).');
    return 1;
  }
  try {
    const config = await loadConfig(path);
    console.log(`ok — ${path}: ${config.topics.length} topic(s)`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
```

`loadConfig` already produces `Invalid config at <path>:` followed by one `✖ …  → at <json path>` line per zod issue (`z.prettifyError`), and `Config not found: <path>` / `Failed to parse config at <path>: …` for the other failures — `config validate` reuses those messages rather than formatting issues a second time.

- [ ] **Step 4: `src/cli/run.ts` — `--prompt` reads the resolved config**

Replace the `if (flags.prompt) { … }` block with:

```ts
  if (flags.prompt) {
    const { config, source } = await resolveConfig(flags.config, env, cwd);
    if (!config.agentPrompt) {
      throw new CliError('config', `Config at ${source} has no "agentPrompt" — add an "agentPrompt" string to the config to use --prompt.`);
    }
    process.stdout.write(config.agentPrompt + '\n');
    return 0;
  }
```

- [ ] **Step 5: `src/cli/program.ts` — wire `config` and pass `--config` to healthcheck**

Change the healthcheck action's cast to `{ rssUrl?: string; config?: string }`. After the healthcheck command add:

```ts
  const config = program
    .command('config')
    .description('Print or validate the digest config');
  config
    .command('print-default')
    .description('Print the built-in config as JSON (copy it to ./digest.config.json and edit)')
    .action(() => onExit(configPrintDefault()));
  config
    .command('validate [path]')
    .description('Validate a config file, or the one auto-detected when no path is given')
    .action(async function (this: Command, path: string | undefined) {
      const opts = this.optsWithGlobals() as { config?: string };
      onExit(await configValidate(path ?? opts.config, env, cwd));
    });
```

Import `configPrintDefault`, `configValidate` from `./commands`. In `HELP`, extend the `SUBCOMMANDS` block:

```
SUBCOMMANDS
  manifest                 Print a machine-readable tool descriptor as JSON.
  healthcheck [--rss-url]  Smoke-test the first topic's feed (or --rss-url); prints
                           {ok,version,latencyMs}; exits 0 on success, 1 on failure.
  config print-default     Print the built-in config as JSON to copy and edit.
  config validate [path]   Validate a config file (default: the auto-detected one);
                           prints "ok" or every issue with its JSON path.
```

and change the `AGENT FILTER` paragraph's first sentence to `--prompt PRINTS the "agentPrompt" from the resolved config and exits.`

- [ ] **Step 6: `scripts/smoke-pack.ts` — exercise the new commands against the packed binary**

After the `manifest` check, add:

```ts
    const printed = JSON.parse(await run(['bun', bin, 'config', 'print-default'], consumerDir));
    if (!Array.isArray(printed.topics) || printed.topics.length === 0) {
      throw new Error(`Unexpected config print-default from packed binary: ${JSON.stringify(printed).slice(0, 200)}`);
    }
```

and, right after the temp `digest.config.json` is written (before the digest run):

```ts
      const validated = await run(['bun', bin, 'config', 'validate', configPath], consumerDir);
      if (!validated.startsWith('ok')) {
        throw new Error(`Unexpected config validate from packed binary: ${validated}`);
      }
```

(Check how `run` in that script returns stdout — it returns the trimmed stdout string; adapt `.startsWith` if it returns an object.)

- [ ] **Step 7: Verify**

Run: `bun run typecheck && bun test && bun run smoke:pack`
Expected: all green; count = previous + 9. Also run by hand from the worktree and eyeball:

```bash
bun src/index.ts config print-default | head -5
bun src/index.ts config validate /nonexistent.json; echo "exit $?"
bun src/index.ts manifest | head -20
```

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands.ts src/cli/program.ts src/cli/run.ts test/cli/commands.test.ts scripts/smoke-pack.ts
git commit -m "feat(cli): config print-default/validate, manifest from program, healthcheck and --prompt from the resolved config"
```

---

### Task 6: Documentation

**Files:**
- Modify: `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `openspec/specs/GLOSSARY.md`

- [ ] **Step 1: CHANGELOG `[Unreleased]`** — add under the existing headings (keep every PR-1/PR-2 line):

```markdown
### Added
- `config print-default` prints the built-in config as JSON; `config validate [path]` runs a file (or the auto-detected config) through the schema and prints `ok` or every issue with its JSON path (exit 1).
- `manifest` now lists the subcommands and derives the default command's flags from the CLI definition instead of a hand-kept list.

### Changed
- `healthcheck` without `--rss-url` probes the first topic of the resolved config (`--config`, `./digest.config.json`, XDG, or the built-in default), not only the built-in one.
- `--prompt` prints `agentPrompt` from the resolved config; a config without one exits 1 naming the missing key.
- `--limit` must be a positive integer (`--limit 2.5` is a usage error).
- The state file's directory is created on write (`writeSeenKeys`), so the CLI no longer shells out to `mkdir`.
- CLI internals moved to `src/cli/*` (`program.ts`, `run.ts`, `commands.ts`, `adapters.ts`, `errors.ts`); `src/index.ts` is a three-line bin calling `main(argv)`. Failures are typed `CliError`s (`usage` / `config` / `network` / `timeout`) classified where they occur; every command returns its exit code through one path — no `process.exit` inside commands.

### Fixed
- Two titles that reduce to no words (for example non-Latin titles under the ASCII word extraction) no longer count as identical, so a non-Latin feed is not collapsed into a single item.
```

- [ ] **Step 2: README** — in the CLI section add a "Subcommands" table (`manifest`, `healthcheck [--rss-url <url>]`, `config print-default`, `config validate [path]`) with one line each; in the config section replace any "copy `src/config/default.json`" advice with `uae-news-digest config print-default > digest.config.json` and mention `config validate`; state that `--limit` is an integer; add an "Exit codes" line: `0` success (a topic may have failed — see warnings), `1` usage/config/network/timeout error or no topic fetched.

- [ ] **Step 3: CLAUDE.md** — pipeline diagram becomes:

```
src/index.ts → cli/program.ts main(argv) → cli/run.ts (default command)
  → config (default.json or digest.config.json) → url.ts buildFeedUrl → cli/adapters.ts fetchText
  → rss.ts parseRss → digest.ts buildDigestWithStats (score, dedupe) → translate (optional)
  → render.ts renderText | json.ts toJson
```

Add one rule under "Critical Development Rules": **ONE EXIT PATH** — commands under `src/cli/` return exit codes and throw `CliError`; only `src/index.ts` touches `process.exitCode`.

- [ ] **Step 4: GLOSSARY** — add a row **CLI command** ("A Commander action in `src/cli/program.ts`; returns an exit code via `onExit`, throws `CliError` for usage/config problems; `main(argv)` maps both to the process exit code") and a row **CliError** (kinds and where classification happens, `src/cli/errors.ts`). Update **Core API** only if it names something that moved (it should not: `runDigest`, `renderText`, `toJson`, `loadConfig` are unchanged).

- [ ] **Step 5: Verify and commit**

Run: `bun run typecheck && bun test && bun run smoke:pack` (docs only, but the plan requires it). Grep `README.md CLAUDE.md openspec/specs/GLOSSARY.md` for `process.exit(` and `mkdir -p` — no hits expected.

```bash
git add CHANGELOG.md README.md CLAUDE.md openspec/specs/GLOSSARY.md
git commit -m "docs: config subcommands, src/cli layout, one exit path"
```

---

## Self-review

**Spec coverage (§3 + staging item 3):** flag list unchanged and region flags absent → already true from PR 2, asserted by the derived `manifest` (Task 5). `manifest` derived from `program` → Task 5. `healthcheck` from the resolved config, `--rss-url` kept → Task 5. `config print-default` / `config validate` → Task 5. `--prompt` from config, exit 1 naming the key → Task 5. `CliError` with four kinds, classification in the adapter, no message matching upstream → Task 2. zod issues surface with path → reused `parseConfig` message via `config validate` (Task 5). `main(argv): Promise<number>`, single exit path, no scattered `process.exit` → Task 4 (ruling: `process.exitCode` instead of `process.exit`, recorded in Task 4 Step 6). `mkdir` into `writeSeenKeys` → Task 3. `meta.ts` JSON import → Task 3 (build verified). Owed from PR 2 reviews: integer `--limit`, `titleSimilarity` empty sets, healthcheck exit consistency, `cli.test.ts` split → Tasks 3, 4, 1. ASCII-only word extraction stays as the spec grandfathers it. `pipeline/`, `output/`, `core.ts` final surface, `lib.ts` deletion → PR 4, absent by design.

**Placeholders:** none; the one "moved verbatim" instruction (the `HELP` string in Task 4) names its exact source.

**Type consistency:** `CliEnv` and `RunFlags` defined in `run.ts` (Task 4) and imported by `program.ts` and `commands.ts`; `resolveConfig` returns `{ config, source }` and is consumed by `runDefault` (Task 4/5) and `healthcheck` (Task 5); `healthcheck(opts, env, cwd)` has the same arity in Tasks 4 and 5; `buildProgram(onExit, env, cwd)` used identically in `main` (Task 4) and the manifest test (Task 5); `feedConfig(feedUrl, topicOverrides, configOverrides)` from Task 1 is what Task 5's `--prompt` tests call.
