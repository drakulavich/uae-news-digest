# Test Reshape (Spec B)

**Status:** Draft
**Date:** 2026-04-15
**Scope:** Test suite only — no source changes

## Motivation

`test/lib.test.ts` is 588 lines — larger than all of `src/` combined (~750 LOC split across 12 files). It predates the module split from PR #5 and still mirrors the old monolithic `lib.ts`. As a result:

- Tests are coupled to internal function shapes rather than observable behavior, so refactors break tests for the wrong reasons.
- The file is too large to reason about as a unit, and failures are hard to localize.
- CLI error paths in `src/index.ts:154-164` (timeout, network failure, HTTP errors) are not exercised — exactly the code most likely to break in production.
- There is no single integration test that asserts the *rendered digest output* end-to-end, which is the canonical behavior users depend on.

This spec reshapes the test suite to assert behavior, mirror the module layout, and cover CLI error paths. It is scaffolding for the upcoming Spec A (pipeline + config refactor), which needs behavior-level tests in place before internals can be safely reshaped.

## Goals

1. Split `test/lib.test.ts` into per-module test files that mirror `src/`.
2. Add one integration test that drives `runDigest` end-to-end with a fixture feed and asserts the rendered output string.
3. Add three CLI error-path tests covering timeout, network failure, and HTTP error branches.
4. Keep all tests offline — HTTP stubbed via `globalThis.fetch` override, per existing project rule.

## Non-Goals

- No changes to `src/`.
- No new test framework, runner, or snapshot library.
- No removal of existing assertions — only relocation.
- No coverage tooling or metrics.
- No test for `healthcheck` subcommand (Spec A territory).

## Target Structure

```
test/
├── unit/
│   ├── rss.test.ts          # parseRss
│   ├── scoring.test.ts      # scoreItem
│   ├── normalize.test.ts    # titleSimilarity
│   ├── render.test.ts       # emojiFor + renderDigest
│   └── translate.test.ts    # translateDeepL (fetch stubbed)
├── integration/
│   ├── digest.test.ts       # buildDigest with realistic inputs
│   └── pipeline.test.ts     # runDigest with fixture XML → rendered string
├── cli/
│   └── cli.test.ts          # existing happy-path + 3 new error-path tests
└── fixtures/
    ├── sample-feed.xml      # hand-crafted RSS, ~5 items across scoring tiers
    └── helpers.ts           # makeItem, withFakeFetch, freezeNow
```

### Mapping from current `lib.test.ts`

| Current describe block | Destination file |
|---|---|
| `parseRss` (lines 71-107) | `test/unit/rss.test.ts` |
| `buildDigest` (109-165) | `test/integration/digest.test.ts` |
| `scoreItem` (167-225) | `test/unit/scoring.test.ts` |
| `titleSimilarity` (227-250) | `test/unit/normalize.test.ts` |
| `emojiFor` (252-298) | `test/unit/render.test.ts` |
| `translateDeepL` (300-366) | `test/unit/translate.test.ts` |
| `renderDigest` (368-436) | `test/unit/render.test.ts` |
| `runDigest` (438-end) | `test/integration/pipeline.test.ts` |

After the move, `test/lib.test.ts` is deleted.

## New Tests

### Integration: `pipeline.test.ts`

One canonical test that drives `runDigest` from a fixture XML string through to the rendered output and asserts the full string:

```ts
import { runDigest } from '../../src/pipeline';
import sampleXml from '../fixtures/sample-feed.xml' with { type: 'text' };

test('renders digest end-to-end from fixture feed', async () => {
  const result = await runDigest({
    xml: sampleXml,
    seenKeys: new Set(),
    hours: 48,
    limit: 5,
    now: new Date('2026-04-15T12:00:00Z'),
    region: 'uae',
  });

  expect(result.output).toContain('UAE News Digest');
  expect(result.output).toContain('— Reuters');
  expect(result.digest.length).toBeGreaterThan(0);
  expect(result.nextSeenKeys.size).toBe(result.digest.length);
});
```

This test touches no internal function — it is the contract that must survive Spec A.

The existing `runDigest` describe block's finer-grained assertions (DeepL happy path, DeepL failure fallback, skip-when-no-targetLang) are retained and moved into the same file as separate `test` cases, so no assertions are lost.

### CLI error paths: additions to `cli.test.ts`

Three new tests, each injecting a failing `fetch` before spawning the CLI:

1. **Timeout** — `fetch` throws `TimeoutError`; assert exit code 1 and stderr contains `"did not respond within the timeout"`.
2. **Network failure** — `fetch` throws `ENOTFOUND`; assert stderr contains `"Could not reach news.google.com"`.
3. **HTTP 500** — `fetch` resolves with `{ ok: false, status: 500, statusText: 'Server Error' }`; assert stderr contains `"RSS fetch failed: HTTP 500"`.

These tests follow whatever pattern `test/cli.test.ts` already uses to spawn the CLI (likely `Bun.spawn` on `src/index.ts`). The `fetch` stub is installed in the spawned process via an env var or a small preload script — exact mechanism is an implementation detail to be decided during the plan phase, but must not make real network calls.

## Test Infrastructure

### `test/fixtures/helpers.ts`

Small, framework-free helpers:

```ts
export function makeItem(overrides: Partial<RssItem> = {}): RssItem { ... }
export function withFakeFetch(handler: (url: string) => Response | Promise<Response>): () => void
export function freezeNow(iso: string): Date
```

`withFakeFetch` returns a disposer that restores `globalThis.fetch`, so tests can use it with `beforeEach`/`afterEach`.

### `test/fixtures/sample-feed.xml`

Hand-crafted RSS document with approximately 5 items:
- One from a tier-1 international source (Reuters)
- One from a tier-2 regional source (Khaleej Times)
- One from a tier-3 local source
- One that mentions "UAE" in the title (for scoring)
- One that should be deduped against another (near-identical titles from different sources)

Dates chosen so that `now = 2026-04-15T12:00:00Z` with `hours = 48` keeps all items in-window.

## Offline Guarantee

All tests must pass with no network access. Verification: `bun test` succeeds when run with the machine offline. The existing `translateDeepL` tests already stub `globalThis.fetch`; the new pipeline test takes XML as a string (no fetch); CLI error-path tests stub `fetch` in the spawned process. No test imports anything that would make a real network call.

## Success Criteria

- `bun test` passes with the same assertion count as before (or higher, due to new tests).
- No test file exceeds 200 lines.
- `test/lib.test.ts` is deleted.
- `bun test` passes on airplane mode (manual verification).
- The new `pipeline.test.ts` integration test passes without modification after Spec A lands (forward-compatibility check during Spec A's plan).

## Risks and Mitigations

- **Risk:** Moving tests introduces subtle import-path breakage. **Mitigation:** Move one describe block at a time, run `bun test` after each move.
- **Risk:** CLI error-path tests flake due to subprocess timing. **Mitigation:** Use explicit `await` on subprocess exit, no sleeps.
- **Risk:** The fixture XML drifts from Google News RSS shape over time. **Mitigation:** The fixture is hand-crafted to the *parser's* expectations, not Google's — it's a contract with `parseRss`, not with Google. If Google changes, `parseRss` changes, and the fixture updates with it.

## Out of Scope (Deferred to Spec A)

- Reshaping `runDigest` into explicit pipeline stages.
- Typed discriminated config for translation.
- Splitting `runDigest` return into separate data and format APIs.
- Any change to `src/lib.ts` (the barrel).
