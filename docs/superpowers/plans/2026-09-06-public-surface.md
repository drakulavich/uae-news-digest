# Public Surface, Layout and 1.0.0 (PR 4 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the final file layout (`src/pipeline/*`, `src/output/*`), the final `@drakulavich/uae-news-digest/core` surface, delete `src/lib.ts`, pay the small debts left by the PR 2 and PR 3 reviews, bring every doc (README, CHANGELOG, CLAUDE.md, openspec) in line with the code, and bump the version to 1.0.0.

**Architecture:** Pure moves plus one rename: `buildDigestWithStats` becomes `selectItems(rssItems, topic, ctx)` in `src/pipeline/select.ts`; `titleSimilarity` moves out of `scoring.ts` into `pipeline/similarity.ts`; `render.ts` splits into `output/text.ts` and `output/emoji.ts`; `json.ts` becomes `output/json.ts` with the shared `hoursAgo` helper in `output/time.ts`; `pipeline.ts` becomes `pipeline/run.ts`. `core.ts` re-exports exactly the spec's public list; everything else is internal and imported by concrete path. `resolveConfig` gets its own `src/cli/config.ts`. No behaviour changes except the five listed debts, each pinned by a test.

**Tech Stack:** Bun (runtime, `bun test`, `Bun.serve`, `Bun.spawn`), TypeScript strict, `commander` 15, `zod` 4, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-unified-config-refactor-design.md` — section 4 "File layout and tests" (layout, `lib.ts` deleted, tests), the "Public `/core` after the refactor" list at the end of section 2, and "Staging" item 4. Deviations from the spec's layout, all additive: `src/pipeline/terms.ts` (the term matcher did not exist when the spec was written), `src/output/time.ts` (`hoursAgo`, shared by text and JSON), `src/cli/config.ts` (`resolveConfig`, shared by three commands). Recorded here as rulings.

**Base:** `main` at `abc72b2` (PR 3 merged). Baseline: 221 tests, typecheck clean, smoke:pack exit 0.

## Global Constraints

- Bun-only runtime (`Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.serve`); `node:fs/promises` stays only where `src/state.ts` already uses it. No build step; `bin` stays `./src/index.ts`.
- TypeScript strict; relative imports; no barrel imports inside `src/` (internal code imports concrete modules, never `./core`).
- Heuristics and region knowledge only in `src/config/default.json`.
- stdout results only; progress and errors on stderr. Error messages: what failed, why, what to do. Existing message texts asserted by tests stay character for character.
- No `process.exit` under `src/cli/`; `src/index.ts` is the only file touching `process.exitCode` and must keep mode 100755 (edit in place, never recreate).
- Use `git mv` for every move so history follows the file.
- Before every commit: `bun run typecheck && bun test && bun run smoke:pack` green; test count never drops below the previous task's count (221 at the start) except where a task says a test is deleted or merged.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012vhmvw58yLQtdrK7QnxKVo
  ```
- No new dependencies.

---

### Task 0: Worktree and plan (controller)

Done by the controller: worktree `/Users/anton/Personal/repos/uae-news-digest-public-surface`, branch `refactor/public-surface` from `main` (`abc72b2`); this plan committed as the first commit.

---

### Task 1: `src/pipeline/` — move the pipeline modules, rename `buildDigestWithStats` → `selectItems`

**Files:**
- Move (`git mv`): `src/pipeline.ts` → `src/pipeline/run.ts`; `src/digest.ts` → `src/pipeline/select.ts`; `src/scoring.ts` → `src/pipeline/scoring.ts`; `src/importance.ts` → `src/pipeline/importance.ts`; `src/normalize.ts` → `src/pipeline/normalize.ts`; `src/rss.ts` → `src/pipeline/rss.ts`; `src/url.ts` → `src/pipeline/url.ts`; `src/terms.ts` → `src/pipeline/terms.ts`.
- Create: `src/pipeline/similarity.ts` (extracted from `scoring.ts`).
- Move: `test/integration/digest.test.ts` → `test/integration/select.test.ts`; `test/unit/scoring.test.ts` keeps its name but its `titleSimilarity` block moves to a new `test/unit/similarity.test.ts`.
- Delete: `test/fixtures/helpers.ts` (`makeItem`, `freezeNow` — no importer anywhere; verified with grep before writing this plan).
- Modify: every importer listed in Step 3.

**Interfaces:**
- Produces (`src/pipeline/select.ts`):
  ```ts
  export type SelectContext = { seenKeys: Set<string>; hours: number; now: Date; heuristics: Heuristics; limitOverride?: number };
  export type SelectResult = { items: DigestItem[]; droppedByMatch: number };
  export function selectItems(rssItems: RssItem[], topic: Pick<Topic, 'match' | 'matchMode' | 'limit'>, ctx: SelectContext): SelectResult
  export function matchTerms(title: string, match: string[], mode: MatchMode): { ok: boolean; matchedTerms: string[] }   // unchanged
  export function parsePubDate(pubDate: string | undefined): Date | null                                                  // unchanged
  export type DigestItem                                                                                                   // unchanged
  ```
  `buildDigest` and `buildDigestWithStats` and `BuildDigestOptions` are deleted.
- Produces (`src/pipeline/similarity.ts`): `export function titleSimilarity(a: string, b: string, dedupe: DedupeConfig | undefined): number` (moved verbatim with its private `extractWords`).
- Consumed by Task 2 (`output/*` import `DigestItem` from `../pipeline/select`, `DigestResult` from `../pipeline/run`, `importanceThreshold` from `../pipeline/importance`, `matchesTerm` from `../pipeline/terms`) and Task 3 (`core.ts`).

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/pipeline
git mv src/pipeline.ts src/pipeline/run.ts
git mv src/digest.ts src/pipeline/select.ts
git mv src/scoring.ts src/pipeline/scoring.ts
git mv src/importance.ts src/pipeline/importance.ts
git mv src/normalize.ts src/pipeline/normalize.ts
git mv src/rss.ts src/pipeline/rss.ts
git mv src/url.ts src/pipeline/url.ts
git mv src/terms.ts src/pipeline/terms.ts
git mv test/integration/digest.test.ts test/integration/select.test.ts
git rm -q test/fixtures/helpers.ts
```

- [ ] **Step 2: Extract `similarity.ts` from `scoring.ts`**

`src/pipeline/similarity.ts`:

```ts
import type { DedupeConfig } from '../config/schema';

function extractWords(title: string, dedupe: DedupeConfig | undefined): string[] {
  const synonyms = dedupe?.synonyms ?? {};
  const stop = new Set(dedupe?.stopWords ?? []);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    // hasOwn: a plain object inherits keys like "constructor" that must not act as synonyms.
    .map((w) => (Object.hasOwn(synonyms, w) ? synonyms[w]! : w))
    .filter((w) => w.length > 1 && !stop.has(w));
}

/** Jaccard similarity over synonym-normalised, stop-word-filtered title words. */
export function titleSimilarity(a: string, b: string, dedupe: DedupeConfig | undefined): number {
  const wa = new Set(extractWords(a, dedupe));
  const wb = new Set(extractWords(b, dedupe));
  // No words to compare (e.g. non-Latin titles under ASCII extraction): only a verbatim repeat counts as a duplicate.
  if (wa.size === 0 || wb.size === 0) return a === b && a.length > 0 ? 1 : 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}
```

Copy the bodies from the current `scoring.ts` rather than retyping if they differ in whitespace; the logic above is the current logic. Then delete `extractWords` and `titleSimilarity` from `src/pipeline/scoring.ts`, leaving `scoreItem` and its imports (`matchesTerm` from `./terms`, `ScoringConfig` type).

- [ ] **Step 3: Rename `buildDigestWithStats` → `selectItems` in `src/pipeline/select.ts`**

Replace the `BuildDigestOptions` / `BuildDigestResult` types and the two functions with:

```ts
export type SelectContext = {
  seenKeys: Set<string>;
  hours: number;
  now: Date;
  heuristics: Heuristics;
  /** CLI --limit: when given, caps this topic instead of its own `limit`. */
  limitOverride?: number;
};

export type SelectResult = { items: DigestItem[]; droppedByMatch: number };

/**
 * One topic's selection: window, skip list, match filter, scoring, exact + fuzzy dedupe, limit.
 * `topic` supplies match/matchMode/limit; `ctx` supplies the run-wide state and heuristics.
 */
export function selectItems(
  rssItems: RssItem[],
  topic: Pick<Topic, 'match' | 'matchMode' | 'limit'>,
  ctx: SelectContext,
): SelectResult {
  const { seenKeys, hours, now, heuristics } = ctx;
  const limit = ctx.limitOverride ?? topic.limit;
  const match = topic.match;
  const matchMode = topic.matchMode ?? 'all';
  // …the existing body of buildDigestWithStats from `const skip = …` to `return { items: result, droppedByMatch };`, unchanged,
  // with `items` (the RssItem[] parameter) renamed to `rssItems` in the for-loop header.
}
```

Delete `buildDigest`. Import `Topic` type from `../config/schema` (alongside `Heuristics`, `MatchMode`, `DEFAULT_SIMILARITY_THRESHOLD`); `titleSimilarity` now comes from `./similarity`, `scoreItem` from `./scoring`. Update `src/pipeline/run.ts`:

```ts
import { parseRss } from './rss';
import { selectItems } from './select';
import { buildFeedUrl } from './url';
import type { DigestItem } from './select';
import type { DigestConfig, Topic } from '../config/schema';
…
    const { items, droppedByMatch } = selectItems(rssItems, topic, {
      seenKeys: seen,
      hours: opts.hours,
      now,
      heuristics: config,
      limitOverride: opts.limitOverride,
    });
```

- [ ] **Step 4: Rewrite imports everywhere**

Inside `src/pipeline/*`: `'./config/schema'` → `'../config/schema'`; sibling imports stay `./x` (`./terms`, `./normalize`, `./importance`, `./scoring`, `./similarity`, `./rss`, `./url`, `./select`).

Elsewhere, apply this table (grep for each old specifier and replace):

| Old specifier | New specifier | Files |
|---|---|---|
| `./pipeline` (from `src/`) / `../pipeline` (from `src/cli`, `src/output` later) / `../../src/pipeline` (tests) | `./pipeline/run` / `../pipeline/run` / `../../src/pipeline/run` | `src/core.ts`, `src/lib.ts`, `src/json.ts`, `src/render.ts`, `src/cli/adapters.ts`, `src/cli/run.ts`, `test/integration/pipeline.test.ts`, `test/unit/json.test.ts`, `test/unit/render.test.ts` |
| `./digest` / `../../src/digest` | `./pipeline/select` / `../../src/pipeline/select` | `src/core.ts`, `src/lib.ts`, `src/json.ts`, `src/render.ts`, `test/integration/select.test.ts`, `test/unit/json.test.ts`, `test/unit/render.test.ts` |
| `./scoring` / `../../src/scoring` | `./pipeline/scoring` (+ `./pipeline/similarity` for `titleSimilarity`) | `src/core.ts`, `src/lib.ts`, `test/unit/scoring.test.ts` |
| `./importance` / `../../src/importance` | `./pipeline/importance` / `../../src/pipeline/importance` | `src/core.ts`, `src/lib.ts`, `src/json.ts`, `src/render.ts`, `test/unit/importance.test.ts` |
| `./normalize` / `../../src/normalize` | `./pipeline/normalize` / `../../src/pipeline/normalize` | `src/core.ts`, `src/lib.ts`, `test/integration/select.test.ts` |
| `./rss` / `../../src/rss` | `./pipeline/rss` / `../../src/pipeline/rss` | `src/core.ts`, `src/lib.ts`, `test/unit/rss.test.ts`, `test/integration/select.test.ts` |
| `./url` / `../url` / `../../src/url` | `./pipeline/url` / `../pipeline/url` / `../../src/pipeline/url` | `src/core.ts`, `src/lib.ts`, `src/cli/commands.ts`, `test/unit/url.test.ts` |
| `./terms` / `../../src/terms` | `./pipeline/terms` / `../../src/pipeline/terms` | `src/render.ts`, `src/lib.ts`, `test/unit/terms.test.ts` |

`src/core.ts` and `src/lib.ts` keep exporting the same names for now (Task 3 rewrites `core.ts` and deletes `lib.ts`); only their specifiers change, plus `buildDigest`/`buildDigestWithStats`/`BuildDigestOptions` become `selectItems`/`SelectContext`/`SelectResult`.

- [ ] **Step 5: Update the tests**

`test/integration/select.test.ts`: import `{ selectItems, matchTerms }` from `'../../src/pipeline/select'`; every `buildDigest(items, { seenKeys, hours, limit: N, now, heuristics })` becomes `selectItems(items, { limit: N }, { seenKeys, hours, now, heuristics }).items`; every `buildDigestWithStats(items, { …, match, matchMode, limit })` becomes `selectItems(items, { match, matchMode, limit }, { seenKeys, hours, now, heuristics })`. Rename the `describe` labels: `'buildDigest'` → `'selectItems'`, `'buildDigestWithStats match filter'` → `'selectItems match filter'`, `'buildDigest heuristics come from the config'` → `'selectItems heuristics come from the config'`. Fix the comment on the empty-match test (`selectItems guards empty arrays`). Assertions unchanged.

`test/unit/similarity.test.ts` (new): move the whole `describe('titleSimilarity', …)` block out of `test/unit/scoring.test.ts` verbatim, importing `titleSimilarity` from `'../../src/pipeline/similarity'`, `DEFAULT_CONFIG` from `'../../src/config/load'`, `DedupeConfig` type from `'../../src/config/schema'`. `scoring.test.ts` keeps the two `scoreItem` blocks and drops the now-unused imports.

- [ ] **Step 6: Verify**

Run: `bun run typecheck && bun test && bun run smoke:pack`
Expected: typecheck clean; `221 pass` (moves only — same count); smoke exit 0. `git status` shows renames (R) for the eight modules, not delete+add. `grep -rn "buildDigest" src test scripts` → no hits.

- [ ] **Step 7: Commit**

```bash
git add -A src test
git commit -m "refactor(pipeline): move pipeline modules under src/pipeline, selectItems replaces buildDigestWithStats"
```

---

### Task 2: `src/output/` — text, JSON, emoji, time

**Files:**
- Move: `src/render.ts` → `src/output/text.ts`; `src/json.ts` → `src/output/json.ts`.
- Create: `src/output/emoji.ts` (`emojiFor`), `src/output/time.ts` (`hoursAgo`).
- Move: `test/unit/render.test.ts` → `test/unit/text.test.ts` (its `emojiFor` block moves to new `test/unit/emoji.test.ts`); `test/unit/json.test.ts` stays (its `hoursAgo` test moves to new `test/unit/time.test.ts`).
- Modify importers: `src/core.ts`, `src/lib.ts`, `src/cli/run.ts`, tests.

**Interfaces:**
- Produces: `src/output/emoji.ts`: `export function emojiFor(title: string, rules: readonly EmojiRule[] | undefined): string`; `src/output/time.ts`: `export function hoursAgo(publishedAt: Date, now: Date): number`; `src/output/text.ts`: `export function renderText(result: DigestResult, config: DigestConfig, now: Date): string`; `src/output/json.ts`: `toJson`, `DigestJson`, `DigestJsonItem`, `JsonMeta` (no longer exports `hoursAgo`).

- [ ] **Step 1: Move and split**

```bash
mkdir -p src/output
git mv src/render.ts src/output/text.ts
git mv src/json.ts src/output/json.ts
git mv test/unit/render.test.ts test/unit/text.test.ts
```

`src/output/emoji.ts`:

```ts
import { matchesTerm } from '../pipeline/terms';
import type { EmojiRule } from '../config/schema';

/** First rule whose term appears in the title wins; no rules or no match → "•". */
export function emojiFor(title: string, rules: readonly EmojiRule[] | undefined): string {
  const rule = rules?.find((r) => r.terms.some((t) => matchesTerm(title, t)));
  return rule?.emoji ?? '•';
}
```

`src/output/time.ts`:

```ts
/** Whole hours between publication and `now`, rounded to nearest. */
export function hoursAgo(publishedAt: Date, now: Date): number {
  return Math.round((now.getTime() - publishedAt.getTime()) / 3_600_000);
}
```

`src/output/text.ts`: delete `emojiFor` and the `matchesTerm`/`EmojiRule`-only imports it needed (keep `EmojiRule` if `itemLine`'s parameter type still uses it); import `emojiFor` from `'./emoji'`, `hoursAgo` from `'./time'`, `importanceThreshold` from `'../pipeline/importance'`, `DigestItem` type from `'../pipeline/select'`, `DigestResult` type from `'../pipeline/run'`, `DigestConfig` type from `'../config/schema'`.

`src/output/json.ts`: delete the `hoursAgo` function; import it from `'./time'`; `DigestResult` type from `'../pipeline/run'`; `ImportanceTier` type from `'../pipeline/importance'`.

- [ ] **Step 2: Rewrite importers**

| Old | New | Files |
|---|---|---|
| `./render` (`renderText`, `emojiFor`) | `./output/text` and `./output/emoji` | `src/core.ts`, `src/lib.ts` |
| `../render` | `../output/text` | `src/cli/run.ts` |
| `./json` (`toJson`, `hoursAgo`, types) | `./output/json` and `./output/time` | `src/core.ts`, `src/lib.ts` |
| `../json` | `../output/json` | `src/cli/run.ts` |
| `../../src/render` | `../../src/output/text` (+ `../../src/output/emoji`) | `test/unit/text.test.ts` |
| `../../src/json` | `../../src/output/json` (+ `../../src/output/time`) | `test/unit/json.test.ts` |

- [ ] **Step 3: Split the tests**

`test/unit/emoji.test.ts`: move `describe('emojiFor with the default rules', …)` (and any other `emojiFor`-only block) out of `text.test.ts` verbatim; imports: `emojiFor` from `'../../src/output/emoji'`, `DEFAULT_CONFIG` from `'../../src/config/load'`. `test/unit/time.test.ts`: move the `hoursAgo` test (`'rounds to the nearest hour'`) out of `json.test.ts` into a `describe('hoursAgo', …)`, importing from `'../../src/output/time'`. Drop unused imports left behind.

- [ ] **Step 4: Verify and commit**

Run: `bun run typecheck && bun test && bun run smoke:pack` — expected `221 pass`, smoke exit 0, `git status` shows renames.

```bash
git add -A src test
git commit -m "refactor(output): move renderers under src/output; emoji and hoursAgo get their own modules"
```

---

### Task 3: Final `core.ts`, delete `lib.ts`, `cli/config.ts`

**Files:**
- Rewrite: `src/core.ts`
- Delete: `src/lib.ts`
- Create: `src/cli/config.ts`; Modify: `src/cli/run.ts`, `src/cli/commands.ts`
- Create: `test/unit/core-surface.test.ts`
- Modify: `scripts/smoke-pack.ts` (core smoke no longer imports `buildFeedUrl`)

**Interfaces:**
- Produces the public surface. Values: `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `runDigest`, `renderText`, `toJson`, `parseRss`, `readSeenKeys`, `writeSeenKeys`, `DEFAULT_STATE_FILE`, `translateDeepL`, `DEEPL_API_URL`. Types: `DigestConfig`, `Topic`, `ResolveConfigOptions`, `RunOptions`, `DigestResult`, `TopicSection`, `FetchText`, `Translate`, `DigestItem`, `DigestJson`, `DigestJsonItem`, `JsonMeta`, `ImportanceTier`, `RssItem`. Ruling: the spec's list plus `parseConfig` (validate a config held in memory — the natural companion of `loadConfig`) and the parameter/return types of the exported functions, which cost nothing and make the surface usable without `Parameters<>` gymnastics. Nothing else — `buildFeedUrl`, `emojiFor`, `hoursAgo`, `scoreItem`, `titleSimilarity`, `scoreImportance`, `importanceThreshold`, `normalize*`, `makeKey`, `selectItems`, `matchTerms`, `parsePubDate`, `DigestConfigSchema`, `Heuristics`, `DeepL*` types are internal.
- `src/cli/config.ts`: `export type CliEnv = Record<string, string | undefined>`; `export async function resolveConfig(explicit: string | undefined, env: CliEnv, cwd: string): Promise<{ config: DigestConfig; source: string }>` (moved verbatim from `run.ts`).

- [ ] **Step 1: Failing surface test**

`test/unit/core-surface.test.ts`:

```ts
import { expect, test } from 'bun:test';

const PUBLIC_VALUES = [
  'DEEPL_API_URL',
  'DEFAULT_CONFIG',
  'DEFAULT_STATE_FILE',
  'loadConfig',
  'parseConfig',
  'parseRss',
  'readSeenKeys',
  'renderText',
  'resolveConfigPath',
  'runDigest',
  'toJson',
  'translateDeepL',
  'writeSeenKeys',
];

test('@drakulavich/uae-news-digest/core exports exactly the documented values', async () => {
  const core = await import('../../src/core');
  expect(Object.keys(core).sort()).toEqual(PUBLIC_VALUES);
});

test('src/lib.ts is gone and nothing imports it', async () => {
  expect(await Bun.file(new URL('../../src/lib.ts', import.meta.url)).exists()).toBe(false);
});
```

Run: `bun test test/unit/core-surface.test.ts` — expected FAIL (extra exports; `lib.ts` exists).

- [ ] **Step 2: Rewrite `src/core.ts`**

```ts
// The public programmatic API: import from '@drakulavich/uae-news-digest/core'.
// Everything not listed here is internal and may change without notice.
export { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from './config/load';
export type { ResolveConfigOptions } from './config/load';
export { parseConfig } from './config/schema';
export type { DigestConfig, Topic } from './config/schema';
export { runDigest } from './pipeline/run';
export type { RunOptions, DigestResult, TopicSection, FetchText, Translate } from './pipeline/run';
export type { DigestItem } from './pipeline/select';
export type { ImportanceTier } from './pipeline/importance';
export { parseRss } from './pipeline/rss';
export type { RssItem } from './pipeline/rss';
export { renderText } from './output/text';
export { toJson } from './output/json';
export type { DigestJson, DigestJsonItem, JsonMeta } from './output/json';
export { DEFAULT_STATE_FILE, readSeenKeys, writeSeenKeys } from './state';
export { DEEPL_API_URL, translateDeepL } from './translate';
```

```bash
git rm -q src/lib.ts
```

Grep `src test scripts README.md CLAUDE.md openspec` for `lib'` / `lib.ts` — no importer expected (verified before this plan); docs mentions are handled in Task 5.

- [ ] **Step 3: `src/cli/config.ts`**

```ts
import { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from '../config/load';
import type { DigestConfig } from '../config/schema';
import { CliError } from './errors';

export type CliEnv = Record<string, string | undefined>;

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
```

Remove `CliEnv` and `resolveConfig` from `src/cli/run.ts` (import them from `./config`; drop the now-unused `DEFAULT_CONFIG`/`loadConfig`/`resolveConfigPath` imports if nothing else in `run.ts` uses them). In `src/cli/commands.ts` and `src/cli/program.ts` change `from './run'` for `resolveConfig`/`CliEnv` to `from './config'` (`run.ts` still exports `runDefault`, `RunFlags`).

- [ ] **Step 4: `scripts/smoke-pack.ts` core smoke**

Replace the `buildFeedUrl` import and check with a `fetchText` that records the URL:

```ts
import { runDigest, renderText, DEFAULT_CONFIG } from '@drakulavich/uae-news-digest/core';

const xml = ${JSON.stringify(RSS_XML)};
const now = new Date('2026-03-22T08:00:00Z');
let requestedUrl = '';

const result = await runDigest({
  config: DEFAULT_CONFIG,
  seenKeys: new Set(),
  hours: 36,
  limitOverride: 1,
  now,
  fetchText: async (url) => { requestedUrl = url; return xml; },
});

if (!requestedUrl.startsWith('https://news.google.com/rss/search')) {
  throw new Error('runDigest did not request a Google News RSS URL for the built-in topic: ' + requestedUrl);
}
```

Keep the existing `renderText` assertion after it.

- [ ] **Step 5: Verify and commit**

Run: `bun run typecheck && bun test && bun run smoke:pack` — expected `223 pass` (221 + 2), smoke exit 0. `bun run build` once (declarations still emit; remove `dist/`).

```bash
git add -A src test scripts
git commit -m "feat(core): final public surface, delete lib.ts, cli/config.ts owns resolveConfig"
```

---

### Task 4: Small debts from the PR 2 and PR 3 reviews

Five independent edits, batched; each pinned by a test.

**Files:**
- `src/state.ts` (+ `test/unit/state.test.ts` unchanged — the nested-dir test must still pass)
- `src/cli/errors.ts` (+ `test/unit/cli-errors.test.ts`)
- `src/cli/commands.ts`, `src/cli/program.ts` (+ `test/cli/commands.test.ts`)
- `src/translate.ts` (+ `test/unit/translate.test.ts`)
- `.github/workflows/ci.yml`

- [ ] **Step 1: Failing tests**

`test/unit/cli-errors.test.ts`, inside `describe('classifyFetchError', …)`:

```ts
  test('a null or undefined rejection still becomes a network error', () => {
    expect(classifyFetchError(null, ctx).kind).toBe('network');
    expect(classifyFetchError(undefined, ctx).message).toBe('Unable to connect to localhost:1 — check your connection (undefined)');
  });
```

`test/cli/commands.test.ts`, inside `describe('CLI commands', …)`:

```ts
  test('healthcheck honours --timeout-ms', async () => {
    const result = await cli.run(['healthcheck', '--rss-url', `${cli.baseUrl}/rss/hang`, '--timeout-ms', '100']);
    expectExitCode(result, 1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('RSS request timed out after 100ms — retry, or pass --timeout-ms 30000');
  });
```

`test/unit/translate.test.ts` — look at how the existing tests stub the DeepL endpoint (they set `DEEPL_API_URL` to a local `Bun.serve`); add a route or test that returns HTTP 200 with body `not json` and assert:

```ts
  test('a non-JSON 200 body is reported as such', async () => {
    await expect(translateDeepL(['x'], 'key', 'DE')).rejects.toThrow('DeepL returned a non-JSON response');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test test/unit/cli-errors.test.ts test/cli/commands.test.ts test/unit/translate.test.ts` — expected 3 failures (null → TypeError inside the classifier; healthcheck times out after 10 s, i.e. the test's 5 s harness timeout fires or the message shows 10000ms; SyntaxError instead of the new message).

- [ ] **Step 3: `src/state.ts`** — delete the `await mkdir(dir, { recursive: true });` line and `mkdir` from the import. `Bun.write` creates missing parent directories, and the temp file is written into the same directory as the target, so the nested-dir test in `test/unit/state.test.ts` must still pass. Run `bun test test/unit/state.test.ts` immediately; if it fails on this Bun version, keep the `mkdir` and record the finding in the report instead.

- [ ] **Step 4: `src/cli/errors.ts`** — `const e = (err ?? {}) as { name?: string; code?: string; message?: string };` and make the fallback `e.code ?? e.message ?? String(err)` (unchanged, now reached for `null`/`undefined`).

- [ ] **Step 5: healthcheck honours `--timeout-ms`**

`src/cli/commands.ts`: `healthcheck(opts: { rssUrl?: string; config?: string; timeoutMs?: string | number }, env, cwd)`; compute `const timeoutMs = validatePositiveNumber('timeout-ms', opts.timeoutMs ?? 15000);` (import `validatePositiveNumber` from `./run`) and use `makeFetchText(timeoutMs)(rssUrl)`. `src/cli/program.ts` healthcheck action: cast `optsWithGlobals()` as `{ rssUrl?: string; config?: string; timeoutMs?: string | number }` and pass it through. Update the HELP line for `healthcheck` to mention `--timeout-ms`.

- [ ] **Step 6: `src/translate.ts`** — wrap the body parse:

```ts
  let data: DeepLResponse;
  try {
    data = (await response.json()) as DeepLResponse;
  } catch {
    throw new Error('DeepL returned a non-JSON response — retry, or check DEEPL_API_URL');
  }
```

- [ ] **Step 7: `.github/workflows/ci.yml`** — run on every pull request, not only those into `main`:

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

- [ ] **Step 8: Verify and commit**

Run: `bun run typecheck && bun test && bun run smoke:pack` — expected `226 pass` (223 + 3), smoke exit 0.

```bash
git add src/state.ts src/cli/errors.ts src/cli/commands.ts src/cli/program.ts src/translate.ts .github/workflows/ci.yml test/unit/cli-errors.test.ts test/cli/commands.test.ts test/unit/translate.test.ts
git commit -m "fix: drop redundant mkdir, null-safe fetch classification, healthcheck honours --timeout-ms, non-JSON DeepL body, CI on every PR"
```

---

### Task 5: Documentation and version 1.0.0

**Files:**
- Modify: `package.json` (`"version": "1.0.0"`), `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `openspec/config.yaml`, `openspec/specs/README.md`, `openspec/specs/GLOSSARY.md`

- [ ] **Step 1: `package.json`** — `"version": "0.2.0"` → `"version": "1.0.0"`. Nothing else (exports and bin unchanged). `bun test` includes `test/unit/meta.test.ts`, which reads the version back.

- [ ] **Step 2: CHANGELOG** — rename `## [Unreleased]` to `## [1.0.0] - 2026-09-06` and insert a fresh empty `## [Unreleased]` above it. At the top of the 1.0.0 section, before `### Added`, add a **Breaking summary** paragraph:

```markdown
**Breaking release.** One config file (`digest.config.json`, built-in UAE default) drives topics and every heuristic; region mode and its flags are gone; there is one text and one JSON output format; the `/core` API is reduced to a documented set. Migration: run `uae-news-digest config print-default > digest.config.json`, edit, `uae-news-digest config validate`; replace `--region`/`--rss-url`/`--match*`/`--topics-config` with `--config`; in code, replace `buildDigest*`/`runTopicalDigest`/`renderDigest*` with `runDigest` + `renderText`/`toJson`.
```

Then add these bullets under the existing headings:

```markdown
### Changed
- **Breaking (API):** `@drakulavich/uae-news-digest/core` now exports exactly `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `runDigest`, `renderText`, `toJson`, `parseRss`, `readSeenKeys`, `writeSeenKeys`, `DEFAULT_STATE_FILE`, `translateDeepL`, `DEEPL_API_URL` and the types `DigestConfig`, `Topic`, `ResolveConfigOptions`, `RunOptions`, `DigestResult`, `TopicSection`, `FetchText`, `Translate`, `DigestItem`, `DigestJson`, `DigestJsonItem`, `JsonMeta`, `ImportanceTier`, `RssItem`. Removed from the public surface: `buildDigest`, `buildDigestWithStats`, `matchTerms`, `parsePubDate`, `buildFeedUrl`, `emojiFor`, `hoursAgo`, `scoreItem`, `titleSimilarity`, `scoreImportance`, `importanceThreshold`, `normalizeTitle`, `normalizeSource`, `makeKey`, `DigestConfigSchema`, the `Heuristics`/`DeepLTranslation`/`DeepLResponse` types. `src/lib.ts` is deleted.
- Source layout: pipeline modules live under `src/pipeline/` (`run`, `select`, `scoring`, `similarity`, `importance`, `normalize`, `rss`, `url`, `terms`), renderers under `src/output/` (`text`, `json`, `emoji`, `time`); `buildDigestWithStats` is now the internal `selectItems(rssItems, topic, ctx)`.
- `healthcheck` honours `--timeout-ms` (default 15000) and reports failures with the same messages as the digest run.
- CI runs on every pull request, not only those targeting `main`.

### Fixed
- `translateDeepL` reports a non-JSON 200 body as `DeepL returned a non-JSON response` instead of a raw parse error.
- Fetch failures whose rejection value is `null`/`undefined` are classified as network errors instead of crashing the classifier.
```

(The existing `### Fixed` bullet about wordless titles stays; adjust its wording to the current behaviour: "…different non-Latin titles no longer collapse into one item, while a verbatim repeat of the same wordless title still dedupes".)

- [ ] **Step 3: README** — "Programmatic API" section: replace the import line with `import { loadConfig, DEFAULT_CONFIG, runDigest, renderText, toJson } from "@drakulavich/uae-news-digest/core";` and add a 6-line example: load config (or `DEFAULT_CONFIG`), `runDigest` with `fetchText: (url) => fetch(url).then(r => r.text())`, then `renderText(result, config, new Date())`; list the exported values in one sentence. "How It Works": keep the diagram; make sure nothing names a removed export. Remove any sentence that says `buildDigest` is available. Check the `healthcheck` sentence mentions `--timeout-ms`.

- [ ] **Step 4: CLAUDE.md** — pipeline diagram:

```
src/index.ts → cli/program.ts main(argv) → cli/run.ts (default command)
  → cli/config.ts resolveConfig (default.json or digest.config.json) → pipeline/url.ts buildFeedUrl → cli/adapters.ts fetchText
  → pipeline/rss.ts parseRss → pipeline/select.ts selectItems (window, skip, match, score, dedupe, limit) → translate (optional)
  → output/text.ts renderText | output/json.ts toJson
```

"Two interfaces" sentence: the `/core` export list is `runDigest`, `renderText`, `toJson`, `loadConfig`, `parseConfig`, `DEFAULT_CONFIG`, `parseRss`, state and DeepL helpers — "exactly what `src/core.ts` re-exports; `test/unit/core-surface.test.ts` pins the list". Code Style bullet: `relative imports ('./pipeline/run', not 'src/pipeline/run'); internal code never imports './core'`.

- [ ] **Step 5: openspec** — `openspec/config.yaml`: `src/pipeline.ts` → `src/pipeline/run.ts`; commands sentence lists `manifest`, `healthcheck`, `config print-default`, `config validate`; "Commander-based `src/index.ts`" → "Commander-based `src/cli/program.ts`, bin `src/index.ts`". `openspec/specs/README.md`: terminology line "Region preset" → "Config"; Sana persona `(runDigest, buildDigest, DigestItem)` → `(runDigest, renderText, toJson, DigestItem)`; capabilities table `sources` row → "Config file (`--config`, `./digest.config.json`, XDG, built-in UAE default): topics, `feedUrl`, per-topic `match` / `matchMode`, heuristics"; `agent-surface` row add `config print-default` / `config validate`. `GLOSSARY.md`: every `src/…` path to the new location (`src/pipeline/rss.ts`, `src/pipeline/select.ts`, `src/pipeline/run.ts`, `src/pipeline/scoring.ts`, `src/pipeline/similarity.ts`, `src/pipeline/importance.ts`, `src/output/text.ts`, `src/output/json.ts`); **Match terms** → `src/pipeline/select.ts`; **Core API** → the exact export list ("pinned by `test/unit/core-surface.test.ts`").

- [ ] **Step 6: Verify and commit**

Run: `bun run typecheck && bun test && bun run smoke:pack` — `226 pass`. Grep `README.md CLAUDE.md openspec` for `buildDigest`, `src/render.ts`, `src/json.ts`, `src/digest.ts`, `src/scoring.ts`, `src/pipeline.ts`, `lib.ts`, `Region preset` — no hits.

```bash
git add package.json CHANGELOG.md README.md CLAUDE.md openspec
git commit -m "docs: 1.0.0 — final core surface, src/pipeline and src/output layout, openspec refresh"
```

After merge, the release is cut by tagging `v1.0.0` on `main` (release.yml verifies the tag against `package.json` and extracts the `## [1.0.0]` notes). Tagging is the maintainer's step, not part of this PR.

---

## Self-review

**Spec coverage (§4 + staging 4 + §2 public list):** layout `src/pipeline/*` → Task 1, `src/output/*` → Task 2 (both with the three recorded additive deviations); `lib.ts` deleted and internal code importing concrete modules → Task 3; `selectItems` replacing `buildDigestWithStats` → Task 1; final `core.ts` per the §2 list (plus `parseConfig` and function parameter/return types, ruling recorded) → Task 3 with a pinning test; tests "pass config slices explicitly", "pipeline test drives runDigest with stubs", "cli tests stay e2e via Bun.spawn + Bun.serve", "fetch-guard stays" — all already true, unchanged; README/CHANGELOG (Breaking)/`openspec/config.yaml`/CLAUDE.md/`package.json` exports (unchanged)/version 1.0.0 → Task 5. Debts from the PR 2/3 reviews → Task 4 (mkdir, null rejection, healthcheck timeout, DeepL JSON, CI trigger) and Task 3 (`resolveConfig` module); `toJson` array sharing and in-place `translatedTitle` mutation are deliberately left (no observable effect).

**Placeholders:** Task 1 Step 3 elides the unchanged body of `buildDigestWithStats` with an explicit "unchanged, from … to …" pointer; Task 5 Step 3's README example is described in one sentence and is prose the implementer writes from the `core.ts` of Task 3 — acceptable for documentation, but the export list itself is given verbatim in Task 3 and the CHANGELOG bullet.

**Type consistency:** `SelectContext`/`SelectResult`/`selectItems(rssItems, topic, ctx)` defined in Task 1 and consumed identically by `pipeline/run.ts` (Task 1) and the tests; `emojiFor`/`hoursAgo` signatures unchanged across Task 2's moves; `resolveConfig` signature identical in Task 3's `cli/config.ts` and its callers; `healthcheck`'s `opts` gains `timeoutMs` in Task 4 in both `commands.ts` and `program.ts`; test counts: 221 → 221 → 221 → 223 → 226 → 226.
