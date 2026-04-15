# Test Reshape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `test/lib.test.ts` into per-module test files, add an end-to-end pipeline integration test, and cover CLI timeout + network-failure error paths — scaffolding for the upcoming pipeline refactor.

**Architecture:** Move existing `describe` blocks out of the 588-line `test/lib.test.ts` into per-module files under `test/unit/` and `test/integration/`, mirroring `src/`. Add a new end-to-end integration test that drives `runDigest` from a fixture XML through to the rendered string. Add two CLI error-path tests reusing the existing in-process `Bun.serve` mock pattern.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript, `Bun.serve` for local HTTP mocks (already in use — no new dependencies).

**Spec:** `docs/superpowers/specs/2026-04-15-test-reshape-design.md`

**Note on imports:** New test files import from concrete module paths (`../../src/rss`, `../../src/scoring`, etc.) rather than the `../src/lib` barrel. This reinforces the module boundary and matches how the upcoming Spec A refactor will consume these modules.

**Note on CLI tests:** `test/cli.test.ts` already covers the HTTP 500 error path (see `'RSS HTTP error shows message and exits 1'` at line 182). Of the three CLI error-path tests in the spec, only two are new work: **timeout** and **network failure**.

---

## File Structure

**Created:**
- `test/fixtures/helpers.ts` — `makeItem`, `freezeNow`
- `test/fixtures/sample-feed.xml` — hand-crafted RSS, ~5 items across scoring tiers
- `test/unit/rss.test.ts` — parseRss
- `test/unit/scoring.test.ts` — scoreItem
- `test/unit/normalize.test.ts` — titleSimilarity
- `test/unit/render.test.ts` — emojiFor + renderDigest
- `test/unit/translate.test.ts` — translateDeepL (owns its local DeepL server)
- `test/integration/digest.test.ts` — buildDigest
- `test/integration/pipeline.test.ts` — runDigest (moved cases + new end-to-end fixture test)

**Deleted:**
- `test/lib.test.ts`

**Modified:**
- `test/cli.test.ts` — add two new error-path tests (timeout, network failure)

---

## Task 1: Create fixture helpers

**Files:**
- Create: `test/fixtures/helpers.ts`

- [ ] **Step 1: Write `test/fixtures/helpers.ts`**

```ts
import type { RssItem } from '../../src/rss';

/** Build an RssItem with sensible defaults; override any field. */
export function makeItem(overrides: Partial<RssItem> = {}): RssItem {
  return {
    title: 'Default title',
    link: 'https://example.com/default',
    pubDate: new Date('2026-04-15T10:00:00Z').toUTCString(),
    source: 'Reuters',
    ...overrides,
  };
}

/** Return a fixed Date for use as `now` in tests — keeps time-dependent logic deterministic. */
export function freezeNow(iso: string): Date {
  return new Date(iso);
}
```

- [ ] **Step 2: Verify the helper compiles**

Run: `bun build test/fixtures/helpers.ts --target=bun --outdir=/tmp/test-reshape-check`
Expected: build succeeds, no type errors.
(Cleanup: `rm -rf /tmp/test-reshape-check`)

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/helpers.ts
git commit -m "test: add fixture helpers for test reshape"
```

**Note:** If `RssItem` has fields not shown above, read `src/rss.ts` first and adjust the `makeItem` defaults to match. The defaults must produce a valid `RssItem` that passes `parseRss`'s type contract.

---

## Task 2: Create fixture RSS feed

**Files:**
- Create: `test/fixtures/sample-feed.xml`

- [ ] **Step 1: Write `test/fixtures/sample-feed.xml`**

Use pubDates relative to `2026-04-15T12:00:00Z` so all items fall within a 48-hour window.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Sample Feed</title>
  <item>
    <title>UAE launches new satellite from Abu Dhabi</title>
    <link>https://example.com/a</link>
    <pubDate>Wed, 15 Apr 2026 09:00:00 GMT</pubDate>
    <source url="https://reuters.com">Reuters</source>
  </item>
  <item>
    <title>Dubai property market grows 12 percent</title>
    <link>https://example.com/b</link>
    <pubDate>Wed, 15 Apr 2026 06:00:00 GMT</pubDate>
    <source url="https://khaleejtimes.com">Khaleej Times</source>
  </item>
  <item>
    <title>Sharjah opens new cultural center</title>
    <link>https://example.com/c</link>
    <pubDate>Tue, 14 Apr 2026 22:00:00 GMT</pubDate>
    <source url="https://thenationalnews.com">The National</source>
  </item>
  <item>
    <title>UAE satellite launched from Abu Dhabi site</title>
    <link>https://example.com/d</link>
    <pubDate>Wed, 15 Apr 2026 10:00:00 GMT</pubDate>
    <source url="https://bbc.com">BBC</source>
  </item>
  <item>
    <title>Ajman announces new transport plan</title>
    <link>https://example.com/e</link>
    <pubDate>Tue, 14 Apr 2026 18:00:00 GMT</pubDate>
    <source url="https://gulfnews.com">Gulf News</source>
  </item>
</channel></rss>
```

Items 1 and 4 are deliberate near-duplicates across different sources, to exercise fuzzy dedup. Items span tier-1 (Reuters, BBC), tier-2 (Khaleej Times, Gulf News, The National).

- [ ] **Step 2: Commit**

```bash
git add test/fixtures/sample-feed.xml
git commit -m "test: add sample RSS fixture for integration tests"
```

---

## Task 3: Move parseRss tests to `test/unit/rss.test.ts`

**Files:**
- Create: `test/unit/rss.test.ts`
- Modify: `test/lib.test.ts` (remove moved block)

- [ ] **Step 1: Write `test/unit/rss.test.ts`**

Copy the entire `describe('parseRss', ...)` block from `test/lib.test.ts` (lines 71-107 at time of writing). Replace the import with:

```ts
import { describe, expect, test } from 'bun:test';
import { parseRss } from '../../src/rss';
```

Do not modify any assertion. The file body is:

```ts
import { describe, expect, test } from 'bun:test';
import { parseRss } from '../../src/rss';

describe('parseRss', () => {
  // ...paste the four test() cases from test/lib.test.ts here, unchanged...
});
```

- [ ] **Step 2: Remove the `describe('parseRss', ...)` block from `test/lib.test.ts`**

Delete the lines corresponding to the parseRss describe block. Leave everything else in `lib.test.ts` intact for now — it will be removed progressively in later tasks.

- [ ] **Step 3: Run both files to verify**

Run: `bun test test/unit/rss.test.ts test/lib.test.ts`
Expected: all tests pass, total assertion count unchanged, no "parseRss" tests run from `lib.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add test/unit/rss.test.ts test/lib.test.ts
git commit -m "test: move parseRss tests to test/unit/rss.test.ts"
```

---

## Task 4: Move scoreItem tests to `test/unit/scoring.test.ts`

**Files:**
- Create: `test/unit/scoring.test.ts`
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Write `test/unit/scoring.test.ts`**

Copy the entire `describe('scoreItem', ...)` block from `test/lib.test.ts` unchanged. Header:

```ts
import { describe, expect, test } from 'bun:test';
import { scoreItem } from '../../src/scoring';
import type { RssItem } from '../../src/rss';
```

If the moved tests reference `makeKey` or other helpers, import them from the concrete module (`../../src/normalize`, etc.). If they reference a local `makeItem` helper defined at the top of `lib.test.ts`, import it from `../fixtures/helpers` instead.

- [ ] **Step 2: Remove the `describe('scoreItem', ...)` block from `test/lib.test.ts`**

- [ ] **Step 3: Run to verify**

Run: `bun test test/unit/scoring.test.ts test/lib.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/unit/scoring.test.ts test/lib.test.ts
git commit -m "test: move scoreItem tests to test/unit/scoring.test.ts"
```

---

## Task 5: Move titleSimilarity tests to `test/unit/normalize.test.ts`

**Files:**
- Create: `test/unit/normalize.test.ts`
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Write `test/unit/normalize.test.ts`**

Header:

```ts
import { describe, expect, test } from 'bun:test';
import { titleSimilarity } from '../../src/scoring';
```

(Note: `titleSimilarity` lives in `src/scoring.ts` per the barrel. The filename `normalize.test.ts` reflects that it tests normalization-adjacent behavior. If the engineer prefers, renaming to `similarity.test.ts` is acceptable — the spec calls for mirroring modules, but `titleSimilarity` is the only public export here.)

Copy the entire `describe('titleSimilarity', ...)` block unchanged.

- [ ] **Step 2: Remove the block from `test/lib.test.ts`**

- [ ] **Step 3: Run to verify**

Run: `bun test test/unit/normalize.test.ts test/lib.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/unit/normalize.test.ts test/lib.test.ts
git commit -m "test: move titleSimilarity tests to test/unit/normalize.test.ts"
```

---

## Task 6: Move emojiFor + renderDigest tests to `test/unit/render.test.ts`

**Files:**
- Create: `test/unit/render.test.ts`
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Write `test/unit/render.test.ts`**

Header:

```ts
import { describe, expect, test } from 'bun:test';
import { emojiFor, renderDigest } from '../../src/render';
import type { DigestItem } from '../../src/digest';
```

Copy both `describe('emojiFor', ...)` and `describe('renderDigest', ...)` blocks unchanged. If the renderDigest block uses a local helper for building `DigestItem` values, move that helper inline at the top of the new file (do not add it to `test/fixtures/helpers.ts` unless another file will need it).

- [ ] **Step 2: Remove both blocks from `test/lib.test.ts`**

- [ ] **Step 3: Run to verify**

Run: `bun test test/unit/render.test.ts test/lib.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/unit/render.test.ts test/lib.test.ts
git commit -m "test: move emojiFor and renderDigest tests to test/unit/render.test.ts"
```

---

## Task 7: Move translateDeepL tests to `test/unit/translate.test.ts`

**Files:**
- Create: `test/unit/translate.test.ts`
- Modify: `test/lib.test.ts`

The translateDeepL tests depend on the local `deeplServer`, `setupDeepLSuccess`, `setupDeepLStatus`, `setupDeepLNetworkError`, and `restoreDeepLUrl` helpers defined at the top of `test/lib.test.ts` (lines 23-67). These move with the tests.

- [ ] **Step 1: Write `test/unit/translate.test.ts`**

```ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import type { Server } from 'bun';
import { translateDeepL } from '../../src/translate';

type DeepLHandler = (req: Request) => Response | Promise<Response>;

let deeplHandler: DeepLHandler = () => new Response('Not configured', { status: 500 });
let deeplServer: Server;

beforeAll(() => {
  deeplServer = Bun.serve({
    port: 0,
    fetch(req) {
      return deeplHandler(req);
    },
  });
  process.env.DEEPL_API_URL = `http://localhost:${deeplServer.port}/translate`;
});

afterAll(() => {
  deeplServer.stop(true);
  delete process.env.DEEPL_API_URL;
});

function setupDeepLSuccess(translations: string[]): void {
  deeplHandler = async () => new Response(
    JSON.stringify({ translations: translations.map((text) => ({ detected_source_language: 'EN', text })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function setupDeepLStatus(status: number): void {
  deeplHandler = async () => new Response('Error', { status });
}

function setupDeepLNetworkError(): void {
  process.env.DEEPL_API_URL = 'http://localhost:1/translate';
}

function restoreDeepLUrl(): void {
  process.env.DEEPL_API_URL = `http://localhost:${deeplServer.port}/translate`;
}

describe('translateDeepL', () => {
  // ...paste the translateDeepL describe block body from test/lib.test.ts here, unchanged...
});
```

- [ ] **Step 2: Remove the translateDeepL describe block AND the DeepL server setup (lines 23-67 region) from `test/lib.test.ts`**

Note: the runDigest tests in `lib.test.ts` may also use this DeepL server. If so, keep the setup in `lib.test.ts` for now — it will move to `pipeline.test.ts` in Task 9. After that move, the helpers exist in two test files, which is fine — they are small and each file owns its own server on port 0.

- [ ] **Step 3: Run to verify**

Run: `bun test test/unit/translate.test.ts test/lib.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/unit/translate.test.ts test/lib.test.ts
git commit -m "test: move translateDeepL tests to test/unit/translate.test.ts"
```

---

## Task 8: Move buildDigest tests to `test/integration/digest.test.ts`

**Files:**
- Create: `test/integration/digest.test.ts`
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Write `test/integration/digest.test.ts`**

Header:

```ts
import { describe, expect, test } from 'bun:test';
import { buildDigest } from '../../src/digest';
import type { RssItem } from '../../src/rss';
```

Copy the `describe('buildDigest', ...)` block unchanged.

- [ ] **Step 2: Remove the block from `test/lib.test.ts`**

- [ ] **Step 3: Run to verify**

Run: `bun test test/integration/digest.test.ts test/lib.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/integration/digest.test.ts test/lib.test.ts
git commit -m "test: move buildDigest tests to test/integration/digest.test.ts"
```

---

## Task 9: Move runDigest tests and add end-to-end fixture test

**Files:**
- Create: `test/integration/pipeline.test.ts`
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Write `test/integration/pipeline.test.ts`**

This file needs its own DeepL server because the runDigest tests exercise translation. Start with the same server scaffolding as Task 7:

```ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'bun';
import { runDigest } from '../../src/pipeline';

type DeepLHandler = (req: Request) => Response | Promise<Response>;

let deeplHandler: DeepLHandler = () => new Response('Not configured', { status: 500 });
let deeplServer: Server;

beforeAll(() => {
  deeplServer = Bun.serve({
    port: 0,
    fetch(req) {
      return deeplHandler(req);
    },
  });
  process.env.DEEPL_API_URL = `http://localhost:${deeplServer.port}/translate`;
});

afterAll(() => {
  deeplServer.stop(true);
  delete process.env.DEEPL_API_URL;
});

function setupDeepLSuccess(translations: string[]): void {
  deeplHandler = async () => new Response(
    JSON.stringify({ translations: translations.map((text) => ({ detected_source_language: 'EN', text })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function setupDeepLStatus(status: number): void {
  deeplHandler = async () => new Response('Error', { status });
}

describe('runDigest', () => {
  // ...paste the runDigest describe block body from test/lib.test.ts here, unchanged...
});

describe('runDigest end-to-end fixture', () => {
  const sampleXml = readFileSync(
    join(import.meta.dir, '..', 'fixtures', 'sample-feed.xml'),
    'utf-8',
  );

  test('renders digest end-to-end from fixture feed', async () => {
    const result = await runDigest({
      xml: sampleXml,
      seenKeys: new Set(),
      hours: 48,
      limit: 5,
      now: new Date('2026-04-15T12:00:00Z'),
      region: 'uae',
    });

    // Contract: the output is a non-empty rendered digest
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toContain('UAE');

    // Contract: at least one item survives scoring + dedup
    expect(result.digest.length).toBeGreaterThan(0);

    // Contract: near-duplicate items (sample-feed.xml items 1 and 4) are deduped
    // to one entry — the fixture has 5 raw items, we expect ≤ 4 after dedup.
    expect(result.digest.length).toBeLessThanOrEqual(4);

    // Contract: seen-keys are advanced by exactly the digest items
    expect(result.nextSeenKeys.size).toBe(result.digest.length);

    // Contract: at least one item is from a tier-1 source (Reuters or BBC are in the fixture)
    const sources = result.digest.map((d) => d.source);
    expect(sources.some((s) => s === 'Reuters' || s === 'BBC')).toBe(true);
  });
});
```

The new `'renders digest end-to-end from fixture feed'` test is the canonical behavior test that must survive Spec A's refactor without modification.

- [ ] **Step 2: Remove the runDigest describe block AND the remaining DeepL server setup from `test/lib.test.ts`**

At this point `test/lib.test.ts` should be nearly empty — only the imports and possibly a leftover `beforeAll`/`afterAll` that is no longer referenced.

- [ ] **Step 3: Run to verify**

Run: `bun test test/integration/pipeline.test.ts test/lib.test.ts`
Expected: all pass. The new end-to-end test passes.

- [ ] **Step 4: Commit**

```bash
git add test/integration/pipeline.test.ts test/lib.test.ts
git commit -m "test: move runDigest tests and add end-to-end fixture test"
```

---

## Task 10: Delete `test/lib.test.ts`

**Files:**
- Delete: `test/lib.test.ts`

- [ ] **Step 1: Verify `test/lib.test.ts` has no remaining test cases**

Run: `grep -c "^  test\|^  it" test/lib.test.ts`
Expected: `0`

If nonzero, stop and investigate — a describe block was missed in an earlier task.

- [ ] **Step 2: Delete the file**

```bash
rm test/lib.test.ts
```

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: all tests pass. Assertion count is equal to or greater than the pre-reshape baseline. No test file is larger than 200 lines — verify with:

```bash
wc -l test/unit/*.ts test/integration/*.ts test/cli.test.ts
```

Expected: each number is < 200.

- [ ] **Step 4: Commit**

```bash
git add test/lib.test.ts
git commit -m "test: delete obsolete test/lib.test.ts after split"
```

---

## Task 11: Add CLI timeout error-path test

**Files:**
- Modify: `test/cli.test.ts`

The existing `test/cli.test.ts` already has a local `Bun.serve` mock. Add a handler that hangs forever (never responds), then run the CLI against it with a tiny `--timeout-ms`.

- [ ] **Step 1: Add a hanging handler to the mock server**

In `test/cli.test.ts`, inside the `beforeAll` fetch handler (around line 33), add a new route before the final `Not Found` return:

```ts
if (url.pathname === '/rss/hang') {
  return new Promise<Response>(() => {
    // Intentionally never resolves — the CLI's timeout must fire.
  });
}
```

- [ ] **Step 2: Write the failing test**

Add this test inside the `describe('CLI integration', ...)` block in `test/cli.test.ts`:

```ts
test('RSS timeout shows timeout message and exits 1', async () => {
  const stateFile = tmpStateFile();
  const { stderr, exitCode } = await run([
    '--rss-url', `${baseUrl}/rss/hang`,
    '--state-file', stateFile,
    '--timeout-ms', '200',
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain('did not respond within the timeout');
});
```

- [ ] **Step 3: Run the test**

Run: `bun test test/cli.test.ts`
Expected: the new test passes. The 200ms timeout fires, the CLI's error handler maps `TimeoutError`/`AbortError` to the "did not respond within the timeout" message (see `src/index.ts:157`).

- [ ] **Step 4: Commit**

```bash
git add test/cli.test.ts
git commit -m "test: add CLI timeout error-path test"
```

---

## Task 12: Add CLI network-failure error-path test

**Files:**
- Modify: `test/cli.test.ts`

Strategy: point the CLI at an RSS URL on a port with no listener (`http://localhost:1/rss`), which produces `ECONNREFUSED`. `src/index.ts:159` maps that to "Could not reach news.google.com". This pattern is already used in `test/lib.test.ts`'s `setupDeepLNetworkError` helper.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('CLI integration', ...)` block in `test/cli.test.ts`:

```ts
test('RSS network failure shows network message and exits 1', async () => {
  const stateFile = tmpStateFile();
  const { stderr, exitCode } = await run([
    // Port 1 is never listening → ECONNREFUSED.
    '--rss-url', 'http://localhost:1/rss',
    '--state-file', stateFile,
    '--timeout-ms', '2000',
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain('Could not reach news.google.com');
});
```

- [ ] **Step 2: Run the test**

Run: `bun test test/cli.test.ts`
Expected: the new test passes.

If the assertion fails because the error handler's network-detection substring does not match what `fetch` throws on this machine, read `src/index.ts:159` and adjust the expectation to match one of the substrings that branch checks for (`ENOTFOUND`, `ECONNREFUSED`, `fetch failed`, or `NetworkError`). Do not modify `src/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add test/cli.test.ts
git commit -m "test: add CLI network-failure error-path test"
```

---

## Task 13: Final verification

**Files:** none

- [ ] **Step 1: Run the full suite**

Run: `bun test`
Expected: all tests pass. Compare assertion count to the pre-reshape baseline (captured before Task 1). The new count should be baseline + at least 3 (one end-to-end fixture test, two CLI error-path tests).

- [ ] **Step 2: Verify offline behavior**

Run: `bun test` with network disabled (airplane mode, or block outbound via firewall). If that's not feasible, manually grep for real hosts:

Run: `grep -rE "https?://(?!localhost|example\.com)" test/ | grep -v "\.md:"`
Expected: no matches except for URLs that are only used as string literals in assertions (not as fetch targets). Any real URL used as a fetch target is a bug.

- [ ] **Step 3: Verify file sizes**

Run: `wc -l test/unit/*.ts test/integration/*.ts test/cli.test.ts test/fixtures/*.ts`
Expected: every file < 200 lines.

- [ ] **Step 4: Verify lib.test.ts is gone**

Run: `test -f test/lib.test.ts && echo "STILL EXISTS" || echo "DELETED"`
Expected: `DELETED`

- [ ] **Step 5: No commit needed unless verification caught a fix**

If verification surfaced a fix, commit it with:

```bash
git add -u
git commit -m "test: final verification fixes"
```

Otherwise, the reshape is complete.
