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
