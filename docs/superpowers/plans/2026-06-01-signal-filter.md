# Signal Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a `🚨 Important` section of high-impact, family-relevant news at the top of every digest, penalize PR fluff, and let topics require real keyword matches — all heuristic and key-free, with enriched JSON for an external agent to refine.

**Architecture:** A new pure `importance` layer scores each title (breaking / impact / fluff lexicons) independently of the existing source `score`. `buildDigest` attaches `importance`/`signals`/`tier` to every item and applies an optional keyword post-filter (`match`/`matchMode`), reporting dropped counts. The renderer gathers items above a threshold into a cross-topic `🚨 Important` block (de-duplicated from the sections below). The CLI exposes `--match`/`--match-mode`/`--prompt` and enriches `--json` with the new fields.

**Tech Stack:** Bun runtime, TypeScript (strict), Commander, `bun:test`. No new dependencies.

---

## File Structure

- **Create** `src/importance.ts` — `scoreImportance`, lexicons, `IMPORTANCE_THRESHOLD`, `FILTER_PROMPT`, `escapeRegExp`. One responsibility: judging title importance.
- **Modify** `src/digest.ts` — extend `DigestItem`; add `MatchMode` + `matchTerms` + `buildDigestWithStats`; `buildDigest` becomes a thin wrapper.
- **Modify** `src/topics.ts` — parse/validate optional `match` / `matchMode` per topic.
- **Modify** `src/pipeline.ts` — thread match + importance through both flows; surface dropped-item warnings.
- **Modify** `src/render.ts` — render the `🚨 Important` block (cross-topic) and per-item signal markers.
- **Modify** `src/index.ts` — `--match` / `--match-mode` / `--prompt` flags; enrich both `--json` paths.
- **Modify** `src/lib.ts` and `src/core.ts` — re-export the new public symbols.
- **Create** `test/unit/importance.test.ts`.
- **Modify** `test/integration/digest.test.ts` — importance + `match` cases.
- **Modify** `test/unit/topics.test.ts` — `match` / `matchMode` validation.
- **Modify** `test/integration/topical-digest.test.ts` — cross-topic important + warnings.
- **Modify** `test/cli.test.ts` — end-to-end stdout + enriched JSON.

Run the full suite at any time with `bun test`; type-check with `bun run typecheck`.

---

## Task 1: Importance scoring module

**Files:**
- Create: `src/importance.ts`
- Test: `test/unit/importance.test.ts`
- Modify: `src/lib.ts`, `src/core.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/importance.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { scoreImportance, IMPORTANCE_THRESHOLD } from '../../src/importance';

describe('scoreImportance', () => {
  test('breaking-safety headline is tier "breaking" and above threshold', () => {
    const r = scoreImportance('UAE intercepts ballistic missile over Abu Dhabi airspace');
    expect(r.tier).toBe('breaking');
    expect(r.importance).toBeGreaterThanOrEqual(IMPORTANCE_THRESHOLD);
    expect(r.signals).toContain('missile');
    expect(r.signals).toContain('airspace');
  });

  test('money/rules impact headline is tier "impact" and above threshold', () => {
    const r = scoreImportance('Dubai rents jump and new visa fees announced');
    expect(r.tier).toBe('impact');
    expect(r.importance).toBeGreaterThanOrEqual(IMPORTANCE_THRESHOLD);
    expect(r.signals).toEqual(expect.arrayContaining(['rent', 'visa', 'fees']));
  });

  test('PR puff headline is tier "fluff", negative, below threshold', () => {
    const r = scoreImportance("Dubai unveils world's tallest tower at glittering festival");
    expect(r.tier).toBe('fluff');
    expect(r.importance).toBeLessThan(0);
    expect(r.importance).toBeLessThan(IMPORTANCE_THRESHOLD);
  });

  test('plain headline is tier "neutral" and below threshold', () => {
    const r = scoreImportance('Local council holds routine monthly meeting');
    expect(r.tier).toBe('neutral');
    expect(r.importance).toBeLessThan(IMPORTANCE_THRESHOLD);
    expect(r.signals).toHaveLength(0);
  });

  test('breaking outranks fluff when both markers present', () => {
    const breaking = scoreImportance('Airport closed after attack; ribbon-cutting ceremony cancelled');
    expect(breaking.tier).toBe('breaking');
  });

  test('word-boundary matching avoids false positives', () => {
    // "current" must NOT match the "rent" marker
    const r = scoreImportance('Council reviews current routine procedures');
    expect(r.signals).not.toContain('rent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/unit/importance.test.ts`
Expected: FAIL — `Cannot find module '../../src/importance'`.

- [ ] **Step 3: Write the implementation**

Create `src/importance.ts`:

```ts
export type ImportanceTier = 'breaking' | 'impact' | 'neutral' | 'fluff';

export type ImportanceResult = {
  importance: number;
  signals: string[];
  tier: ImportanceTier;
};

export const IMPORTANCE_THRESHOLD = 2;

const BREAKING_WEIGHT = 4;
const IMPACT_WEIGHT = 2;
const FLUFF_PENALTY = 3;

/** Safety / threats — what demands an immediate reaction. */
export const BREAKING_MARKERS = [
  'breaking', 'urgent', 'evacuat', 'killed', 'attack', 'missile', 'drone',
  'airspace', 'airport closed', 'banned', 'alert', 'warning', 'storm',
  'flood', 'recall',
];

/** Money / rules / logistics — what materially affects a family's life. */
export const IMPACT_MARKERS = [
  // money / daily life
  'rent', 'fees', 'tax', 'fuel', 'fine', 'salary', 'subsidy',
  // rules / visa / documents
  'visa', 'residency', 'law', 'permit', 'licence', 'school', 'insurance',
  // logistics / infrastructure
  'flight', 'road closed', 'outage', 'metro',
];

/** PR puff — what to push down. */
export const FLUFF_MARKERS = [
  'unveils', 'launches', 'celebrates', 'award', 'vision', 'milestone',
  "world's first", "world's tallest", "world's largest", 'ranked',
  'inaugurat', 'honoured', 'festival',
];

/** The reproducible criterion the external agent applies to enriched JSON. */
export const FILTER_PROMPT =
  "You are a news filter for an expat family in the UAE. Keep only what " +
  "materially affects safety, money, rules/visas, or logistics. Drop PR, " +
  "launches, awards, rankings, and 'world's first/tallest/largest'.";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMarkers(haystack: string, markers: string[]): string[] {
  const found: string[] = [];
  for (const m of markers) {
    // Leading word boundary + prefix: matches "rent"/"rents"/"rental",
    // but not "current"/"parent".
    if (new RegExp('\\b' + escapeRegExp(m), 'i').test(haystack)) found.push(m);
  }
  return found;
}

export function scoreImportance(title: string): ImportanceResult {
  const breaking = findMarkers(title, BREAKING_MARKERS);
  const impact = findMarkers(title, IMPACT_MARKERS);
  const fluff = findMarkers(title, FLUFF_MARKERS);

  const importance =
    breaking.length * BREAKING_WEIGHT +
    impact.length * IMPACT_WEIGHT -
    fluff.length * FLUFF_PENALTY;

  let tier: ImportanceTier;
  if (breaking.length > 0) tier = 'breaking';
  else if (importance < 0) tier = 'fluff';
  else if (impact.length > 0) tier = 'impact';
  else tier = 'neutral';

  return { importance, signals: [...breaking, ...impact, ...fluff], tier };
}
```

> Note: a deliberate refinement of the spec signature — `source` is dropped because importance is judged from the title alone. Source quality still lives in `scoreItem`.

- [ ] **Step 4: Add public exports**

In `src/lib.ts`, after the `scoreItem` re-export line, add:

```ts
export { scoreImportance, IMPORTANCE_THRESHOLD, FILTER_PROMPT, escapeRegExp } from './importance';
export type { ImportanceTier, ImportanceResult } from './importance';
```

In `src/core.ts`, after the `scoreItem` re-export line, add:

```ts
export { scoreImportance, IMPORTANCE_THRESHOLD, FILTER_PROMPT } from './importance';
export type { ImportanceTier, ImportanceResult } from './importance';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/unit/importance.test.ts && bun run typecheck`
Expected: PASS (6 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/importance.ts src/lib.ts src/core.ts test/unit/importance.test.ts
git commit -m "feat(importance): heuristic title importance scoring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Attach importance to digest items

**Files:**
- Modify: `src/digest.ts:8-14` (`DigestItem` type), `src/digest.ts:48-54` (item construction)
- Test: `test/integration/digest.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/integration/digest.test.ts` inside the top-level `describe('buildDigest', …)` block:

```ts
  test('attaches importance, signals, and tier to each item', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'UAE intercepts missile over Dubai airspace', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
    ];
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });
    expect(digest).toHaveLength(1);
    expect(digest[0]!.tier).toBe('breaking');
    expect(digest[0]!.importance).toBeGreaterThan(0);
    expect(digest[0]!.signals).toContain('missile');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/integration/digest.test.ts`
Expected: FAIL — `tier`/`importance`/`signals` are `undefined` / not on type.

- [ ] **Step 3: Extend the `DigestItem` type**

In `src/digest.ts`, replace the `DigestItem` type (lines 8-14):

```ts
export type DigestItem = {
  score: number;
  importance: number;
  signals: string[];
  tier: ImportanceTier;
  publishedAt: Date;
  title: string;
  source: string;
  key: string;
  matchedTerms?: string[];
};
```

Add to the imports at the top of `src/digest.ts`:

```ts
import { scoreImportance, type ImportanceTier } from './importance';
```

- [ ] **Step 4: Populate the new fields**

In `src/digest.ts`, replace the `digestItem` construction (lines 48-54):

```ts
    const imp = scoreImportance(title);
    const digestItem: DigestItem = {
      score: scoreItem(title, source),
      importance: imp.importance,
      signals: imp.signals,
      tier: imp.tier,
      publishedAt,
      title,
      source,
      key,
    };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/integration/digest.test.ts && bun run typecheck`
Expected: PASS, typecheck clean (existing tests still green — fields are additive).

- [ ] **Step 6: Commit**

```bash
git add src/digest.ts test/integration/digest.test.ts
git commit -m "feat(digest): attach importance/signals/tier to items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Keyword post-filter (`match` / `matchMode`)

**Files:**
- Modify: `src/digest.ts` (add `MatchMode`, `matchTerms`, `buildDigestWithStats`; rewire `buildDigest`)
- Modify: `src/lib.ts`, `src/core.ts` (export new symbols)
- Test: `test/integration/digest.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new block to `test/integration/digest.test.ts`:

```ts
import { buildDigestWithStats, matchTerms } from '../../src/digest';

describe('matchTerms', () => {
  test('mode "all" requires every term', () => {
    expect(matchTerms('Dubai school fees rise', ['school', 'fees'], 'all').ok).toBe(true);
    expect(matchTerms('Dubai school news', ['school', 'fees'], 'all').ok).toBe(false);
  });
  test('mode "any" requires one term and reports which matched', () => {
    const r = matchTerms('Dubai school news', ['school', 'fees'], 'any');
    expect(r.ok).toBe(true);
    expect(r.matchedTerms).toEqual(['school']);
  });
  test('numeric mode requires N terms', () => {
    expect(matchTerms('a b c', ['a', 'b', 'c'], 2).ok).toBe(true);
    expect(matchTerms('a only', ['a', 'b', 'c'], 2).ok).toBe(false);
  });
});

describe('buildDigestWithStats match filter', () => {
  test('drops off-keyword items and counts them; annotates matchedTerms', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai school fees increase for 2026', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Gulf News' },
      { title: 'Dubai weather stays warm this week', pubDate: 'Sun, 22 Mar 2026 07:10:00 GMT', source: 'Khaleej Times' },
    ];
    const { items: digest, droppedByMatch } = buildDigestWithStats(items, {
      seenKeys: new Set(), hours: 36, limit: 6, now, match: ['school', 'fees'], matchMode: 'all',
    });
    expect(digest).toHaveLength(1);
    expect(digest[0]!.matchedTerms).toEqual(['school', 'fees']);
    expect(droppedByMatch).toBe(1);
  });

  test('no match option = unchanged behavior, droppedByMatch 0', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai property sector update', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
    ];
    const { items: digest, droppedByMatch } = buildDigestWithStats(items, {
      seenKeys: new Set(), hours: 36, limit: 6, now,
    });
    expect(digest).toHaveLength(1);
    expect(droppedByMatch).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/integration/digest.test.ts`
Expected: FAIL — `buildDigestWithStats` / `matchTerms` not exported.

- [ ] **Step 3: Add `MatchMode` + `matchTerms` + options**

In `src/digest.ts`, add to the imports:

```ts
import { scoreImportance, escapeRegExp, type ImportanceTier } from './importance';
```

(adjust the existing importance import line to this single line).

Add after the `DigestItem` type:

```ts
export type MatchMode = 'all' | 'any' | number;

export function matchTerms(
  title: string,
  match: string[],
  mode: MatchMode,
): { ok: boolean; matchedTerms: string[] } {
  const hay = title.toLowerCase();
  const matchedTerms = match.filter((t) =>
    new RegExp('\\b' + escapeRegExp(t.toLowerCase())).test(hay),
  );
  let need: number;
  if (mode === 'all') need = match.length;
  else if (mode === 'any') need = 1;
  else need = Math.max(1, Math.min(mode, match.length));
  return { ok: matchedTerms.length >= need, matchedTerms };
}
```

Extend `BuildDigestOptions` (add two optional fields):

```ts
export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  skipRe?: RegExp;
  match?: string[];
  matchMode?: MatchMode;
};
```

- [ ] **Step 4: Add `buildDigestWithStats` and make `buildDigest` a wrapper**

In `src/digest.ts`, rename the existing `export function buildDigest(...)` to `buildDigestWithStats` and change its return type and body. Replace the signature line:

```ts
export function buildDigestWithStats(items: RssItem[], options: BuildDigestOptions): { items: DigestItem[]; droppedByMatch: number } {
  const { seenKeys, hours, limit, now = new Date(), skipRe = DEFAULT_SKIP_RE, match, matchMode = 'all' } = options;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const unique = new Map<string, DigestItem>();
  let droppedByMatch = 0;
```

Inside the loop, immediately after the `seenKeys.has(key)` check (`if (seenKeys.has(key)) continue;`), insert the match filter:

```ts
    let matchedTerms: string[] | undefined;
    if (match && match.length > 0) {
      const m = matchTerms(title, match, matchMode);
      if (!m.ok) { droppedByMatch++; continue; }
      matchedTerms = m.matchedTerms;
    }
```

Add `matchedTerms` into the `digestItem` object literal (after `key,`):

```ts
      key,
      matchedTerms,
```

Replace the final `return` of the function:

```ts
  const result = [...unique.values()]
    .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime() || a.title.localeCompare(b.title))
    .slice(0, limit);
  return { items: result, droppedByMatch };
}

export function buildDigest(items: RssItem[], options: BuildDigestOptions): DigestItem[] {
  return buildDigestWithStats(items, options).items;
}
```

- [ ] **Step 5: Export new symbols**

In `src/lib.ts`, change the digest re-export line to:

```ts
export { buildDigest, buildDigestWithStats, matchTerms, parsePubDate } from './digest';
export type { DigestItem, BuildDigestOptions, MatchMode } from './digest';
```

In `src/core.ts`, change the digest re-export line to:

```ts
export { buildDigest, buildDigestWithStats, matchTerms, parsePubDate } from './digest';
export type { DigestItem, BuildDigestOptions, MatchMode } from './digest';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test test/integration/digest.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/digest.ts src/lib.ts src/core.ts test/integration/digest.test.ts
git commit -m "feat(digest): keyword post-filter with match/matchMode + stats

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Topic config `match` / `matchMode`

**Files:**
- Modify: `src/topics.ts` (`TopicConfig` type + validation)
- Test: `test/unit/topics.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/topics.test.ts` (it tests `loadTopicsConfig`; mirror its existing fixture-writing style — write a temp JSON file and load it). Add:

```ts
  test('parses optional match and matchMode on a topic', async () => {
    const path = `${tmpdir()}/topics-match-${Date.now()}.json`;
    await Bun.write(path, JSON.stringify({
      topics: [{ slug: 'schools', name: 'Schools', query: 'school fees', match: ['school', 'fees'], matchMode: 'any' }],
    }));
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]!.match).toEqual(['school', 'fees']);
    expect(cfg.topics[0]!.matchMode).toBe('any');
  });

  test('defaults matchMode to "all" when match present but mode omitted', async () => {
    const path = `${tmpdir()}/topics-match2-${Date.now()}.json`;
    await Bun.write(path, JSON.stringify({
      topics: [{ slug: 'schools', name: 'Schools', query: 'school fees', match: ['school', 'fees'] }],
    }));
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]!.matchMode).toBe('all');
  });

  test('rejects a non-string entry in match', async () => {
    const path = `${tmpdir()}/topics-match3-${Date.now()}.json`;
    await Bun.write(path, JSON.stringify({
      topics: [{ slug: 'x', name: 'X', query: 'q', match: ['ok', 5] }],
    }));
    await expect(loadTopicsConfig(path)).rejects.toThrow(/match/);
  });
```

If `tmpdir` is not already imported in this test file, add at the top: `import { tmpdir } from 'node:os';`

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/unit/topics.test.ts`
Expected: FAIL — `match`/`matchMode` undefined on the parsed topic.

- [ ] **Step 3: Extend `TopicConfig` and import the type**

In `src/topics.ts`, add to the imports:

```ts
import type { MatchMode } from './digest';
```

Extend the `TopicConfig` type (after `query: string;`):

```ts
  match?: string[];
  matchMode?: MatchMode;
```

- [ ] **Step 4: Validate `match` / `matchMode`**

In `src/topics.ts`, inside the topic loop in `validate()`, after the `emoji` line and before computing `limit`, add:

```ts
    let match: string[] | undefined;
    let matchMode: MatchMode | undefined;
    if (t.match !== undefined) {
      if (!Array.isArray(t.match) || t.match.length === 0) {
        throw new Error(`${where}.match must be a non-empty array of strings`);
      }
      match = t.match.map((m, j) => requireString(m, `${where}.match[${j}]`));

      if (t.matchMode === undefined) {
        matchMode = 'all';
      } else if (t.matchMode === 'all' || t.matchMode === 'any') {
        matchMode = t.matchMode;
      } else if (typeof t.matchMode === 'number' && Number.isInteger(t.matchMode) && t.matchMode > 0) {
        matchMode = t.matchMode;
      } else {
        throw new Error(`${where}.matchMode must be "all", "any", or a positive integer (got ${JSON.stringify(t.matchMode)})`);
      }
    }
```

Add `match` and `matchMode` to the `topics.push({...})` call:

```ts
    topics.push({ slug, name, emoji, query, limit, locale: topicLocale, match, matchMode });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/unit/topics.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/topics.ts test/unit/topics.test.ts
git commit -m "feat(topics): optional match/matchMode per topic

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Thread match + dropped warnings through the pipeline

**Files:**
- Modify: `src/pipeline.ts` (`RunDigestOptions`, `runDigest`, `runTopicalDigest`)
- Test: `test/integration/topical-digest.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/integration/topical-digest.test.ts` (it already exercises `runTopicalDigest` with a fake fetcher — mirror that). Add:

```ts
  test('emits a dropped-items warning when a topic match filter rejects items', async () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Dubai school fees rise for 2026</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source>Gulf News</source></item>
      <item><title>Dubai weather stays warm</title><pubDate>Sun, 22 Mar 2026 07:05:00 GMT</pubDate><source>Khaleej Times</source></item>
    </channel></rss>`;

    const result = await runTopicalDigest({
      config: {
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [{ slug: 'schools', name: 'Schools', query: 'school fees', limit: 5, locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, match: ['school', 'fees'], matchMode: 'all' }],
      },
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () => xml,
      now,
    });

    expect(result.sections[0]!.items).toHaveLength(1);
    expect(result.warnings.some((w) => /dropped/.test(w))).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/integration/topical-digest.test.ts`
Expected: FAIL — no dropped warning (match not applied in pipeline yet).

- [ ] **Step 3: Apply match in `runTopicalDigest`**

In `src/pipeline.ts`, change the `import { buildDigest } from './digest';` line to:

```ts
import { buildDigestWithStats } from './digest';
```

In `runTopicalDigest`, replace the `const items = buildDigest(parseRss(result.value), {...});` block (around lines 111-116) with:

```ts
    const { items, droppedByMatch } = buildDigestWithStats(parseRss(result.value), {
      seenKeys: seen,
      hours: opts.hours,
      limit: opts.limitOverride ?? topic.limit,
      now,
      match: topic.match,
      matchMode: topic.matchMode,
    });

    if (droppedByMatch > 0) {
      warnings.push(`Topic "${topic.slug}": ${droppedByMatch} item(s) dropped — missing required keywords`);
    }
```

- [ ] **Step 4: Apply match in `runDigest`**

In `src/pipeline.ts`, add two optional fields to `RunDigestOptions` (after `region?: string;`):

```ts
  match?: string[];
  matchMode?: import('./digest').MatchMode;
```

In `runDigest`, replace the `const digest = buildDigest(items, {...});` block (around lines 38-43) with:

```ts
  const { items: digest, droppedByMatch } = buildDigestWithStats(items, {
    seenKeys: options.seenKeys,
    hours: options.hours,
    limit: options.limit,
    now: options.now,
    match: options.match,
    matchMode: options.matchMode,
  });
```

Then, where `const warnings: string[] = [];` is declared, add immediately after it:

```ts
  if (droppedByMatch > 0) {
    warnings.push(`${droppedByMatch} item(s) dropped — missing required keywords`);
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/integration/topical-digest.test.ts && bun test && bun run typecheck`
Expected: PASS (full suite green), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline.ts test/integration/topical-digest.test.ts
git commit -m "feat(pipeline): apply match filter and warn on dropped items

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Render the `🚨 Important` section

**Files:**
- Modify: `src/render.ts` (`renderDigest`, `renderTopicalDigest`)
- Test: `test/integration/topical-digest.test.ts`, `test/unit/render.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/render.test.ts` (it imports `renderDigest`; mirror its style). Add:

```ts
import { IMPORTANCE_THRESHOLD } from '../../src/importance';

describe('renderDigest 🚨 Important block', () => {
  test('promotes important items into a top block and omits them from the list below', () => {
    const now = new Date('2026-03-22T10:00:00Z');
    const items = [
      { score: 7, importance: 8, signals: ['missile', 'airspace'], tier: 'breaking' as const,
        publishedAt: new Date('2026-03-22T08:00:00Z'), title: 'UAE intercepts missile over Dubai airspace', source: 'Reuters', key: 'k1' },
      { score: 5, importance: 0, signals: [], tier: 'neutral' as const,
        publishedAt: new Date('2026-03-22T09:00:00Z'), title: 'Local council holds routine meeting', source: 'Gulf News', key: 'k2' },
    ];
    const out = renderDigest(items, undefined, now, 'uae');
    expect(out).toContain('🚨 Important');
    const importantIdx = out.indexOf('🚨 Important');
    const missileIdx = out.indexOf('UAE intercepts missile');
    expect(missileIdx).toBeGreaterThan(importantIdx);
    // appears exactly once (promoted, not duplicated)
    expect(out.split('UAE intercepts missile').length - 1).toBe(1);
    // signals marker shown
    expect(out).toContain('[missile, airspace]');
  });

  test('no 🚨 block when nothing clears the threshold', () => {
    const now = new Date('2026-03-22T10:00:00Z');
    const items = [
      { score: 2, importance: IMPORTANCE_THRESHOLD - 1, signals: [], tier: 'neutral' as const,
        publishedAt: new Date('2026-03-22T09:00:00Z'), title: 'Routine update', source: 'Gulf News', key: 'k3' },
    ];
    const out = renderDigest(items, undefined, now, 'uae');
    expect(out).not.toContain('🚨 Important');
  });
});
```

Append to `test/integration/topical-digest.test.ts`:

```ts
  test('gathers important items across topics into one top block', async () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const realEstateXml = `<?xml version="1.0"?><rss><channel>
      <item><title>Missile intercepted over Abu Dhabi airspace</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source>Reuters</source></item>
    </channel></rss>`;
    const calmXml = `<?xml version="1.0"?><rss><channel>
      <item><title>Routine community newsletter published</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source>Gulf News</source></item>
    </channel></rss>`;

    const result = await runTopicalDigest({
      config: {
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [
          { slug: 'realestate', name: 'Real Estate', query: 'property', limit: 5, locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' } },
          { slug: 'community', name: 'Community', query: 'community', limit: 5, locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' } },
        ],
      },
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async (t) => (t.slug === 'realestate' ? realEstateXml : calmXml),
      now,
    });

    const importantIdx = result.output.indexOf('🚨 Important');
    const realEstateIdx = result.output.indexOf('Real Estate');
    expect(importantIdx).toBeGreaterThanOrEqual(0);
    expect(realEstateIdx).toBeGreaterThan(importantIdx); // block precedes the topic sections
    expect(result.output).toContain('Missile intercepted');
    // missile not duplicated in its own section below
    expect(result.output.split('Missile intercepted').length - 1).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/unit/render.test.ts test/integration/topical-digest.test.ts`
Expected: FAIL — no `🚨 Important` block rendered.

- [ ] **Step 3: Add a shared line formatter and the block to `renderDigest`**

In `src/render.ts`, add to the imports:

```ts
import { IMPORTANCE_THRESHOLD } from './importance';
```

Add this helper above `renderDigest`:

```ts
function formatItemLine(item: DigestItem, translations: Map<string, string> | undefined, now: Date, indent: string): string {
  const title = translations?.get(item.title) ?? item.title;
  const hoursAgo = Math.round((now.getTime() - item.publishedAt.getTime()) / 3_600_000);
  const marker = item.signals.length > 0 ? ` [${item.signals.join(', ')}]` : '';
  return `${indent}${emojiFor(item.title)} ${title} (${item.source}, ${hoursAgo}h ago)${marker}`;
}
```

Replace the body of `renderDigest` (lines 26-42) so it promotes important items:

```ts
export function renderDigest(items: DigestItem[], translations?: Map<string, string>, now: Date = new Date(), region: string = 'uae'): string {
  const preset = REGION_PRESETS[region.toLowerCase()];
  const flag = preset?.flag ?? '📰';
  const name = preset?.name ?? 'News';

  if (items.length === 0) {
    return `${flag} ${name} Latest News Digest\n\n• No significant news in the check window.`;
  }

  const important = items.filter((i) => i.importance >= IMPORTANCE_THRESHOLD);
  const importantKeys = new Set(important.map((i) => i.key));

  const lines = [`${flag} ${name} Latest News Digest`, ''];
  if (important.length > 0) {
    lines.push('🚨 Important');
    for (const item of important) lines.push(formatItemLine(item, translations, now, '  '));
    lines.push('');
  }
  for (const item of items) {
    if (importantKeys.has(item.key)) continue;
    lines.push(formatItemLine(item, translations, now, ''));
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Add the cross-topic block to `renderTopicalDigest`**

In `src/render.ts`, replace the body of `renderTopicalDigest` (the section-loop portion) so it collects important items across all sections first:

```ts
export function renderTopicalDigest(
  sections: TopicSection[],
  translations?: Map<string, string>,
  now: Date = new Date(),
  locale: LocaleContext = DEFAULT_LOCALE_CONTEXT,
): string {
  const dateLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone: locale.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const lines: string[] = [`${locale.flag} ${locale.name} digest — ${dateLabel}`, ''];

  const important = sections.flatMap((s) =>
    s.items.filter((i) => i.importance >= IMPORTANCE_THRESHOLD).map((item) => ({ item, topic: s.topic })),
  );
  const importantKeys = new Set(important.map((e) => e.item.key));

  if (important.length > 0) {
    lines.push('🚨 Important');
    for (const { item, topic } of important) {
      lines.push(`${formatItemLine(item, translations, now, '  ')} — ${topic.name}`);
    }
    lines.push('');
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const prefix = section.topic.emoji ?? '•';
    lines.push(`${prefix} ${section.topic.name}`);

    const visible = section.items.filter((item) => !importantKeys.has(item.key));
    if (visible.length === 0) {
      lines.push('  (нет новых материалов)');
    } else {
      for (const item of visible) lines.push(formatItemLine(item, translations, now, '  '));
    }

    if (i < sections.length - 1) lines.push('');
  }

  return lines.join('\n');
}
```

> Note: the existing `(нет новых материалов)` placeholder is intentionally preserved — it is user-facing output copy in the rendered digest, not spec prose, so it stays as-is to match current behavior.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/unit/render.test.ts test/integration/topical-digest.test.ts && bun test && bun run typecheck`
Expected: PASS (full suite green). If `test/fixtures/cli-default-output.txt` is compared anywhere and now differs, regenerate it in Task 7's CLI step.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts test/unit/render.test.ts test/integration/topical-digest.test.ts
git commit -m "feat(render): cross-topic 🚨 Important block with signal markers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: CLI flags + enriched JSON

**Files:**
- Modify: `src/index.ts` (flags, `--prompt`, both JSON paths, `runDigest` call, manifest)
- Test: `test/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/cli.test.ts` runs the binary with `UAE_NEWS_DIGEST_TOPIC_FIXTURE` / `UAE_NEWS_DIGEST_NOW`. Mirror the existing spawn helper in that file. Add:

```ts
  test('--prompt prints the filter criterion and exits 0', async () => {
    const proc = Bun.spawn(['bun', 'src/index.ts', '--prompt'], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(out).toContain('news filter for an expat family in the UAE');
  });

  test('--json enriches items with importance, signals, and tier', async () => {
    const proc = Bun.spawn(['bun', 'src/index.ts', '--json', '--no-topics'], {
      stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, UAE_NEWS_DIGEST_TOPIC_FIXTURE: 'test/fixtures/sample-feed.xml', UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z' },
    });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items[0]).toHaveProperty('importance');
    expect(parsed.items[0]).toHaveProperty('tier');
    expect(parsed.items[0]).toHaveProperty('signals');
  });
```

> Region mode reads from the network, but `makeFetcher`'s fixture env only applies to topics mode. For the region `--json` test, the fixture env will be ignored — so instead point the region test at a local RSS file via `--rss-url file://`. Bun's `fetch` supports `file://`. Adjust the second test to add `'--rss-url', \`file://${process.cwd()}/test/fixtures/sample-feed.xml\``` to the argv and drop the fixture env. Keep `--no-topics` so it stays in region mode.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/cli.test.ts`
Expected: FAIL — `--prompt` unknown option; JSON items lack `importance`.

- [ ] **Step 3: Add the CLI options**

In `src/index.ts`, in the `program.option(...)` chain (after the `--dry-run` option, before `.addHelpText`), add:

```ts
  .option('--match <terms...>', 'require these keywords in the title (region mode)')
  .option('--match-mode <mode>', 'how many --match terms to require: all | any | <N>', 'all')
  .option('--prompt', 'print the agent filter prompt and exit', false)
```

Add the import at the top:

```ts
import { FILTER_PROMPT } from './importance';
```

- [ ] **Step 4: Handle `--prompt` early**

In `src/index.ts`, at the very top of the `program.action(async (options) => { try {` body (immediately after `try {`), add:

```ts
    if (options.prompt) {
      process.stdout.write(FILTER_PROMPT + '\n');
      return;
    }
```

- [ ] **Step 5: Parse `--match-mode` and pass match to `runDigest`**

In `src/index.ts`, add a helper near `validatePositiveNumber`:

```ts
function parseMatchMode(raw: string): 'all' | 'any' | number {
  if (raw === 'all' || raw === 'any') return raw;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid --match-mode: ${raw} (use all | any | positive integer)`);
  return n;
}
```

In the region-mode `runDigest({...})` call (around lines 279-288), add:

```ts
      match: options.match,
      matchMode: options.match ? parseMatchMode(options.matchMode) : undefined,
```

- [ ] **Step 6: Enrich both JSON payloads**

In `src/index.ts`, in `runInTopicsMode`, extend the per-item map (the `s.items.map((d) => ({...}))` near line 159) to include:

```ts
        topic: s.topic.slug,
        title: d.title,
        source: d.source,
        score: d.score,
        importance: d.importance,
        tier: d.tier,
        signals: d.signals,
        matchedTerms: d.matchedTerms ?? [],
        publishedAt: d.publishedAt.toISOString(),
        hoursAgo: Math.round((now.getTime() - d.publishedAt.getTime()) / 3_600_000),
```

In the region-mode JSON (the `result.digest.map(d => ({...}))` near line 304), extend to include:

```ts
        items: result.digest.map(d => ({
          title: d.title,
          source: d.source,
          score: d.score,
          importance: d.importance,
          tier: d.tier,
          signals: d.signals,
          matchedTerms: d.matchedTerms ?? [],
          publishedAt: d.publishedAt.toISOString(),
          hoursAgo: Math.round((now.getTime() - d.publishedAt.getTime()) / 3_600_000),
        })),
```

- [ ] **Step 7: Update the manifest flag list**

In `src/index.ts`, in the `manifest` command's `flags` array, add the three new flags:

```ts
            '--match <terms...>',
            '--match-mode <mode>',
            '--prompt',
```

- [ ] **Step 8: Regenerate the CLI fixture if it changed**

If `test/cli.test.ts` compares stdout against `test/fixtures/cli-default-output.txt` and the rendered output now includes a `🚨 Important` block for that fixture, regenerate it:

Run: `UAE_NEWS_DIGEST_TOPIC_FIXTURE=test/fixtures/sample-feed.xml UAE_NEWS_DIGEST_NOW=2026-04-15T12:00:00Z bun src/index.ts --no-topics > test/fixtures/cli-default-output.txt`
Then inspect the diff (`git diff test/fixtures/cli-default-output.txt`) and confirm the new block is correct before staging.

- [ ] **Step 9: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS (all tests green), typecheck clean.

- [ ] **Step 10: Commit**

```bash
git add src/index.ts test/cli.test.ts test/fixtures/cli-default-output.txt
git commit -m "feat(cli): --match/--match-mode/--prompt and enriched JSON

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the signal filter**

Add a `## Signal filter` section to `README.md` covering:
- The `🚨 Important` block: what surfaces (safety, money, rules/visas, logistics) and that PR fluff is pushed down.
- Topic `match` / `matchMode` config keys, with the JSON example from the spec.
- The agent workflow: `uae-news-digest --json | <hand to Claude with the prompt>`, and `--prompt` to print the criterion.

Keep it concise and consistent with the existing README tone. (No tests for docs.)

- [ ] **Step 2: Verify examples run**

Run: `bun src/index.ts --prompt`
Expected: prints the filter criterion (sanity-check the documented command works).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): document signal filter, match, and agent mode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] Run `bun test` — entire suite green.
- [ ] Run `bun run typecheck` — no type errors.
- [ ] Manually confirm the `🚨 Important` block and signal markers:
  `UAE_NEWS_DIGEST_TOPIC_FIXTURE=test/fixtures/sample-feed.xml UAE_NEWS_DIGEST_NOW=2026-04-15T12:00:00Z bun src/index.ts --no-topics`
- [ ] Confirm enriched JSON:
  `... bun src/index.ts --no-topics --json --rss-url file://$PWD/test/fixtures/sample-feed.xml` shows `importance`/`tier`/`signals`/`matchedTerms`.
- [ ] Open a PR from `feat/signal-filter` (main is protected; CI must pass before merge).
