# Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add integration tests that exercise the CLI end-to-end with stubbed HTTP, verifying stdout/stderr/exit code for all major scenarios.

**Architecture:** A local `Bun.serve` test server returns canned RSS and DeepL responses. Each test spawns `bun src/index.ts` as a subprocess, capturing stdout, stderr, and exit code. `DEEPL_API_URL` becomes an env-var-overridable constant so tests can point DeepL calls at the local server.

**Tech Stack:** Bun test runner, Bun.serve, Bun.spawn

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib.ts` | Modify line 5 | Make `DEEPL_API_URL` overridable via env var |
| `test/cli.test.ts` | Create | Integration tests with test server and 8 test cases |

---

### Task 1: Make DEEPL_API_URL overridable

**Files:**
- Modify: `src/lib.ts:5`

- [ ] **Step 1: Update DEEPL_API_URL to read from env**

In `src/lib.ts`, replace line 5:

```typescript
export const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';
```

with:

```typescript
export const DEEPL_API_URL = process.env.DEEPL_API_URL ?? 'https://api-free.deepl.com/v2/translate';
```

- [ ] **Step 2: Run existing tests to verify nothing breaks**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All 48 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/lib.ts
git commit -m "feat: make DEEPL_API_URL overridable via env var for testing"
```

---

### Task 2: Create integration test file with test server and all 8 test cases

**Files:**
- Create: `test/cli.test.ts`

- [ ] **Step 1: Create the full integration test file**

Create `test/cli.test.ts` with the following content:

```typescript
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';

// ── Canned responses ──────────────────────────────────────────

const now = new Date();
const oneHourAgo = new Date(now.getTime() - 3_600_000).toUTCString();
const twoHoursAgo = new Date(now.getTime() - 7_200_000).toUTCString();

const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>Dubai airport reopens after rain</title><pubDate>${oneHourAgo}</pubDate><source url="https://example.com">Reuters</source></item>
  <item><title>Abu Dhabi market overview</title><pubDate>${twoHoursAgo}</pubDate><source url="https://example.com">Gulf News</source></item>
</channel></rss>`;

const RSS_EMPTY = `<?xml version="1.0"?><rss><channel></channel></rss>`;

const DEEPL_RESPONSE = JSON.stringify({
  translations: [
    { detected_source_language: 'EN', text: 'Flughafen Dubai öffnet nach Regen wieder' },
    { detected_source_language: 'EN', text: 'Marktübersicht Abu Dhabi' },
  ],
});

// ── Test server ───────────────────────────────────────────────

let server: Server;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/rss') {
        return new Response(RSS_XML, { headers: { 'content-type': 'application/xml' } });
      }

      if (url.pathname === '/rss/empty') {
        return new Response(RSS_EMPTY, { headers: { 'content-type': 'application/xml' } });
      }

      if (url.pathname === '/rss/error') {
        return new Response('Internal Server Error', { status: 500 });
      }

      if (url.pathname === '/translate' && req.method === 'POST') {
        return new Response(DEEPL_RESPONSE, { headers: { 'content-type': 'application/json' } });
      }

      return new Response('Not Found', { status: 404 });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

// ── Helpers ───────────────────────────────────────────────────

const CLI = join(import.meta.dir, '..', 'src', 'index.ts');

async function run(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function tmpStateFile(): string {
  return join(tmpdir(), `uae-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
}

// ── Tests ─────────────────────────────────────────────────────

describe('CLI integration', () => {
  test('default text output with items', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('🇦🇪 UAE Latest News Digest');
    expect(stdout).toContain('Dubai airport reopens after rain');
    expect(stdout).toContain('Abu Dhabi market overview');
    expect(stdout).toContain('Reuters');
    expect(stdout).toContain('h ago');
  });

  test('--json produces agent-friendly envelope', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await run([
      '--json',
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.tool).toBe('uae-news-digest');
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.query).toHaveProperty('hours');
    expect(parsed.query).toHaveProperty('limit');
    expect(parsed.query).toHaveProperty('targetLang');
    expect(parsed.count).toBe(2);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toHaveProperty('title');
    expect(parsed.items[0]).toHaveProperty('source');
    expect(parsed.items[0]).toHaveProperty('score');
    expect(parsed.items[0]).toHaveProperty('publishedAt');
    expect(parsed.items[0]).toHaveProperty('hoursAgo');
  });

  test('--dry-run does not write state file', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('dry run');
    const exists = await Bun.file(stateFile).exists();
    expect(exists).toBe(false);
  });

  test('translation via DeepL with --target-lang', async () => {
    const stateFile = tmpStateFile();
    const { stdout, stderr, exitCode } = await run(
      [
        '--rss-url', `${baseUrl}/rss`,
        '--state-file', stateFile,
        '--target-lang', 'DE',
        '--dry-run',
      ],
      {
        DEEPL_AUTH_KEY: 'fake-key',
        DEEPL_API_URL: `${baseUrl}/translate`,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain('Translating to DE');
    expect(stdout).toContain('Flughafen Dubai öffnet nach Regen wieder');
    expect(stdout).toContain('Marktübersicht Abu Dhabi');
  });

  test('--target-lang without DEEPL_AUTH_KEY exits with error', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run(
      [
        '--rss-url', `${baseUrl}/rss`,
        '--state-file', stateFile,
        '--target-lang', 'DE',
      ],
      { DEEPL_AUTH_KEY: '' },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain('DEEPL_AUTH_KEY');
  });

  test('RSS HTTP error shows message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss/error`,
      '--state-file', stateFile,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('RSS fetch failed');
  });

  test('empty RSS feed shows no-news message', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss/empty`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('No significant news');
  });

  test('state file is written when not dry-run', async () => {
    const stateFile = tmpStateFile();
    const { exitCode } = await run([
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
    ]);

    expect(exitCode).toBe(0);
    const exists = await Bun.file(stateFile).exists();
    expect(exists).toBe(true);
    const content = await Bun.file(stateFile).text();
    expect(content).toContain('dubai airport reopens after rain');

    // Cleanup
    await Bun.$`rm -f ${stateFile}`.quiet();
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass (48 existing + 8 new = 56 total)

- [ ] **Step 3: Commit**

```bash
git add test/cli.test.ts
git commit -m "test: add CLI integration tests with stubbed HTTP server"
```
