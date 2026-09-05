# Unified Pipeline (PR 2 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two parallel pipelines (region mode and topics mode) with one `runDigest(config)` that fetches N topics through an injected fetcher, and emit one text format and one JSON format; region mode, its flags, and `src/region.ts` disappear.

**Architecture:** `runDigest` becomes pure orchestration over a `DigestConfig`: build one feed URL per topic (`src/url.ts`), fetch through an injected `fetchText`, select items per topic with the existing `buildDigestWithStats`, translate through an injected `translate`, and return sections plus warnings. Rendering moves out of the pipeline into `renderText` (`src/render.ts`) and `toJson` (`src/json.ts`), both driven by the config's `display`/`importance`/`emoji`. The CLI builds the two adapters (fetch with timeout and human-readable failures; DeepL with the auth key) and no longer knows about regions. A topic may carry an optional `feedUrl` that bypasses Google News, which is how tests and the packed-package smoke point the CLI at a local server (this replaces `--rss-url` and the `UAE_NEWS_DIGEST_TOPIC_FIXTURE` env var).

**Tech Stack:** Bun 1.3.x, TypeScript strict, zod 4.5.x, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-05-unified-config-refactor-design.md` — section 2 (Pipeline and programmatic API), the `display` and renderer-string rules from section 1, and "Staging → PR 2". File layout (`src/pipeline/`, `src/output/`) and the `CliError`/`config` subcommands are PR 3–4 and are **not** part of this plan.

## Global Constraints

- Bun only: `Bun.file`, `Bun.write`, `Bun.$`; TypeScript executed directly, no build step. `node:path` imports are acceptable (already used on `main`).
- `main` is protected: work on a branch in a worktree, open a PR, CI must pass.
- Run `bun run test`, `bun run typecheck`, and `bun run smoke:pack` before every push; `bunfig.toml` already preloads the fetch guard for plain `bun test`.
- Errors are human-readable: what failed, why, what to do. Never swallow errors.
- `console.log`/`process.stdout.write` for results, `console.error` for progress and warnings — stdout stays pipe-friendly.
- Relative imports (`./config/schema`, not `src/config/schema`).
- No backward compatibility required (spec decision): CLI flags, `/core` API, text and JSON output all change. Record every change in CHANGELOG `[Unreleased]`.
- Text format (spec §2): header `{display.flag} {display.name} digest — {YYYY-MM-DD in display.timezone}`, blank line, optional `🚨 Important` block (indented lines with `[signals]` and ` — {topic.name}` suffix), blank line, then one section per topic in config order: `{topic.emoji ?? '•'} {topic.name}` followed by indented item lines `  {emoji} {translatedTitle ?? title} ({source}, {N}h ago)`; empty sections print `  (no new items)`, sections whose items were all promoted print `  (all items are in 🚨 Important)`; sections separated by one blank line. A single-topic config still prints its heading.
- JSON format (spec §2): `{ tool, version, generatedAt, query: { hours, limit, targetLang }, topics: [{ slug, name, count }], count, warnings, items: [{ topic, title, translatedTitle, source, url, publishedAt, hoursAgo, score, importance, tier, signals, matchedTerms }] }`; `limit`, `targetLang`, `translatedTitle`, `url` are `null` when absent; no `mode` field; `googleUrl` is renamed `url`.
- Partial failures are warnings; the CLI exits 1 only when no topic could be fetched (`fetchedTopics === 0`); exit 0 otherwise. Cross-topic dedupe stays sequential (earlier topic wins). State is written only when at least one item was produced and `--dry-run` is absent.
- Accepted behaviour deltas in this PR (record in CHANGELOG): the "returned 0 items — check the query" warning now fires only when the feed itself had no items (not when every item was already seen); `--limit` has no default and overrides every topic's limit when given; the packed-core smoke and CLI tests use a topic `feedUrl` instead of `--rss-url`.

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `src/config/schema.ts` | `Topic.feedUrl?: string` (absolute http/https URL) | Modify |
| `src/url.ts` | `buildFeedUrl(topic)` — Google News search URL or `feedUrl` | Create |
| `src/translate.ts` | `translateDeepL` throws on failure, returns `string[]` | Modify |
| `src/digest.ts` | `DigestItem.url`, `translatedTitle`, required `matchedTerms` | Modify |
| `src/pipeline.ts` | `runDigest(RunOptions): Promise<DigestResult>`, types `FetchText`, `Translate`, `TopicSection` | Rewrite |
| `src/json.ts` | `hoursAgo`, `toJson`, `DigestJson` types | Create |
| `src/render.ts` | `emojiFor`, `renderText(result, config, now)` | Rewrite |
| `src/index.ts` | Flags `--config/--hours/--limit/--timeout-ms/--target-lang/--state-file/--dry-run/--json/--prompt`; adapters; one flow | Rewrite |
| `src/region.ts` | Superseded | Delete |
| `src/lib.ts`, `src/core.ts` | Export the new surface, drop removed symbols | Modify |
| `scripts/smoke-pack.ts` | Temp config with `feedUrl`; core smoke uses `fetchText` stub | Modify |
| `test/unit/url.test.ts` | URL building | Create |
| `test/unit/config-schema.test.ts` | `feedUrl` acceptance/rejection | Modify |
| `test/unit/translate.test.ts` | rejects instead of `null` | Modify |
| `test/unit/json.test.ts` | `toJson`/`hoursAgo` | Create |
| `test/unit/render.test.ts` | `emojiFor` kept, `renderText` tests replace the old render tests | Rewrite |
| `test/integration/pipeline.test.ts` | `runDigest` with stub `fetchText`/`translate` (absorbs `topical-digest.test.ts`) | Rewrite |
| `test/integration/topical-digest.test.ts` | Absorbed into `pipeline.test.ts` | Delete |
| `test/integration/digest.test.ts` | `url`/`matchedTerms` shape | Modify |
| `test/unit/region.test.ts` | Superseded | Delete |
| `test/cli.test.ts` | Feed config helper replaces `--rss-url`; new flags; new formats; `/rss/fixture` route | Modify |
| `test/fixtures/cli-default-output.txt` | Regenerated in the new text format | Modify |
| `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `openspec/config.yaml`, `openspec/specs/GLOSSARY.md` | Region mode removed, new formats, `feedUrl` | Modify |

---

### Task 0: Worktree and baseline

**Files:** none changed.

- [ ] **Step 1: Create the worktree and branch**

```bash
cd /Users/anton/Personal/repos/uae-news-digest
git fetch origin
git worktree add ../uae-news-digest-unified-pipeline -b refactor/unified-pipeline origin/main
cd ../uae-news-digest-unified-pipeline
bun install --frozen-lockfile
```

- [ ] **Step 2: Confirm the baseline is green**

Run: `bun run typecheck && bun run test && bun run smoke:pack`
Expected: typecheck clean, 201 tests pass, smoke exits 0. If not, stop — fix `main` first.

---

### Task 1: `feedUrl` on a topic and `buildFeedUrl`

**Files:**
- Modify: `src/config/schema.ts` (`TopicSchema`)
- Create: `src/url.ts`
- Test: `test/unit/config-schema.test.ts`, `test/unit/url.test.ts`

**Interfaces:**
- Produces: `Topic.feedUrl?: string` (validated absolute `http:`/`https:` URL, trimmed). `buildFeedUrl(topic: Topic): string` — returns `topic.feedUrl` when set, otherwise `https://news.google.com/rss/search?q=<enc q>&hl=<enc hl>&gl=<enc gl>&ceid=<enc ceid>` using `encodeURIComponent` (same encoding `buildRssUrl` produced).

- [ ] **Step 1: Write the failing tests**

Append to `describe('parseConfig — structure', ...)` in `test/unit/config-schema.test.ts`:

```ts
  test('accepts an absolute http(s) feedUrl on a topic', () => {
    const cfg = parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', feedUrl: 'http://localhost:8080/rss' }] }, 'test');
    expect(cfg.topics[0]!.feedUrl).toBe('http://localhost:8080/rss');
  });

  test('rejects a relative or non-http feedUrl', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', feedUrl: '/rss' }] }, 'test')).toThrow(/feedUrl/);
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', feedUrl: 'ftp://x/rss' }] }, 'test')).toThrow(/feedUrl/);
  });
```

Create `test/unit/url.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildFeedUrl } from '../../src/url';
import { parseConfig } from '../../src/config/schema';

const locale = { hl: 'en', gl: 'AE', ceid: 'AE:en' };

function topic(extra: Record<string, unknown>) {
  return parseConfig({ locale, topics: [{ slug: 'a', name: 'A', query: 'q', ...extra }] }, 'test').topics[0]!;
}

describe('buildFeedUrl', () => {
  test('builds a Google News search URL from query and locale', () => {
    const url = buildFeedUrl(topic({ query: '(Iran OR Tehran) AND "Abu Dhabi"' }));
    expect(url.startsWith('https://news.google.com/rss/search?')).toBe(true);
    expect(url).toContain('q=(Iran%20OR%20Tehran)%20AND%20%22Abu%20Dhabi%22');
    expect(url).toContain('&hl=en&gl=AE&ceid=AE%3Aen');
  });

  test('uses the topic locale, not the top-level one', () => {
    const url = buildFeedUrl(topic({ locale: { hl: 'de', gl: 'DE', ceid: 'DE:de' } }));
    expect(url).toContain('hl=de&gl=DE&ceid=DE%3Ade');
  });

  test('feedUrl wins over query', () => {
    expect(buildFeedUrl(topic({ feedUrl: 'http://localhost:1234/rss' }))).toBe('http://localhost:1234/rss');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/unit/url.test.ts test/unit/config-schema.test.ts`
Expected: FAIL — `Cannot find module '../../src/url'`; the `feedUrl` tests fail on unrecognized key.

- [ ] **Step 3: Add `feedUrl` to the schema**

In `src/config/schema.ts`, inside `TopicSchema`'s `z.strictObject({...})`, after `query`:

```ts
    /** Advanced: fetch this RSS URL instead of building a Google News search URL from `query`. */
    feedUrl: z
      .string()
      .trim()
      .refine((v) => /^https?:\/\/\S+$/.test(v), 'feedUrl must be an absolute http:// or https:// URL')
      .optional(),
```

- [ ] **Step 4: Create `src/url.ts`**

```ts
// src/url.ts
import type { Topic } from './config/schema';

const GOOGLE_NEWS_RSS_SEARCH = 'https://news.google.com/rss/search';

/** The feed to fetch for a topic: its explicit `feedUrl`, else a Google News search over its query and locale. */
export function buildFeedUrl(topic: Topic): string {
  if (topic.feedUrl) return topic.feedUrl;
  const { hl, gl, ceid } = topic.locale;
  return `${GOOGLE_NEWS_RSS_SEARCH}?q=${encodeURIComponent(topic.query)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&ceid=${encodeURIComponent(ceid)}`;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bun run typecheck && bun run test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/config/schema.ts src/url.ts test/unit/url.test.ts test/unit/config-schema.test.ts
git commit -m "feat(config): optional topic feedUrl and buildFeedUrl"
```

---

### Task 2: `translateDeepL` throws instead of returning null

**Files:**
- Modify: `src/translate.ts`
- Test: `test/unit/translate.test.ts`

**Interfaces:**
- Produces: `translateDeepL(texts: string[], authKey: string, targetLang?: string): Promise<string[]>`. Empty input → `[]` without a request. Failures throw `Error` with messages: `DeepL returned HTTP 429 (rate limited)`, `DeepL returned HTTP 456 (quota exceeded)`, `DeepL returned HTTP <status> <statusText>` for other non-2xx, `DeepL returned <n> translations for <m> texts` on a count mismatch, `DeepL request failed: <underlying message>` for network/timeout errors.
- Note for later tasks: `runDigest` catches this error and turns it into a warning; nothing else calls `translateDeepL`.

- [ ] **Step 1: Update the tests**

In `test/unit/translate.test.ts` replace every `expect(result).toBeNull()` test with a rejection test. Read the file first; the five affected tests become:

```ts
  test('throws on rate limit (429)', async () => {
    setupStatus(429);
    await expect(translateDeepL(['a'], 'key', 'RU')).rejects.toThrow(/HTTP 429.*rate limited/);
  });

  test('throws on quota exceeded (456)', async () => {
    setupStatus(456);
    await expect(translateDeepL(['a'], 'key', 'RU')).rejects.toThrow(/HTTP 456.*quota/);
  });

  test('throws on server error (500)', async () => {
    setupStatus(500);
    await expect(translateDeepL(['a'], 'key', 'RU')).rejects.toThrow(/HTTP 500/);
  });

  test('throws on network error', async () => {
    process.env.DEEPL_API_URL = 'http://localhost:1/translate';
    await expect(translateDeepL(['a'], 'key', 'RU')).rejects.toThrow(/DeepL request failed/);
  });

  test('throws if response count mismatches', async () => {
    setupSuccess(['only one']);
    await expect(translateDeepL(['a', 'b'], 'key', 'RU')).rejects.toThrow(/1 translations for 2 texts/);
  });
```

Keep the file's existing helper names (`setupStatus` / `setupSuccess` or whatever the file calls them — adapt the names above to the file, not the other way round) and keep the success, empty-input, and `targetLang` tests, changing their `expect(result)` lines only if the type no longer allows `null`.

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/unit/translate.test.ts`
Expected: the five rewritten tests FAIL (resolved with `null` instead of rejecting).

- [ ] **Step 3: Rewrite the function body in `src/translate.ts`**

```ts
export async function translateDeepL(
  texts: string[],
  authKey: string,
  targetLang: string = 'RU',
): Promise<string[]> {
  if (texts.length === 0) return [];

  const url = process.env.DEEPL_API_URL ?? DEEPL_API_URL;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${authKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texts, target_lang: targetLang }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DeepL request failed: ${msg}`);
  }

  if (response.status === 429) throw new Error('DeepL returned HTTP 429 (rate limited)');
  if (response.status === 456) throw new Error('DeepL returned HTTP 456 (quota exceeded)');
  if (!response.ok) throw new Error(`DeepL returned HTTP ${response.status} ${response.statusText}`);

  const data = (await response.json()) as DeepLResponse;
  const translations = data.translations ?? [];
  if (translations.length !== texts.length) {
    throw new Error(`DeepL returned ${translations.length} translations for ${texts.length} texts`);
  }
  return translations.map((t) => t.text);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bun run typecheck && bun run test`
Expected: `translate.test.ts` green. Typecheck will now fail in `src/pipeline.ts` (`if (translated)` on a non-nullable) — fix minimally there for this task only: replace the `if (translated) { ... } else { warnings.push(...) }` blocks in both `runDigest` and `runTopicalDigest` with:

```ts
    try {
      const translated = await translateDeepL(titles, options.deeplAuthKey, options.targetLang);
      translations = new Map(titles.map((t, i) => [t, translated[i]!]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`DeepL translation to ${options.targetLang} failed (${msg}); using original titles.`);
    }
```

(use `opts.` instead of `options.` inside `runTopicalDigest`). Then re-run; `test/integration/pipeline.test.ts` and `test/cli.test.ts` assert on `DeepL` and the language code in the warning, which this message still contains.

- [ ] **Step 5: Commit**

```bash
git add src/translate.ts src/pipeline.ts test/unit/translate.test.ts
git commit -m "refactor(translate): throw descriptive errors instead of returning null"
```

---

### Task 3: `DigestItem` shape — `url`, `translatedTitle`, required `matchedTerms`

**Files:**
- Modify: `src/digest.ts`
- Test: `test/integration/digest.test.ts`

**Interfaces:**
- Produces: `DigestItem = { score; importance; signals; tier; publishedAt: Date; title; translatedTitle?: string; source; key; matchedTerms: string[]; url?: string }`. `link` is renamed `url`; `matchedTerms` is always an array (`[]` when no match filter ran).

- [ ] **Step 1: Write the failing test**

Append to `describe('buildDigest', ...)` in `test/integration/digest.test.ts`:

```ts
  test('carries the RSS link as url and always sets matchedTerms', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai airport reopens after rain', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters', link: 'https://news.google.com/rss/articles/x' },
    ];
    const [item] = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now, heuristics: DEFAULT_CONFIG });
    expect(item!.url).toBe('https://news.google.com/rss/articles/x');
    expect(item!.matchedTerms).toEqual([]);
    expect(item!.translatedTitle).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/integration/digest.test.ts`
Expected: FAIL — `url` undefined / `matchedTerms` undefined.

- [ ] **Step 3: Update `src/digest.ts`**

`DigestItem`:

```ts
export type DigestItem = {
  score: number;
  importance: number;
  signals: string[];
  tier: ImportanceTier;
  publishedAt: Date;
  title: string;
  translatedTitle?: string;
  source: string;
  key: string;
  matchedTerms: string[];
  url?: string;
};
```

In `buildDigestWithStats`: `let matchedTerms: string[] = [];` (instead of `string[] | undefined`), and in the item literal `url: item.link,` instead of `link: item.link,`.

- [ ] **Step 4: Fix the compile fallout**

Run `bun run typecheck`. Update `src/index.ts` (both JSON serializers): `matchedTerms: d.matchedTerms,` and `googleUrl: d.url ?? null,`. Nothing else references `link` on a `DigestItem`.

- [ ] **Step 5: Run everything**

Run: `bun run typecheck && bun run test`
Expected: green (CLI JSON keys unchanged so far).

- [ ] **Step 6: Commit**

```bash
git add src/digest.ts src/index.ts test/integration/digest.test.ts
git commit -m "refactor(digest): DigestItem carries url, translatedTitle, always-present matchedTerms"
```

---

### Task 4: `renderText` and `toJson` (additive; old renderers stay until Task 6)

**Files:**
- Modify: `src/pipeline.ts` (add the new types only), `src/render.ts` (add `renderText`)
- Create: `src/json.ts`
- Test: `test/unit/render.test.ts` (add a `renderText` describe), `test/unit/json.test.ts`

**Interfaces:**
- Produces in `src/pipeline.ts` (types only, next to the existing ones):
  ```ts
  export type FetchText = (url: string) => Promise<string>;
  export type Translate = (texts: string[], targetLang: string) => Promise<string[]>;
  export type DigestResult = { sections: TopicSection[]; warnings: string[]; nextSeenKeys: Set<string>; fetchedTopics: number };
  ```
  (`TopicSection` already exists as `{ topic: Topic; items: DigestItem[] }`.)
- Produces in `src/render.ts`: `renderText(result: DigestResult, config: DigestConfig, now: Date): string` per the Global Constraints text format.
- Produces in `src/json.ts`:
  ```ts
  export function hoursAgo(publishedAt: Date, now: Date): number;   // Math.round((now - publishedAt) / 3_600_000)
  export type DigestJsonItem = { topic: string; title: string; translatedTitle: string | null; source: string; url: string | null; publishedAt: string; hoursAgo: number; score: number; importance: number; tier: ImportanceTier; signals: string[]; matchedTerms: string[] };
  export type DigestJson = { tool: string; version: string; generatedAt: string; query: { hours: number; limit: number | null; targetLang: string | null }; topics: { slug: string; name: string; count: number }[]; count: number; warnings: string[]; items: DigestJsonItem[] };
  export type JsonMeta = { tool: string; version: string; hours: number; limit?: number; targetLang?: string; now: Date };
  export function toJson(result: DigestResult, meta: JsonMeta): DigestJson;
  ```
  Deviation from the spec's `toJson(result, config, query)`: the config is not needed for JSON, so it is not a parameter.

- [ ] **Step 1: Add the types to `src/pipeline.ts`**

After the existing `TopicSection` type:

```ts
export type FetchText = (url: string) => Promise<string>;
export type Translate = (texts: string[], targetLang: string) => Promise<string[]>;

export type DigestResult = {
  sections: TopicSection[];
  warnings: string[];
  nextSeenKeys: Set<string>;
  /** Topics whose feed was fetched and parsed; 0 means nothing was retrieved. */
  fetchedTopics: number;
};
```

- [ ] **Step 2: Write the failing render tests**

Append to `test/unit/render.test.ts` (keep the existing `emojiFor` describes; the old `renderDigest`/`renderTopicalDigest` describes are deleted in Task 6):

```ts
import { renderText } from '../../src/render';
import type { DigestResult } from '../../src/pipeline';
import type { DigestConfig } from '../../src/config/schema';
import { parseConfig } from '../../src/config/schema';

const LOCALE = { hl: 'en', gl: 'AE', ceid: 'AE:en' };

function cfg(extra: Record<string, unknown> = {}): DigestConfig {
  const { locale: _l, display: _d, topics: _t, ...heuristics } = DEFAULT_CONFIG;
  return parseConfig({
    locale: LOCALE,
    display: { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' },
    topics: [
      { slug: 'economy', name: 'Economy', emoji: '💰', query: 'q' },
      { slug: 'realty', name: 'Realty', query: 'q' },
    ],
    ...heuristics,
    ...extra,
  }, 'test');
}

function item(over: Partial<DigestItem>): DigestItem {
  return {
    score: 1, importance: 0, signals: [], tier: 'neutral',
    publishedAt: new Date('2026-05-22T09:00:00Z'),
    title: 'Title', source: 'Reuters', key: over.title ?? 'k', matchedTerms: [],
    ...over,
  };
}

function result(config: DigestConfig, itemsBySlug: Record<string, DigestItem[]>, warnings: string[] = []): DigestResult {
  return {
    sections: config.topics.map((topic) => ({ topic, items: itemsBySlug[topic.slug] ?? [] })),
    warnings,
    nextSeenKeys: new Set(),
    fetchedTopics: config.topics.length,
  };
}

describe('renderText', () => {
  const now = new Date('2026-05-22T10:00:00Z');

  test('header uses display flag, name, and local date', () => {
    const c = cfg();
    const out = renderText(result(c, {}), c, new Date('2026-05-22T21:30:00Z')); // 01:30 next day in Dubai
    expect(out.startsWith('🇦🇪 UAE digest — 2026-05-23\n\n')).toBe(true);
  });

  test('renders sections in config order with emoji or bullet headings and item lines', () => {
    const c = cfg();
    const out = renderText(result(c, {
      economy: [item({ title: 'GDP up', publishedAt: new Date('2026-05-22T09:00:00Z') })],
      realty: [item({ title: 'Emaar tower sold', source: 'Arabian Business', publishedAt: new Date('2026-05-22T08:00:00Z') })],
    }), c, now);
    expect(out).toBe([
      '🇦🇪 UAE digest — 2026-05-22',
      '',
      '💰 Economy',
      '  • GDP up (Reuters, 1h ago)',
      '',
      '• Realty',
      '  • Emaar tower sold (Arabian Business, 2h ago)',
    ].join('\n'));
  });

  test('empty section prints "(no new items)"', () => {
    const c = cfg();
    expect(renderText(result(c, {}), c, now)).toContain('💰 Economy\n  (no new items)');
  });

  test('promotes important items into a top block tagged with the topic, and shows the all-promoted placeholder', () => {
    const c = cfg();
    const out = renderText(result(c, {
      economy: [item({ title: 'Missile intercepted over Abu Dhabi airspace', importance: 8, signals: ['missile', 'airspace'], tier: 'breaking' })],
    }), c, now);
    expect(out).toContain('🚨 Important\n  🛡️ Missile intercepted over Abu Dhabi airspace (Reuters, 1h ago) [missile, airspace] — Economy\n');
    expect(out).toContain('💰 Economy\n  (all items are in 🚨 Important)');
    expect(out.split('Missile intercepted').length - 1).toBe(1);
  });

  test('uses translatedTitle when present and the config emoji rules for the marker', () => {
    const c = cfg();
    const out = renderText(result(c, { economy: [item({ title: 'Heavy rain expected', translatedTitle: 'Ожидается сильный дождь' })] }), c, now);
    expect(out).toContain('  🌧️ Ожидается сильный дождь (Reuters, 1h ago)');
    expect(out).not.toContain('Heavy rain expected');
  });

  test('no importance config means no Important block and bullet emoji', () => {
    const c = parseConfig({ locale: LOCALE, topics: [{ slug: 'a', name: 'A', query: 'q' }] }, 'test');
    const out = renderText(result(c, { a: [item({ title: 'Missile intercepted', importance: 8, tier: 'breaking', signals: ['missile'] })] }), c, now);
    expect(out).not.toContain('🚨 Important');
    expect(out).toContain('• A\n  • Missile intercepted (Reuters, 1h ago)');
    expect(out.startsWith('🌐 News digest — ')).toBe(true);
  });
});
```

Add `DEFAULT_CONFIG` / `DigestItem` imports if the file does not already have them.

- [ ] **Step 3: Write the failing JSON tests**

Create `test/unit/json.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { hoursAgo, toJson } from '../../src/json';
import { parseConfig } from '../../src/config/schema';
import type { DigestItem } from '../../src/digest';
import type { DigestResult } from '../../src/pipeline';

const now = new Date('2026-05-22T10:00:00Z');
const config = parseConfig({
  locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
  topics: [{ slug: 'economy', name: 'Economy', query: 'q' }, { slug: 'realty', name: 'Realty', query: 'q' }],
}, 'test');

const gdp: DigestItem = {
  score: 7, importance: 4, signals: ['tax'], tier: 'impact',
  publishedAt: new Date('2026-05-22T08:00:00Z'),
  title: 'GDP up as tax changes land', translatedTitle: 'ВВП вырос', source: 'Reuters', key: 'k1',
  matchedTerms: ['gdp'], url: 'https://news.google.com/rss/articles/gdp',
};
const plain: DigestItem = {
  score: 0, importance: 0, signals: [], tier: 'neutral',
  publishedAt: new Date('2026-05-22T09:30:00Z'),
  title: 'Plain', source: 'Gulf News', key: 'k2', matchedTerms: [],
};

const result: DigestResult = {
  sections: [
    { topic: config.topics[0]!, items: [gdp] },
    { topic: config.topics[1]!, items: [plain] },
  ],
  warnings: ['Topic "realty" returned 0 items'],
  nextSeenKeys: new Set(['k1', 'k2']),
  fetchedTopics: 2,
};

describe('hoursAgo', () => {
  test('rounds to the nearest hour', () => {
    expect(hoursAgo(new Date('2026-05-22T09:31:00Z'), now)).toBe(0);
    expect(hoursAgo(new Date('2026-05-22T09:29:00Z'), now)).toBe(1);
  });
});

describe('toJson', () => {
  test('builds the envelope with topics, counts, and nulls for absent values', () => {
    const json = toJson(result, { tool: 'uae-news-digest', version: '9.9.9', hours: 36, now });
    expect(json).toEqual({
      tool: 'uae-news-digest',
      version: '9.9.9',
      generatedAt: '2026-05-22T10:00:00.000Z',
      query: { hours: 36, limit: null, targetLang: null },
      topics: [{ slug: 'economy', name: 'Economy', count: 1 }, { slug: 'realty', name: 'Realty', count: 1 }],
      count: 2,
      warnings: ['Topic "realty" returned 0 items'],
      items: [
        {
          topic: 'economy', title: 'GDP up as tax changes land', translatedTitle: 'ВВП вырос', source: 'Reuters',
          url: 'https://news.google.com/rss/articles/gdp', publishedAt: '2026-05-22T08:00:00.000Z', hoursAgo: 2,
          score: 7, importance: 4, tier: 'impact', signals: ['tax'], matchedTerms: ['gdp'],
        },
        {
          topic: 'realty', title: 'Plain', translatedTitle: null, source: 'Gulf News',
          url: null, publishedAt: '2026-05-22T09:30:00.000Z', hoursAgo: 1,
          score: 0, importance: 0, tier: 'neutral', signals: [], matchedTerms: [],
        },
      ],
    });
  });

  test('echoes limit and targetLang when given', () => {
    const json = toJson(result, { tool: 't', version: 'v', hours: 12, limit: 3, targetLang: 'DE', now });
    expect(json.query).toEqual({ hours: 12, limit: 3, targetLang: 'DE' });
  });

  test('is a plain JSON value', () => {
    const json = toJson(result, { tool: 't', version: 'v', hours: 12, now });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `bun test test/unit/render.test.ts test/unit/json.test.ts`
Expected: FAIL — `renderText` not exported; `../../src/json` missing.

- [ ] **Step 5: Create `src/json.ts`**

```ts
// src/json.ts
import type { DigestResult } from './pipeline';
import type { ImportanceTier } from './importance';

export function hoursAgo(publishedAt: Date, now: Date): number {
  return Math.round((now.getTime() - publishedAt.getTime()) / 3_600_000);
}

export type DigestJsonItem = {
  topic: string;
  title: string;
  translatedTitle: string | null;
  source: string;
  url: string | null;
  publishedAt: string;
  hoursAgo: number;
  score: number;
  importance: number;
  tier: ImportanceTier;
  signals: string[];
  matchedTerms: string[];
};

export type DigestJson = {
  tool: string;
  version: string;
  generatedAt: string;
  query: { hours: number; limit: number | null; targetLang: string | null };
  topics: { slug: string; name: string; count: number }[];
  count: number;
  warnings: string[];
  items: DigestJsonItem[];
};

export type JsonMeta = {
  tool: string;
  version: string;
  hours: number;
  limit?: number;
  targetLang?: string;
  now: Date;
};

/** The machine-readable envelope printed by `--json`. Items are flat, in section order, tagged with their topic slug. */
export function toJson(result: DigestResult, meta: JsonMeta): DigestJson {
  const items = result.sections.flatMap((s) =>
    s.items.map((d): DigestJsonItem => ({
      topic: s.topic.slug,
      title: d.title,
      translatedTitle: d.translatedTitle ?? null,
      source: d.source,
      url: d.url ?? null,
      publishedAt: d.publishedAt.toISOString(),
      hoursAgo: hoursAgo(d.publishedAt, meta.now),
      score: d.score,
      importance: d.importance,
      tier: d.tier,
      signals: d.signals,
      matchedTerms: d.matchedTerms,
    })),
  );
  return {
    tool: meta.tool,
    version: meta.version,
    generatedAt: meta.now.toISOString(),
    query: { hours: meta.hours, limit: meta.limit ?? null, targetLang: meta.targetLang ?? null },
    topics: result.sections.map((s) => ({ slug: s.topic.slug, name: s.topic.name, count: s.items.length })),
    count: items.length,
    warnings: result.warnings,
    items,
  };
}
```

- [ ] **Step 6: Add `renderText` to `src/render.ts`**

Add imports `import type { DigestResult } from './pipeline';` and `import type { DigestConfig } from './config/schema';` (keep the existing ones for now) and append:

```ts
function itemLine(item: DigestItem, now: Date, showSignals: boolean, emoji: readonly EmojiRule[] | undefined): string {
  const title = item.translatedTitle ?? item.title;
  const marker = showSignals && item.signals.length > 0 ? ` [${item.signals.join(', ')}]` : '';
  return `  ${emojiFor(item.title, emoji)} ${title} (${item.source}, ${hoursAgo(item.publishedAt, now)}h ago)${marker}`;
}

/** The human-readable digest: header, optional 🚨 Important block, one section per topic in config order. */
export function renderText(result: DigestResult, config: DigestConfig, now: Date): string {
  const { display } = config;
  const dateLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone: display.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const lines: string[] = [`${display.flag} ${display.name} digest — ${dateLabel}`, ''];

  const threshold = importanceThreshold(config.importance);
  const important = result.sections.flatMap((s) =>
    s.items.filter((i) => i.importance >= threshold).map((item) => ({ item, topic: s.topic })),
  );
  const importantKeys = new Set(important.map((e) => e.item.key));

  if (important.length > 0) {
    lines.push('🚨 Important');
    for (const { item, topic } of important) {
      lines.push(`${itemLine(item, now, true, config.emoji)} — ${topic.name}`);
    }
    lines.push('');
  }

  result.sections.forEach((section, i) => {
    lines.push(`${section.topic.emoji ?? '•'} ${section.topic.name}`);
    const visible = section.items.filter((item) => !importantKeys.has(item.key));
    if (visible.length === 0) {
      lines.push(section.items.length > 0 ? '  (all items are in 🚨 Important)' : '  (no new items)');
    } else {
      for (const item of visible) lines.push(itemLine(item, now, false, config.emoji));
    }
    if (i < result.sections.length - 1) lines.push('');
  });

  return lines.join('\n');
}
```

Import `hoursAgo` from `./json` at the top of `render.ts`.

- [ ] **Step 7: Run everything**

Run: `bun run typecheck && bun run test`
Expected: green; old render tests still pass because the old functions are untouched.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline.ts src/render.ts src/json.ts test/unit/render.test.ts test/unit/json.test.ts
git commit -m "feat(output): renderText and toJson over DigestResult"
```

---

### Task 5: Unified `runDigest` with injected fetch and translate

**Files:**
- Rewrite: `src/pipeline.ts`
- Rewrite: `test/integration/pipeline.test.ts`
- Delete: `test/integration/topical-digest.test.ts`
- Modify (compile fallout only, behaviour switched in Task 6): `src/index.ts`, `scripts/smoke-pack.ts` — see Step 5.

**Interfaces:**
- Produces:
  ```ts
  export type RunOptions = {
    config: DigestConfig;
    seenKeys: Set<string>;
    hours: number;
    limitOverride?: number;      // CLI --limit: applies to every topic when given
    now: Date;
    fetchText: FetchText;
    translate?: Translate;
    targetLang?: string;
  };
  export async function runDigest(opts: RunOptions): Promise<DigestResult>;
  ```
  Removed: `RunDigestOptions`, `RunDigestResult`, `RunTopicalDigestOptions`, `RunTopicalDigestResult`, `TopicFetcher`, `mergeSeenKeys`, `runTopicalDigest`.
- Warnings (exact text, tests depend on them): `Topic "<slug>" failed: <message>` (fetch rejected or RSS unparsable), `Topic "<slug>": <n> item(s) dropped — missing required keywords`, `Topic "<slug>": feed returned no items — check the query` (only when the parsed feed had zero items), `DeepL translation to <lang> failed (<message>); using original titles.`.

- [ ] **Step 1: Write the new `test/integration/pipeline.test.ts`**

Replace the whole file:

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDigest } from '../../src/pipeline';
import { parseConfig } from '../../src/config/schema';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { DigestConfig } from '../../src/config/schema';
import type { FetchText, Translate } from '../../src/pipeline';

const LOCALE = { hl: 'en', gl: 'AE', ceid: 'AE:en' };
const NOW = new Date('2026-05-22T12:00:00Z');
const RECENT = 'Fri, 22 May 2026 11:00:00 GMT';

/** Topics get a stub feedUrl so fetchText can be a Map lookup; heuristics default to the built-in UAE set. */
function config(topics: Record<string, unknown>[], extra: Record<string, unknown> = {}): DigestConfig {
  const { locale: _l, display: _d, topics: _t, ...heuristics } = DEFAULT_CONFIG;
  return parseConfig({
    locale: LOCALE,
    topics: topics.map((t) => ({ query: 'q', feedUrl: `http://stub/${t.slug}`, ...t })),
    ...heuristics,
    ...extra,
  }, 'test');
}

function rss(items: { title: string; source?: string; pubDate?: string; link?: string }[]): string {
  const body = items.map((i) =>
    `<item><title>${i.title}</title><pubDate>${i.pubDate ?? RECENT}</pubDate>` +
    (i.link ? `<link>${i.link}</link>` : '') +
    `<source url="https://example.com">${i.source ?? 'Reuters'}</source></item>`,
  ).join('');
  return `<?xml version="1.0"?><rss><channel>${body}</channel></rss>`;
}

function feeds(bySlug: Record<string, string>): FetchText {
  return async (url) => {
    const slug = url.replace('http://stub/', '');
    const xml = bySlug[slug];
    if (xml === undefined) throw new Error(`no stub feed for ${url}`);
    return xml;
  };
}

const translateOk: Translate = async (texts, lang) => texts.map((t) => `[${lang}] ${t}`);
const translateFail: Translate = async () => { throw new Error('DeepL returned HTTP 456 (quota exceeded)'); };

describe('runDigest — sections and limits', () => {
  test('renders sections in config order and applies per-topic limits', async () => {
    const cfg = config([{ slug: 'economy', name: 'Economy', limit: 2 }, { slug: 'realty', name: 'Realty', limit: 1 }]);
    const result = await runDigest({
      config: cfg, seenKeys: new Set(), hours: 36, now: NOW,
      fetchText: feeds({
        economy: rss([{ title: 'GDP up' }, { title: 'Inflation eases' }, { title: 'Bank rates hold' }]),
        realty: rss([{ title: 'Emaar tower sold' }, { title: 'Rents climb' }]),
      }),
    });
    expect(result.sections.map((s) => s.topic.slug)).toEqual(['economy', 'realty']);
    expect(result.sections[0]!.items).toHaveLength(2);
    expect(result.sections[1]!.items).toHaveLength(1);
    expect(result.fetchedTopics).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  test('limitOverride caps every topic', async () => {
    const cfg = config([{ slug: 'a', name: 'A', limit: 5 }, { slug: 'b', name: 'B', limit: 5 }]);
    const result = await runDigest({
      config: cfg, seenKeys: new Set(), hours: 36, now: NOW, limitOverride: 1,
      fetchText: feeds({ a: rss([{ title: 'One' }, { title: 'Two' }]), b: rss([{ title: 'Three' }, { title: 'Four' }]) }),
    });
    expect(result.sections.every((s) => s.items.length === 1)).toBe(true);
  });

  test('uses the topic feed URL built for each topic', async () => {
    const seen: string[] = [];
    const cfg = parseConfig({ locale: LOCALE, topics: [{ slug: 'g', name: 'G', query: 'Dubai rain' }] }, 'test');
    await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText: async (url) => { seen.push(url); return rss([]); } });
    expect(seen).toEqual(['https://news.google.com/rss/search?q=Dubai%20rain&hl=en&gl=AE&ceid=AE%3Aen']);
  });
});

describe('runDigest — dedupe and state', () => {
  test('cross-topic dedupe: the earlier topic wins', async () => {
    const cfg = config([{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }]);
    const shared = rss([{ title: 'Dubai airport reopens after rain' }]);
    const result = await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText: feeds({ a: shared, b: shared }) });
    expect(result.sections[0]!.items).toHaveLength(1);
    expect(result.sections[1]!.items).toHaveLength(0);
  });

  test('respects persisted seenKeys and advances nextSeenKeys with every selected item', async () => {
    const cfg = config([{ slug: 'a', name: 'A' }]);
    const first = await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText: feeds({ a: rss([{ title: 'GDP up' }, { title: 'Rents climb' }]) }) });
    expect(first.nextSeenKeys.size).toBe(2);
    const second = await runDigest({ config: cfg, seenKeys: first.nextSeenKeys, hours: 36, now: NOW, fetchText: feeds({ a: rss([{ title: 'GDP up' }, { title: 'Rents climb' }]) }) });
    expect(second.sections[0]!.items).toHaveLength(0);
    expect(second.warnings).toEqual([]); // already-seen items are not a "feed returned no items" problem
  });
});

describe('runDigest — warnings and failures', () => {
  test('a failing topic yields a warning and an empty section; others still render', async () => {
    const cfg = config([{ slug: 'ok', name: 'OK' }, { slug: 'bad', name: 'Bad' }]);
    const result = await runDigest({
      config: cfg, seenKeys: new Set(), hours: 36, now: NOW,
      fetchText: async (url) => { if (url.endsWith('/bad')) throw new Error('RSS fetch failed: HTTP 500 Internal Server Error'); return rss([{ title: 'GDP up' }]); },
    });
    expect(result.sections[0]!.items).toHaveLength(1);
    expect(result.sections[1]!.items).toHaveLength(0);
    expect(result.warnings).toEqual(['Topic "bad" failed: RSS fetch failed: HTTP 500 Internal Server Error']);
    expect(result.fetchedTopics).toBe(1);
  });

  test('every topic failing leaves fetchedTopics at 0', async () => {
    const cfg = config([{ slug: 'a', name: 'A' }]);
    const result = await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText: async () => { throw new Error('boom'); } });
    expect(result.fetchedTopics).toBe(0);
    expect(result.warnings).toEqual(['Topic "a" failed: boom']);
  });

  test('an empty feed produces the "feed returned no items" warning', async () => {
    const cfg = config([{ slug: 'quiet', name: 'Quiet' }]);
    const result = await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText: feeds({ quiet: rss([]) }) });
    expect(result.warnings).toEqual(['Topic "quiet": feed returned no items — check the query']);
    expect(result.fetchedTopics).toBe(1);
  });

  test('a match filter that rejects items produces a dropped-items warning and matchedTerms on survivors', async () => {
    const cfg = config([{ slug: 'schools', name: 'Schools', match: ['school'], matchMode: 'any' }]);
    const result = await runDigest({
      config: cfg, seenKeys: new Set(), hours: 36, now: NOW,
      fetchText: feeds({ schools: rss([{ title: 'Dubai schools reopen' }, { title: 'Unrelated headline' }]) }),
    });
    expect(result.sections[0]!.items.map((i) => i.title)).toEqual(['Dubai schools reopen']);
    expect(result.sections[0]!.items[0]!.matchedTerms).toEqual(['school']);
    expect(result.warnings).toEqual(['Topic "schools": 1 item(s) dropped — missing required keywords']);
  });

  test('a config without heuristic sections produces neutral items', async () => {
    const cfg = parseConfig({ locale: LOCALE, topics: [{ slug: 'a', name: 'A', query: 'q', feedUrl: 'http://stub/a' }] }, 'test');
    const result = await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText: feeds({ a: rss([{ title: 'Missile intercepted over Abu Dhabi airspace' }]) }) });
    expect(result.sections[0]!.items[0]).toMatchObject({ score: 0, importance: 0, tier: 'neutral', signals: [] });
  });
});

describe('runDigest — translation', () => {
  test('translates all titles across topics in one batch and sets translatedTitle', async () => {
    const calls: string[][] = [];
    const translate: Translate = async (texts, lang) => { calls.push(texts); return texts.map((t) => `[${lang}] ${t}`); };
    const cfg = config([{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }]);
    const result = await runDigest({
      config: cfg, seenKeys: new Set(), hours: 36, now: NOW, translate, targetLang: 'RU',
      fetchText: feeds({ a: rss([{ title: 'GDP up' }]), b: rss([{ title: 'Rents climb' }]) }),
    });
    expect(calls).toEqual([['GDP up', 'Rents climb']]);
    expect(result.sections[0]!.items[0]!.translatedTitle).toBe('[RU] GDP up');
    expect(result.sections[1]!.items[0]!.translatedTitle).toBe('[RU] Rents climb');
  });

  test('de-duplicates identical titles before translating', async () => {
    const calls: string[][] = [];
    const cfg = config([{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }], { dedupe: { similarityThreshold: 1 } });
    await runDigest({
      config: cfg, seenKeys: new Set(), hours: 36, now: NOW, targetLang: 'RU',
      translate: async (texts) => { calls.push(texts); return texts; },
      fetchText: feeds({ a: rss([{ title: 'Same headline', source: 'Reuters' }]), b: rss([{ title: 'Same headline', source: 'BBC' }]) }),
    });
    expect(calls).toEqual([['Same headline']]);
  });

  test('translation failure adds one warning and leaves titles untouched', async () => {
    const cfg = config([{ slug: 'a', name: 'A' }]);
    const result = await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, translate: translateFail, targetLang: 'RU', fetchText: feeds({ a: rss([{ title: 'GDP up' }]) }) });
    expect(result.warnings).toEqual(['DeepL translation to RU failed (DeepL returned HTTP 456 (quota exceeded)); using original titles.']);
    expect(result.sections[0]!.items[0]!.translatedTitle).toBeUndefined();
  });

  test('skips translation without targetLang or without a translator', async () => {
    let called = false;
    const cfg = config([{ slug: 'a', name: 'A' }]);
    const fetchText = feeds({ a: rss([{ title: 'GDP up' }]) });
    await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText, translate: async (t) => { called = true; return t; } });
    await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText, targetLang: 'RU' });
    expect(called).toBe(false);
  });

  test('a count mismatch from the translator is a warning, not a crash', async () => {
    const cfg = config([{ slug: 'a', name: 'A' }]);
    const result = await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, targetLang: 'RU', translate: async () => ['only one'], fetchText: feeds({ a: rss([{ title: 'GDP up' }, { title: 'Rents climb' }]) }) });
    expect(result.warnings[0]).toMatch(/DeepL translation to RU failed \(expected 2 translations, got 1\)/);
  });
});

describe('runDigest — fixture feed', () => {
  test('selects, scores, and dedupes the sample feed', async () => {
    const xml = readFileSync(join(import.meta.dir, '..', 'fixtures', 'sample-feed.xml'), 'utf-8');
    const cfg = config([{ slug: 'uae', name: 'UAE' }]);
    const result = await runDigest({ config: cfg, seenKeys: new Set(), hours: 24 * 365 * 10, now: new Date('2026-04-15T12:00:00Z'), fetchText: feeds({ uae: xml }) });
    const titles = result.sections[0]!.items.map((i) => i.title);
    // Items 1 and 4 of the fixture are near-duplicates and must collapse to one.
    expect(titles.filter((t) => /satellite/i.test(t))).toHaveLength(1);
    expect(result.sections[0]!.items.some((i) => i.score >= 5)).toBe(true); // a tier-1 source is present
  });
});
```

Adjust the fixture test's `now`/`hours` if `sample-feed.xml` dates fall outside the window — read the fixture's `pubDate`s first and pick a `now` after them.

- [ ] **Step 2: Delete the absorbed test file and run to verify failure**

```bash
git rm test/integration/topical-digest.test.ts
```

Run: `bun test test/integration/pipeline.test.ts`
Expected: FAIL — `runDigest` does not accept `config`/`fetchText` (type and runtime errors).

- [ ] **Step 3: Rewrite `src/pipeline.ts`**

```ts
// src/pipeline.ts
import { parseRss } from './rss';
import { buildDigestWithStats } from './digest';
import { buildFeedUrl } from './url';
import type { DigestItem } from './digest';
import type { DigestConfig, Topic } from './config/schema';

export type TopicSection = {
  topic: Topic;
  items: DigestItem[];
};

export type FetchText = (url: string) => Promise<string>;
export type Translate = (texts: string[], targetLang: string) => Promise<string[]>;

export type RunOptions = {
  config: DigestConfig;
  seenKeys: Set<string>;
  hours: number;
  /** CLI --limit: when given, caps every topic instead of its own `limit`. */
  limitOverride?: number;
  now: Date;
  fetchText: FetchText;
  translate?: Translate;
  targetLang?: string;
};

export type DigestResult = {
  sections: TopicSection[];
  warnings: string[];
  nextSeenKeys: Set<string>;
  /** Topics whose feed was fetched and parsed; 0 means nothing was retrieved. */
  fetchedTopics: number;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch every topic's feed (in parallel), select items per topic against a shared
 * seen-set so an earlier topic claims a story first, then translate titles in one batch.
 * Network and translation failures become warnings; the caller decides the exit code.
 */
export async function runDigest(opts: RunOptions): Promise<DigestResult> {
  const { config, now } = opts;
  const fetched = await Promise.allSettled(config.topics.map((topic) => opts.fetchText(buildFeedUrl(topic))));

  const seen = new Set(opts.seenKeys);
  const sections: TopicSection[] = [];
  const warnings: string[] = [];
  let fetchedTopics = 0;

  config.topics.forEach((topic, i) => {
    const outcome = fetched[i]!;
    if (outcome.status === 'rejected') {
      warnings.push(`Topic "${topic.slug}" failed: ${errorMessage(outcome.reason)}`);
      sections.push({ topic, items: [] });
      return;
    }

    let rssItems;
    try {
      rssItems = parseRss(outcome.value);
    } catch (err) {
      warnings.push(`Topic "${topic.slug}" failed: could not parse RSS (${errorMessage(err)})`);
      sections.push({ topic, items: [] });
      return;
    }
    fetchedTopics++;

    if (rssItems.length === 0) {
      warnings.push(`Topic "${topic.slug}": feed returned no items — check the query`);
    }

    const { items, droppedByMatch } = buildDigestWithStats(rssItems, {
      seenKeys: seen,
      hours: opts.hours,
      limit: opts.limitOverride ?? topic.limit,
      now,
      match: topic.match,
      matchMode: topic.matchMode,
      heuristics: config,
    });
    if (droppedByMatch > 0) {
      warnings.push(`Topic "${topic.slug}": ${droppedByMatch} item(s) dropped — missing required keywords`);
    }
    for (const item of items) seen.add(item.key);
    sections.push({ topic, items });
  });

  if (opts.targetLang && opts.translate) {
    const all = sections.flatMap((s) => s.items);
    const titles = [...new Set(all.map((i) => i.title))];
    if (titles.length > 0) {
      try {
        const translated = await opts.translate(titles, opts.targetLang);
        if (translated.length !== titles.length) {
          throw new Error(`expected ${titles.length} translations, got ${translated.length}`);
        }
        const byTitle = new Map(titles.map((t, i) => [t, translated[i]!]));
        for (const item of all) item.translatedTitle = byTitle.get(item.title);
      } catch (err) {
        warnings.push(`DeepL translation to ${opts.targetLang} failed (${errorMessage(err)}); using original titles.`);
      }
    }
  }

  return { sections, warnings, nextSeenKeys: seen, fetchedTopics };
}
```

- [ ] **Step 4: Run the pipeline tests**

Run: `bun test test/integration/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Do not commit yet — continue straight into Task 6**

After Step 3, `bun run typecheck` fails in `src/index.ts`, `src/lib.ts`, and `src/core.ts` because the old `runDigest`/`runTopicalDigest` signatures are gone, and the CLI is the only consumer of the pipeline. There is no meaningful intermediate state, so Tasks 5 and 6 form one review unit: finish Task 5 Steps 1–4 (pipeline tests green in isolation), then perform Task 6 in the same working tree and make Task 6's commit cover both. Do not invent a compatibility shim.

---

### Task 6: One CLI flow — flags, adapters, output, tests, golden fixture, smoke

**Files:**
- Rewrite: `src/index.ts`
- Modify: `src/lib.ts`, `src/core.ts`, `scripts/smoke-pack.ts`, `test/cli.test.ts`, `test/fixtures/cli-default-output.txt`
- Delete (old render functions): `renderDigest`, `renderTopicalDigest`, `formatItemLine` in `src/render.ts`; their tests in `test/unit/render.test.ts`

**Interfaces:**
- Consumes: `runDigest(RunOptions)`, `renderText`, `toJson`, `buildFeedUrl`, `translateDeepL` (throwing), `DEFAULT_CONFIG`, `loadConfig`, `resolveConfigPath`.
- CLI flags after this task: `--json`, `--config <path>`, `--state-file <path>`, `--hours <n>` (default 36), `--limit <n>` (no default; overrides every topic), `--timeout-ms <n>` (default 15000), `--target-lang <code>`, `--dry-run`, `--prompt`. Subcommands `manifest`, `healthcheck [--rss-url]` stay. Removed: `--region`, `--rss-url` (main command), `--match`, `--match-mode`, `--no-topics`, `--topics-config`, env `UAE_NEWS_DIGEST_TOPIC_FIXTURE`.
- Exit codes: 0 success (including partial topic failures); 1 when no topic was fetched, on usage/config/validation errors, on `--target-lang` without `DEEPL_AUTH_KEY`.
- Fetch adapter messages (tests assert substrings): timeout → `RSS request timed out after <ms>ms — retry, or pass --timeout-ms 30000`; connection → `Unable to connect to <host> — check your connection`; HTTP → `RSS fetch failed: HTTP <status> <statusText>`.

- [ ] **Step 1: Rewrite `src/index.ts`**

```ts
#!/usr/bin/env bun
import { Command } from 'commander';
import { dirname } from 'node:path';
import { DEFAULT_STATE_FILE, readSeenKeys, writeSeenKeys } from './state';
import { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from './config/load';
import { runDigest } from './pipeline';
import { renderText } from './render';
import { toJson } from './json';
import { buildFeedUrl } from './url';
import { translateDeepL } from './translate';
import { BIN_NAME, TOOL_ID, VERSION } from './meta';
import type { DigestConfig } from './config/schema';
import type { FetchText, Translate } from './pipeline';

const DESCRIPTION = 'Daily UAE news digest from Google News RSS with optional DeepL translation';
const USER_AGENT = 'Mozilla/5.0 (uae-news-digest)';

function validatePositiveNumber(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return value;
}

function resolveNow(raw: string | undefined): Date {
  if (!raw) return new Date();
  const now = new Date(raw);
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid UAE_NEWS_DIGEST_NOW: ${raw}`);
  }
  return now;
}

/** fetch with a timeout and human-readable failures; one call per topic feed. */
function makeFetchText(timeoutMs: number): FetchText {
  return async (url) => {
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const e = err as { name?: string; code?: string; message?: string };
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new Error(`RSS request timed out after ${timeoutMs}ms — retry, or pass --timeout-ms 30000`);
      }
      const detail = e.code ?? e.message ?? String(err);
      throw new Error(`Unable to connect to ${new URL(url).host} — check your connection (${detail})`);
    }
    if (!response.ok) {
      throw new Error(`RSS fetch failed: HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  };
}

function makeTranslate(deeplAuthKey: string | undefined): Translate | undefined {
  if (!deeplAuthKey) return undefined;
  return (texts, targetLang) => translateDeepL(texts, deeplAuthKey, targetLang);
}

const HELP = `
WHAT IT DOES
  Fetches one Google News RSS feed per topic, filters each to a lookback window
  (--hours), scores and de-duplicates articles against a seen-items state file,
  and prints one section per topic. Human-readable text by default; --json for
  machines.

CONFIG (auto-detected)
  Topics and heuristics come from a JSON config, found in this order:
    1. --config <path>
    2. ./digest.config.json  (current directory)
    3. $XDG_CONFIG_HOME/uae-news-digest/topics.json  (or ~/.config/...)
  Without a config the built-in UAE set is used (one topic, UAE heuristics).

OUTPUT
  Default: formatted digest text on stdout; warnings on stderr.
  --json : a single JSON object on stdout:
    {
      "tool", "version", "generatedAt",
      "query": { "hours", "limit" | null, "targetLang" | null },
      "topics": [ { "slug", "name", "count" } ],
      "count", "warnings": string[],
      "items": [ {
        "topic":           string,
        "title":           string,
        "translatedTitle": string | null,
        "source":          string,
        "url":             string | null,                // Google News article link
        "publishedAt":     string,                       // ISO-8601 UTC
        "hoursAgo":        number,
        "score":           number,
        "importance":      number,
        "tier":            "breaking" | "impact" | "neutral" | "fluff",
        "signals":         string[],
        "matchedTerms":    string[]
      } ]
    }
  In --json mode warnings go into the "warnings" array (not stderr).

STATE & DEDUP
  Seen article keys are persisted to --state-file (default ./seen_titles.txt) and
  skipped on later runs. A run only writes state when it produced items AND
  --dry-run is absent. Use --dry-run for any throwaway/inspection run.

AGENT FILTER (key-free smart pass)
  --prompt PRINTS a ready-made filter instruction and exits. Pipe the JSON items
  into an LLM with that instruction as the prompt:
    uae-news-digest --json --dry-run | claude "$(uae-news-digest --prompt)"

ENV VARS
  DEEPL_AUTH_KEY            Required by --target-lang (DeepL translation).
  UAE_NEWS_DIGEST_NOW       Override "now" (ISO-8601) for deterministic runs/tests.
  XDG_CONFIG_HOME / HOME    Used to locate the config (see CONFIG).

SUBCOMMANDS
  manifest                 Print a machine-readable tool descriptor as JSON.
  healthcheck [--rss-url]  Smoke-test the feed; prints {ok,version,latencyMs};
                           exits 0 on success, 1 on failure.

EXIT CODES
  0 success (a topic may still have failed — see warnings)
  1 no topic could be fetched, or a config/usage error (reason on stderr)

EXAMPLES
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --config ./digest.config.json --json
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE
  uae-news-digest --json --dry-run | claude "$(uae-news-digest --prompt)"`;

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

const program = new Command();

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
  .addHelpText('after', HELP);

program
  .command('manifest')
  .description('Print tool manifest as JSON')
  .action(() => {
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
  });

program
  .command('healthcheck')
  .description('Run smoke test and report status')
  .option('--rss-url <url>', 'RSS URL for deterministic smoke testing')
  .action(async function (this: Command) {
    const start = performance.now();
    try {
      const options = this.optsWithGlobals() as { rssUrl?: string };
      const rssUrl = options.rssUrl ?? buildFeedUrl(DEFAULT_CONFIG.topics[0]!);
      const res = await fetch(rssUrl, { signal: AbortSignal.timeout(10000) });
      const result = { ok: res.ok, version: VERSION, latencyMs: Math.round(performance.now() - start) };
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const result = { ok: false, version: VERSION, latencyMs: Math.round(performance.now() - start), error: message };
      console.log(JSON.stringify(result));
      process.exit(1);
    }
  });

program.action(async (options) => {
  try {
    if (options.prompt) {
      const prompt = DEFAULT_CONFIG.agentPrompt;
      if (!prompt) throw new Error('The built-in config has no agentPrompt; nothing to print.');
      process.stdout.write(prompt + '\n');
      return;
    }

    const hours = validatePositiveNumber('hours', options.hours);
    const limitOverride = options.limit === undefined ? undefined : validatePositiveNumber('limit', options.limit);
    const timeoutMs = validatePositiveNumber('timeout-ms', options.timeoutMs);
    const deeplAuthKey = process.env.DEEPL_AUTH_KEY;
    const now = resolveNow(process.env.UAE_NEWS_DIGEST_NOW);

    if (options.targetLang && !deeplAuthKey) {
      console.error(`--target-lang requires DEEPL_AUTH_KEY to be set.`);
      process.exitCode = 1;
      return;
    }

    const configPath = await resolveConfigPath({
      explicit: options.config,
      cwd: process.cwd(),
      env: process.env as Record<string, string | undefined>,
    });
    const config: DigestConfig = configPath ? await loadConfig(configPath) : DEFAULT_CONFIG;

    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
    const seenKeys = await readSeenKeys(options.stateFile);

    if (options.targetLang && deeplAuthKey) {
      console.error(`Translating to ${options.targetLang} via DeepL...`);
    }

    const result = await runDigest({
      config,
      seenKeys,
      hours,
      limitOverride,
      now,
      fetchText: makeFetchText(timeoutMs),
      translate: makeTranslate(deeplAuthKey),
      targetLang: options.targetLang,
    });

    if (options.json) {
      const json = toJson(result, { tool: TOOL_ID, version: VERSION, hours, limit: limitOverride, targetLang: options.targetLang, now });
      process.stdout.write(JSON.stringify(json, null, 2) + '\n');
    } else {
      for (const warning of result.warnings) console.error(warning);
      process.stdout.write(renderText(result, config, now) + '\n');
    }

    if (result.fetchedTopics === 0) {
      if (options.json) for (const warning of result.warnings) console.error(warning);
      process.exitCode = 1;
      return;
    }

    if (options.dryRun) console.error('(dry run — state file not updated)');
    const producedItems = result.sections.some((s) => s.items.length > 0);
    if (producedItems && !options.dryRun) {
      await writeSeenKeys(options.stateFile, result.nextSeenKeys);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});

program.exitOverride();
try {
  await program.parseAsync(process.argv);
} catch (err: any) {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  }
  console.error(err.message);
  process.exit(1);
}
```

Note the deliberate change from `process.exit(1)` to `process.exitCode = 1; return;` inside the action so buffered stdout is flushed before the process ends; the `uncaughtException` handler is dropped because every path is awaited inside the try.

- [ ] **Step 2: Remove the old renderers from `src/render.ts`**

Delete `renderDigest`, `renderTopicalDigest`, `formatItemLine`, the `REGION_PRESETS` / `LocaleContext` imports, and the `TopicSection` type import if unused. `render.ts` now contains `emojiFor`, `itemLine`, `renderText`, `RenderHeuristics` (delete `RenderHeuristics` too — nothing uses it).

In `test/unit/render.test.ts` delete the `describe('renderDigest', ...)`, `describe('renderTopicalDigest', ...)`, `describe('renderDigest 🚨 Important block', ...)` blocks and the `makeTopic` helper; keep `emojiFor` and `renderText` describes. Remove now-unused imports.

- [ ] **Step 3: Update the barrels**

`src/core.ts` — full new content:

```ts
export { DEFAULT_STATE_FILE, readSeenKeys, writeSeenKeys } from './state';
export { DEEPL_API_URL, translateDeepL } from './translate';
export type { DeepLTranslation, DeepLResponse } from './translate';
export { parseRss } from './rss';
export type { RssItem } from './rss';
export { buildDigest, buildDigestWithStats, matchTerms, parsePubDate } from './digest';
export type { DigestItem, BuildDigestOptions } from './digest';
export { runDigest } from './pipeline';
export type { RunOptions, DigestResult, TopicSection, FetchText, Translate } from './pipeline';
export { renderText, emojiFor } from './render';
export { toJson, hoursAgo } from './json';
export type { DigestJson, DigestJsonItem, JsonMeta } from './json';
export { buildFeedUrl } from './url';
export { scoreItem, titleSimilarity } from './scoring';
export { scoreImportance, importanceThreshold } from './importance';
export type { ImportanceTier, ImportanceResult } from './importance';
export { normalizeTitle, normalizeSource, makeKey } from './normalize';
export { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from './config/load';
export type { ResolveConfigOptions } from './config/load';
export { DigestConfigSchema, parseConfig } from './config/schema';
export type { DigestConfig, Topic, Locale, Display, MatchMode, Heuristics, ScoringConfig, DedupeConfig, ImportanceConfig, EmojiRule } from './config/schema';
```

`src/lib.ts` — same as `core.ts` plus `export { normalizeWhitespace } from './normalize';` and `export { escapeRegExp } from './terms';` (drop every `./region` line and the old pipeline/render names).

- [ ] **Step 4: Delete `src/region.ts` and its test**

```bash
git rm src/region.ts test/unit/region.test.ts
```

Run `bun run typecheck`; fix any remaining import of `./region` it reports (there should be none after Steps 1–3).

- [ ] **Step 5: Update `test/cli.test.ts`**

Read the file fully first. Changes:

a. Add a `/rss/fixture` route to the mock server (inside `Bun.serve`'s `fetch`), serving the sample feed:

```ts
      if (url.pathname === '/rss/fixture') {
        return new Response(await Bun.file(join(import.meta.dir, 'fixtures', 'sample-feed.xml')).text(), { headers: { 'content-type': 'application/xml' } });
      }
```

b. Add a helper after `tmpStateFile()` that writes a temp config whose single topic points at a URL, carrying the built-in UAE heuristics so scores and emoji match today's expectations:

```ts
import defaultConfig from '../src/config/default.json';

const tempDirs: string[] = [];
afterAll(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });

/** A config identical to the built-in UAE one, except the topic fetches `feedUrl`. Returns the `--config` path. */
function feedConfig(feedUrl: string, topicOverrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-feed-'));
  tempDirs.push(dir);
  const path = join(dir, 'digest.config.json');
  writeFileSync(path, JSON.stringify({
    ...defaultConfig,
    topics: [{ ...defaultConfig.topics[0], feedUrl, ...topicOverrides }],
  }));
  return path;
}
```

c. In every test that passes `'--rss-url', <url>` to the main command, replace those two array elements with `'--config', feedConfig(<url>)`. (The `healthcheck` tests keep `--rss-url`.)

d. `'default text output with items'`: unchanged apart from (c); the golden file is regenerated in Step 7.

e. `'--json produces agent-friendly envelope'`: `query` becomes `{ hours: 36, limit: null, targetLang: null }`; item key list becomes `['hoursAgo', 'importance', 'matchedTerms', 'publishedAt', 'score', 'signals', 'source', 'tier', 'title', 'topic', 'translatedTitle', 'url']`; in the item `toEqual`, rename `googleUrl` → `url`, add `topic: 'uae'` and `translatedTitle: null`; assert `Object.keys(parsed).sort()` equals `['count', 'generatedAt', 'items', 'query', 'tool', 'topics', 'version', 'warnings']` and `parsed.topics` equals `[{ slug: 'uae', name: 'UAE', count: 2 }]`. Remove any `mode` assertion.

f. `'RSS timeout ...'`: keep `toContain('timed out')`. `'RSS network failure ...'`: keep `toContain('Unable to connect')`. `'RSS HTTP error ...'`: keep `toContain('RSS fetch failed')`. All three still expect exit code 1 (single topic failed → `fetchedTopics === 0`).

g. `'empty RSS feed shows no-news message'`: assert `stdout` contains `'(no new items)'` and `stderr` contains `'feed returned no items'`; exit code stays 0.

h. `'translation ...'` tests: the warning text is now `DeepL translation to <lang> failed (<reason>); using original titles.` — keep existing substring assertions if they match, otherwise adjust to `/DeepL translation to \w+ failed/`.

i. `describe('topics mode', ...)`: delete `'--no-topics forces legacy mode ...'` and `'warns when --region is explicitly passed ...'`. In the remaining tests replace `UAE_NEWS_DIGEST_TOPIC_FIXTURE: FIXTURE_PATH` with topics carrying `feedUrl: \`${baseUrl}/rss/fixture\`` in the written config, delete the `FIXTURE_PATH` constant and the `env` entry, and rename `'--topics-config'` → `'--config'` (test name and flag). Keep `'auto-detects digest.config.json in cwd ...'` (now simply "loads digest.config.json from cwd") and `'heuristics from the config file drive emoji and the Important block'`.

j. Any test asserting on `stderr` for the `--region ... ignored` note goes away with (i).

- [ ] **Step 6: Update `scripts/smoke-pack.ts`**

Replace the CLI digest invocation (the `--rss-url` block) with a temp config:

```ts
      const stateFile = join(workDir, 'seen_titles.txt');
      const configPath = join(workDir, 'digest.config.json');
      await writeFile(configPath, JSON.stringify({
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [{ slug: 'uae', name: 'UAE', query: 'UAE', feedUrl: rssUrl, limit: 6 }],
      }));
      const digest = JSON.parse(await run([
        'bun', bin, '--json', '--config', configPath, '--state-file', stateFile, '--dry-run',
      ], consumerDir, {
        UAE_NEWS_DIGEST_NOW: '2026-03-22T08:00:00Z',
        HOME: workDir,
        XDG_CONFIG_HOME: workDir,
      }));
```

Replace the generated `core-smoke.ts` template with:

```ts
import { buildFeedUrl, runDigest, renderText, DEFAULT_CONFIG } from '@drakulavich/uae-news-digest/core';

if (!buildFeedUrl(DEFAULT_CONFIG.topics[0]).startsWith('https://news.google.com/rss/search')) {
  throw new Error('buildFeedUrl did not return a Google News RSS URL');
}

const xml = ${JSON.stringify(RSS_XML)};
const now = new Date('2026-03-22T08:00:00Z');

const result = await runDigest({
  config: DEFAULT_CONFIG,
  seenKeys: new Set(),
  hours: 36,
  limitOverride: 1,
  now,
  fetchText: async () => xml,
});

const text = renderText(result, DEFAULT_CONFIG, now);
if (result.sections[0].items.length !== 1 || !text.includes('Dubai airport reopens after rain')) {
  throw new Error('runDigest packed core smoke failed');
}
```

- [ ] **Step 7: Regenerate the golden fixture and eyeball it**

```bash
bun test test/cli.test.ts 2>&1 | head -40   # expect only the golden test failing now
UAE_NEWS_DIGEST_NOW=2026-03-22T08:00:00Z bun src/index.ts --config <path-from-a-feedConfig-run> --dry-run --state-file /tmp/x > test/fixtures/cli-default-output.txt
```

The simplest way to get the exact bytes: temporarily add `console.log(JSON.stringify(stdout))` in the golden test, run it, and write the decoded string to the fixture — or write the expected content by hand and let the test confirm. Expected content (trailing newline included):

```
🇦🇪 UAE digest — 2026-03-22

📰 UAE
  🌧️ Dubai airport reopens after rain (Reuters, 1h ago)
  📉 Abu Dhabi market overview (Gulf News, 2h ago)
```

Check by eye: flag/name from `display`, date in Asia/Dubai, section heading from the built-in topic (`📰 UAE`), two indented lines, no Important block (neither title carries an importance marker).

- [ ] **Step 8: Run everything**

Run: `bun run typecheck && bun run test && bun run smoke:pack`
Expected: all green.

- [ ] **Step 9: Commit (covers Task 5 + Task 6)**

```bash
git add -A src test scripts
git commit -m "refactor(pipeline): one config-driven runDigest, remove region mode

runDigest(config) fetches every topic through an injected fetchText,
selects per topic against a shared seen-set, and translates in one batch
through an injected translate; rendering moves to renderText/toJson.
Region mode, --region/--rss-url/--match/--match-mode/--no-topics, the
UAE_NEWS_DIGEST_TOPIC_FIXTURE env var, and src/region.ts are removed.
--topics-config becomes --config; a topic may carry feedUrl. New text and
JSON formats per the spec; golden fixture regenerated."
```

---

### Task 7: Documentation

**Files:**
- Modify: `CHANGELOG.md`, `README.md`, `CLAUDE.md`, `openspec/config.yaml`, `openspec/specs/GLOSSARY.md`

- [ ] **Step 1: CHANGELOG `[Unreleased]`** — add under the existing headings (keep PR-1 lines):

```markdown
### Changed
- **Breaking (CLI):** region mode is gone. `--region`, `--rss-url` (main command), `--match`, `--match-mode`, `--no-topics`, and `--topics-config` are removed; `--config <path>` names the config file. Without a config the built-in UAE config runs (one topic). `--limit` has no default and, when given, caps every topic. `healthcheck --rss-url` stays.
- **Breaking (output):** one text format for every run — `{flag} {name} digest — {date}`, optional `🚨 Important` block, one section per topic (a single-topic config still prints its heading); `(no new items)` / `(all items are in 🚨 Important)` replace the Russian placeholders. One JSON format: `mode` removed, `googleUrl` → `url`, new `generatedAt` and `translatedTitle`, `query.limit` is `null` unless `--limit` was passed, `topics` always present.
- **Breaking (API):** `runDigest(options)` now takes `{ config, seenKeys, hours, limitOverride?, now, fetchText, translate?, targetLang? }` and returns `{ sections, warnings, nextSeenKeys, fetchedTopics }`; rendering is `renderText(result, config, now)` and `toJson(result, meta)`. Removed: `runTopicalDigest`, `renderDigest`, `renderTopicalDigest`, `mergeSeenKeys`, `buildRssUrl`, `REGION_PRESETS`, `localeContextFor`, and the `RegionPreset`/`RssLocale`/`LocaleContext` types. `translateDeepL` throws on failure instead of returning `null`. `DigestItem.link` → `url`; `matchedTerms` is always an array; `translatedTitle` added.
- Partial failures stay warnings; the CLI exits 1 only when no topic could be fetched. The "feed returned no items — check the query" warning fires only when the feed itself was empty, not when every item was already seen.
- `display` from the config now drives the text header (flag, name, timezone).

### Added
- `topics[].feedUrl`: fetch an explicit RSS URL instead of a Google News search (used by tests and the packed-package smoke; replaces `--rss-url`).
```

- [ ] **Step 2: README** — remove the `--region`, `--rss-url`, `--no-topics`, `--match`, `--match-mode`, `--topics-config` rows and examples; add a `--config <path>` row; delete the "In region mode the Important block..." sentence and the "Legacy region mode emits..." sentence; update the JSON example to the new envelope (fields above); in the config section add `"feedUrl"` to the topic field list with one sentence; update the "How It Works" diagram's first line to `Config ──────── topics (query + locale) → one Google News RSS URL each (or feedUrl)`; change the example `uae-news-digest --region us --hours 12 --limit 10` to `uae-news-digest --hours 12 --limit 10`.

- [ ] **Step 3: CLAUDE.md** — replace the pipeline diagram with:

```
config (default.json or digest.config.json) → url.ts buildFeedUrl → fetch (CLI adapter)
  → rss.ts parseRss → digest.ts buildDigestWithStats (score, dedupe) → translate (optional)
  → render.ts renderText | json.ts toJson
```

and change "Two interfaces ..." to list `runDigest`, `renderText`, `toJson`, `loadConfig`, `DEFAULT_CONFIG`.

- [ ] **Step 4: openspec** — in `openspec/config.yaml` replace "Region presets (`uae`/`us`/`uk`/`de`) or a topics config scope the feed" with "a config file (built-in UAE config by default) defines the topics and heuristics". In `GLOSSARY.md` delete the **Region preset** row; rewrite **Topics config** → **Config** ("The JSON file (`--config`, `./digest.config.json`, or XDG) that defines locale, display, topics, and heuristics; `src/config/schema.ts`, loaded by `src/config/load.ts`; built-in default `src/config/default.json`"); rewrite **Match terms** to "per-topic `match` / `matchMode` in the config (`src/digest.ts`, `matchTerms`)"; update **Core API** to name `runDigest`, `renderText`, `toJson`, `loadConfig`.

- [ ] **Step 5: Verify and commit**

Run: `bun run typecheck && bun run test && bun run smoke:pack`

```bash
git add CHANGELOG.md README.md CLAUDE.md openspec
git commit -m "docs: region mode removed, unified text/JSON formats, feedUrl"
```

---

## Self-review

**Spec coverage (section 2 + PR 2 staging):** `RunOptions`/`DigestResult`/injected `fetchText`/`translate` → Task 5; `translatedTitle` on the item and throwing `translateDeepL` → Tasks 2–3, 5; URL builder internal (`src/url.ts`, exported from `/core` for the smoke; PR 4 decides the final surface) → Task 1; one text format with `display` and English placeholders → Task 4; one JSON format (`url`, `translatedTitle`, `generatedAt`, no `mode`) → Task 4; partial failures / exit 1 when `fetchedTopics === 0` → Tasks 5–6; sequential cross-topic dedupe → Task 5; state-write rule unchanged → Task 6; removal of region flags, `region.ts`, env fixture, `runTopicalDigest`, `renderDigest`, `renderTopicalDigest`, `mergeSeenKeys`, `buildRssUrl`, `REGION_PRESETS`, `localeContextFor` → Task 6; golden fixture regenerated and reviewed → Task 6 Step 7; docs → Task 7. `toJson` drops the unused `config` parameter (deviation recorded in Task 4). `selectItems`, `CliError`, `config` subcommands, `cli/`/`pipeline/`/`output/` folders are PR 3–4 by the spec's staging and are intentionally absent.

**Placeholders:** none. Task 5 Step 5 explicitly rules that Tasks 5 and 6 commit together instead of inventing a shim.

**Type consistency:** `FetchText`/`Translate`/`DigestResult`/`TopicSection` defined in Task 4 (types) and Task 5 (final file) with identical shapes; `renderText(result, config, now)` and `toJson(result, meta: JsonMeta)` used identically in Tasks 4 and 6; `DigestItem.url`/`translatedTitle`/`matchedTerms: string[]` from Task 3 consumed by Tasks 4–6; `buildFeedUrl(topic)` from Task 1 used in Tasks 5–6; `translateDeepL` returning `string[]` from Task 2 wrapped by `makeTranslate` in Task 6. Warning strings in Task 5's code and tests match character for character.
