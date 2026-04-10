# Refactor: Split lib.ts into Focused Modules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 367-line `src/lib.ts` God Object into 9 focused modules, make rendering region-aware, remove the `fetchFn` testing parameter, and move CLI-only code out of the library.

**Architecture:** Extract each concern into its own module file. `lib.ts` becomes a barrel re-export so existing imports keep working. Then update `renderDigest` to accept a region for header/flag, add `region` to `RunDigestOptions`, remove `fetchFn` from `translateDeepL`, and move `validatePositiveNumber` into `index.ts`.

**Tech Stack:** Bun, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/region.ts` | Create | `REGION_PRESETS`, `RegionPreset` type, `buildRssUrl` |
| `src/rss.ts` | Create | `parseRss`, `RssItem` type (imports `normalizeWhitespace` from normalize) |
| `src/normalize.ts` | Create | `normalizeWhitespace`, `normalizeTitle`, `normalizeSource`, `makeKey` |
| `src/scoring.ts` | Create | `scoreItem`, `titleSimilarity`, synonyms, extractWords |
| `src/digest.ts` | Create | `buildDigest`, `BuildDigestOptions`, `DigestItem` type |
| `src/render.ts` | Create | `renderDigest`, `emojiFor` |
| `src/translate.ts` | Create | `translateDeepL`, `DEEPL_API_URL`, DeepL types |
| `src/state.ts` | Create | `readSeenKeys`, `writeSeenKeys`, `DEFAULT_STATE_FILE` |
| `src/pipeline.ts` | Create | `runDigest`, `mergeSeenKeys`, `RunDigestOptions` type |
| `src/lib.ts` | Rewrite | Barrel re-export from all modules above |
| `src/core.ts` | Modify | Update exports for new modules |
| `src/index.ts` | Modify | Inline `validatePositiveNumber`, pass `region` to `runDigest` |
| `test/lib.test.ts` | Modify | Update for region-aware rendering, remove `fetchFn` usage |

---

### Task 1: Extract all modules from lib.ts (atomic — must be done together)

This is the core extraction. All 9 modules and the barrel must be created in one commit, because any partial extraction breaks the barrel re-export chain. Tests must pass after this commit with zero behavior changes.

**Files:**
- Create: `src/region.ts`, `src/normalize.ts`, `src/rss.ts`, `src/scoring.ts`, `src/digest.ts`, `src/render.ts`, `src/translate.ts`, `src/state.ts`, `src/pipeline.ts`
- Rewrite: `src/lib.ts`

- [ ] **Step 1: Create `src/region.ts`**

```typescript
export type RegionPreset = {
  q: string;
  hl: string;
  gl: string;
  ceid: string;
  flag: string;
  name: string;
};

export const REGION_PRESETS: Record<string, RegionPreset> = {
  uae: { q: 'UAE OR "Abu Dhabi" OR Dubai', hl: 'en', gl: 'AE', ceid: 'AE:en', flag: '🇦🇪', name: 'UAE' },
  us:  { q: 'USA OR "United States"', hl: 'en', gl: 'US', ceid: 'US:en', flag: '🇺🇸', name: 'US' },
  uk:  { q: 'UK OR "United Kingdom" OR London', hl: 'en', gl: 'GB', ceid: 'GB:en', flag: '🇬🇧', name: 'UK' },
  de:  { q: 'Deutschland OR Berlin OR München', hl: 'de', gl: 'DE', ceid: 'DE:de', flag: '🇩🇪', name: 'Germany' },
  ru:  { q: 'Россия OR Москва', hl: 'ru', gl: 'RU', ceid: 'RU:ru', flag: '🇷🇺', name: 'Russia' },
};

export function buildRssUrl(region: string): string {
  const preset = REGION_PRESETS[region.toLowerCase()];
  if (!preset) {
    const available = Object.keys(REGION_PRESETS).join(', ');
    throw new Error(`Unknown region "${region}". Available: ${available}`);
  }
  const q = encodeURIComponent(preset.q);
  return `https://news.google.com/rss/search?q=${q}&hl=${preset.hl}&gl=${preset.gl}&ceid=${preset.ceid}`;
}
```

- [ ] **Step 2: Create `src/normalize.ts`**

```typescript
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(title: string): string {
  return normalizeWhitespace(title.replace(/\s+-\s+[^-]+$/, '').trim());
}

export function normalizeSource(source?: string): string {
  return normalizeWhitespace(source ?? '');
}

export function makeKey(title: string, source?: string): string {
  return `${normalizeTitle(title).toLowerCase()} || ${normalizeSource(source).toLowerCase()}`;
}
```

- [ ] **Step 3: Create `src/rss.ts`**

```typescript
import { XMLParser } from 'fast-xml-parser';
import { normalizeWhitespace } from './normalize';

export type RssItem = {
  title: string;
  pubDate?: string;
  source?: string;
};

export function parseRss(xml: string): RssItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(xml) as any;
  const rawItems = parsed?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items.map((item: any) => ({
    title: normalizeWhitespace(String(item.title ?? '')),
    pubDate: item.pubDate ? String(item.pubDate) : undefined,
    source: typeof item.source === 'string'
      ? item.source
      : item.source?.['#text']
        ? String(item.source['#text'])
        : undefined,
  }));
}
```

- [ ] **Step 4: Create `src/scoring.ts`**

```typescript
const DEFAULT_PREFER_RE = /(reuters|the national|gulf news|khaleej times|cnbc|ap news|bbc|anadolu|zawya)/i;
const UAE_RE = /(UAE|Dubai|Abu Dhabi|Sharjah|Ras al-Khaimah|Fujairah)/i;
const PRIORITY_RE = /(weather|rain|missile|drone|airspace|defence|defense|property|market|flight|shipping|Hezbollah|Iran|airport|Hormuz)/i;

const SYNONYMS: Record<string, string> = {
  drone: 'uav', drones: 'uav', uavs: 'uav', uav: 'uav',
  intercept: 'engage', intercepted: 'engage', intercepts: 'engage', engage: 'engage', engaged: 'engage', engages: 'engage',
  missile: 'missile', missiles: 'missile', ballistic: 'missile',
  defence: 'defense', defences: 'defense', defenses: 'defense', defense: 'defense',
  iranian: 'iran', iran: 'iran',
  airport: 'airport', airspace: 'airport', flights: 'flight', flight: 'flight',
  property: 'realestate', housing: 'realestate', realestate: 'realestate',
  rain: 'weather', weather: 'weather', flooding: 'weather', flood: 'weather',
  shipping: 'shipping', hormuz: 'shipping',
  school: 'education', schools: 'education', education: 'education',
  says: '_skip', said: '_skip', report: '_skip', reports: '_skip',
};

function extractWords(title: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'it', 'its', 'by', 'from', 'with', 'as', 'after', 'that', 'this', 'new', 'amid', '_skip']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map(w => SYNONYMS[w] ?? w)
    .filter(w => w.length > 1 && !stop.has(w));
}

export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(extractWords(a));
  const wb = new Set(extractWords(b));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}

export { DEFAULT_PREFER_RE };

export function scoreItem(title: string, source: string, preferRe = DEFAULT_PREFER_RE): number {
  let score = 0;
  if (preferRe.test(source)) score += 3;
  if (UAE_RE.test(title)) score += 2;
  if (PRIORITY_RE.test(title)) score += 2;
  return score;
}
```

- [ ] **Step 5: Create `src/digest.ts`**

```typescript
import { normalizeTitle, normalizeSource, makeKey } from './normalize';
import { scoreItem, titleSimilarity, DEFAULT_PREFER_RE } from './scoring';
import type { RssItem } from './rss';

const DEFAULT_SKIP_RE = /(opinion|daily mail|travel and tour world|tradingview|cycling|horse|football|msn|substack|influencer|hotel room|fitness journey|baskin-robbins)/i;
const FUZZY_SIMILARITY_THRESHOLD = 0.45;

export type DigestItem = {
  score: number;
  publishedAt: Date;
  title: string;
  source: string;
  key: string;
};

export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  skipRe?: RegExp;
  preferRe?: RegExp;
};

export function parsePubDate(pubDate: string | undefined, now = new Date()): Date {
  if (!pubDate) return now;
  const parsed = new Date(pubDate);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

export function buildDigest(items: RssItem[], options: BuildDigestOptions): DigestItem[] {
  const { seenKeys, hours, limit, now = new Date(), skipRe = DEFAULT_SKIP_RE, preferRe = DEFAULT_PREFER_RE } = options;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const unique = new Map<string, DigestItem>();

  for (const item of items) {
    const title = normalizeTitle(item.title);
    const source = normalizeSource(item.source);
    if (!title) continue;
    if (skipRe.test(title) || skipRe.test(source)) continue;

    const publishedAt = parsePubDate(item.pubDate, now);
    if (publishedAt < cutoff) continue;

    const key = makeKey(title, source);
    if (seenKeys.has(key)) continue;

    const digestItem: DigestItem = {
      score: scoreItem(title, source, preferRe),
      publishedAt,
      title,
      source,
      key,
    };

    const existing = unique.get(key);
    if (existing) {
      const replace = digestItem.score > existing.score || (digestItem.score === existing.score && digestItem.publishedAt > existing.publishedAt);
      if (replace) unique.set(key, digestItem);
      continue;
    }

    let fuzzyDup = false;
    for (const [existingKey, existingItem] of unique) {
      if (titleSimilarity(title, existingItem.title) >= FUZZY_SIMILARITY_THRESHOLD) {
        if (digestItem.score > existingItem.score || (digestItem.score === existingItem.score && digestItem.publishedAt > existingItem.publishedAt)) {
          unique.delete(existingKey);
          unique.set(key, digestItem);
        }
        fuzzyDup = true;
        break;
      }
    }

    if (!fuzzyDup) {
      unique.set(key, digestItem);
    }
  }

  return [...unique.values()]
    .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime() || a.title.localeCompare(b.title))
    .slice(0, limit);
}
```

- [ ] **Step 6: Create `src/render.ts`**

```typescript
import { REGION_PRESETS } from './region';
import type { DigestItem } from './digest';

export function emojiFor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('rain') || t.includes('weather') || t.includes('погода') || t.includes('дожд')) return '🌧️';
  if (t.includes('property') || t.includes('market') || t.includes('недвижимост') || t.includes('рынок')) return '📉';
  if (t.includes('flight') || t.includes('airspace') || t.includes('airport') || t.includes('рейс') || t.includes('аэропорт') || t.includes('воздушн')) return '✈️';
  if (t.includes('missile') || t.includes('drone') || t.includes('defence') || t.includes('defense') || t.includes('air attack') || t.includes('ракет') || t.includes('бпла') || t.includes('пво')) return '🛡️';
  if (t.includes('shipping') || t.includes('hormuz') || t.includes('судоход') || t.includes('ормуз')) return '⛴️';
  if (t.includes('hezbollah') || t.includes('terror') || t.includes('хезболла') || t.includes('террор')) return '🚨';
  if (t.includes('school') || t.includes('education') || t.includes('школ') || t.includes('образован')) return '🎓';
  if (t.includes('oil') || t.includes('gas') || t.includes('нефт') || t.includes('газ')) return '🛢️';
  if (t.includes('visa') || t.includes('виз')) return '🛂';
  return '•';
}

export function renderDigest(items: DigestItem[], translations?: Map<string, string>, now: Date = new Date(), region: string = 'uae'): string {
  const preset = REGION_PRESETS[region.toLowerCase()];
  const flag = preset?.flag ?? '📰';
  const name = preset?.name ?? 'News';

  if (items.length === 0) {
    return `${flag} ${name} Latest News Digest\n\n• No significant news in the check window.`;
  }

  const lines = [`${flag} ${name} Latest News Digest`, ''];
  for (const item of items) {
    const title = translations?.get(item.title) ?? item.title;
    const hoursAgo = Math.round((now.getTime() - item.publishedAt.getTime()) / 3_600_000);
    lines.push(`${emojiFor(item.title)} ${title} (${item.source}, ${hoursAgo}h ago)`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 7: Create `src/translate.ts`**

```typescript
export const DEEPL_API_URL = process.env.DEEPL_API_URL ?? 'https://api-free.deepl.com/v2/translate';

export type DeepLTranslation = {
  detected_source_language: string;
  text: string;
};

export type DeepLResponse = {
  translations: DeepLTranslation[];
};

export async function translateDeepL(
  texts: string[],
  authKey: string,
  targetLang: string = 'RU',
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<string[] | null> {
  if (texts.length === 0) return [];

  try {
    const response = await fetchFn(DEEPL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${authKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        target_lang: targetLang,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429 || response.status === 456 || !response.ok) {
      return null;
    }

    const data = (await response.json()) as DeepLResponse;

    if (!data.translations || data.translations.length !== texts.length) {
      return null;
    }

    return data.translations.map((t) => t.text);
  } catch {
    return null;
  }
}
```

- [ ] **Step 8: Create `src/state.ts`**

```typescript
export const DEFAULT_STATE_FILE = './seen_titles.txt';

export async function readSeenKeys(stateFile: string): Promise<Set<string>> {
  const file = Bun.file(stateFile);
  if (!(await file.exists())) return new Set();
  const text = await file.text();
  return new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

export async function writeSeenKeys(stateFile: string, seenKeys: Set<string>): Promise<void> {
  await Bun.write(stateFile, `${[...seenKeys].sort().join('\n')}\n`);
}
```

- [ ] **Step 9: Create `src/pipeline.ts`**

```typescript
import { parseRss } from './rss';
import { buildDigest } from './digest';
import { renderDigest } from './render';
import { translateDeepL } from './translate';
import type { DigestItem } from './digest';

export type RunDigestOptions = {
  xml: string;
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  deeplAuthKey?: string;
  targetLang?: string;
  region?: string;
  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;
};

export function mergeSeenKeys(seenKeys: Set<string>, digest: DigestItem[]): Set<string> {
  return new Set([...seenKeys, ...digest.map((item) => item.key)]);
}

export async function runDigest(options: RunDigestOptions): Promise<{ digest: DigestItem[]; output: string; nextSeenKeys: Set<string> }> {
  const items = parseRss(options.xml);
  const digest = buildDigest(items, {
    seenKeys: options.seenKeys,
    hours: options.hours,
    limit: options.limit,
    now: options.now,
  });

  let translations: Map<string, string> | undefined;

  if (options.targetLang && options.deeplAuthKey && digest.length > 0) {
    const titles = digest.map((d) => d.title);
    const translated = await translateDeepL(titles, options.deeplAuthKey, options.targetLang, options.fetchFn);
    if (translated) {
      translations = new Map();
      for (let i = 0; i < titles.length; i++) {
        translations.set(titles[i]!, translated[i]!);
      }
    }
  }

  return {
    digest,
    output: renderDigest(digest, translations, options.now ?? new Date(), options.region ?? 'uae'),
    nextSeenKeys: mergeSeenKeys(options.seenKeys, digest),
  };
}
```

- [ ] **Step 10: Rewrite `src/lib.ts` as barrel**

```typescript
// Barrel re-export — preserves existing import paths
export { REGION_PRESETS, buildRssUrl } from './region';
export type { RegionPreset } from './region';
export { normalizeWhitespace, normalizeTitle, normalizeSource, makeKey } from './normalize';
export { parseRss } from './rss';
export type { RssItem } from './rss';
export { scoreItem, titleSimilarity } from './scoring';
export { buildDigest, parsePubDate } from './digest';
export type { DigestItem, BuildDigestOptions } from './digest';
export { emojiFor, renderDigest } from './render';
export { translateDeepL, DEEPL_API_URL } from './translate';
export type { DeepLTranslation, DeepLResponse } from './translate';
export { readSeenKeys, writeSeenKeys, DEFAULT_STATE_FILE } from './state';
export { runDigest, mergeSeenKeys } from './pipeline';
export type { RunDigestOptions } from './pipeline';

export function validatePositiveNumber(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return value;
}
```

Note: `validatePositiveNumber` stays in the barrel for now so tests and index.ts keep working. We move it in Task 3.

- [ ] **Step 11: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All 63 tests pass (zero behavior changes)

- [ ] **Step 12: Commit**

```bash
git add src/region.ts src/normalize.ts src/rss.ts src/scoring.ts src/digest.ts src/render.ts src/translate.ts src/state.ts src/pipeline.ts src/lib.ts
git commit -m "refactor: split lib.ts into focused modules with barrel re-export"
```

---

### Task 2: Update core.ts exports and add region to index.ts

**Files:**
- Modify: `src/core.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update core.ts exports**

Replace the entire `src/core.ts` with:

```typescript
export { REGION_PRESETS, buildRssUrl } from './region';
export type { RegionPreset } from './region';
export { DEFAULT_STATE_FILE, readSeenKeys, writeSeenKeys } from './state';
export { DEEPL_API_URL, translateDeepL } from './translate';
export type { DeepLTranslation, DeepLResponse } from './translate';
export { parseRss } from './rss';
export type { RssItem } from './rss';
export { buildDigest, parsePubDate } from './digest';
export type { DigestItem, BuildDigestOptions } from './digest';
export { runDigest, mergeSeenKeys } from './pipeline';
export type { RunDigestOptions } from './pipeline';
export { renderDigest, emojiFor } from './render';
export { scoreItem, titleSimilarity } from './scoring';
export { normalizeTitle, normalizeSource, makeKey } from './normalize';
```

- [ ] **Step 2: Pass region to runDigest in index.ts**

In `src/index.ts`, update the `runDigest` call (around line 111-118). Add `region: options.region` to the options:

```typescript
    const result = await runDigest({
      xml,
      seenKeys,
      hours,
      limit,
      deeplAuthKey,
      targetLang: options.targetLang,
      region: options.region,
    });
```

- [ ] **Step 3: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All 63 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/core.ts src/index.ts
git commit -m "refactor: update core.ts exports, pass region to runDigest"
```

---

### Task 3: Move validatePositiveNumber to index.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/lib.ts`

- [ ] **Step 1: Inline validatePositiveNumber in index.ts**

In `src/index.ts`, remove `validatePositiveNumber` from the import list. Add the function directly in the file, before `const program`:

```typescript
function validatePositiveNumber(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return value;
}
```

- [ ] **Step 2: Remove validatePositiveNumber from lib.ts barrel**

In `src/lib.ts`, remove the `validatePositiveNumber` function definition (the last block in the file).

- [ ] **Step 3: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All 63 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/lib.ts
git commit -m "refactor: move validatePositiveNumber to CLI, out of library"
```

---

### Task 4: Update tests for region-aware rendering

**Files:**
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Update renderDigest tests to pass region parameter**

In `test/lib.test.ts`, update the `renderDigest` describe block. The key change: `renderDigest` now takes a 4th `region` parameter. Update tests to pass it and test the region-aware header:

Replace the `describe('renderDigest', ...)` block with:

```typescript
describe('renderDigest', () => {
  const now = new Date('2026-03-22T08:00:00Z');
  const sampleItem: DigestItem = {
    score: 5,
    publishedAt: new Date('2026-03-22T07:00:00Z'),
    title: 'Dubai property sector shows early signs of weakness',
    source: 'Reuters',
    key: makeKey('Dubai property sector shows early signs of weakness', 'Reuters'),
  };

  test('prints UAE digest header by default', () => {
    const output = renderDigest([sampleItem], undefined, now);
    expect(output).toContain('🇦🇪 UAE Latest News Digest');
    expect(output).toContain('📉');
    expect(output).toContain('Dubai property sector shows early signs of weakness');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('prints region-specific header for US', () => {
    const output = renderDigest([sampleItem], undefined, now, 'us');
    expect(output).toContain('🇺🇸 US Latest News Digest');
  });

  test('prints region-specific header for DE', () => {
    const output = renderDigest([sampleItem], undefined, now, 'de');
    expect(output).toContain('🇩🇪 Germany Latest News Digest');
  });

  test('prints generic header for unknown region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'xx');
    expect(output).toContain('📰 News Latest News Digest');
  });

  test('shows 0h ago for very recent items', () => {
    const recentItem: DigestItem = {
      ...sampleItem,
      publishedAt: new Date('2026-03-22T07:45:00Z'),
    };
    const output = renderDigest([recentItem], undefined, now);
    expect(output).toContain('Reuters, 0h ago');
  });

  test('uses DeepL translations when provided', () => {
    const translations = new Map([
      ['Dubai property sector shows early signs of weakness', 'Сектор недвижимости Дубая'],
    ]);
    const output = renderDigest([sampleItem], translations, now);
    expect(output).toContain('Сектор недвижимости Дубая');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('keeps original title when translations map has no entry', () => {
    const translations = new Map<string, string>();
    const output = renderDigest([sampleItem], translations, now);
    expect(output).toContain('Dubai property sector shows early signs of weakness');
  });

  test('prints empty message for no items', () => {
    const output = renderDigest([]);
    expect(output).toContain('No significant news in the check window.');
  });
});
```

- [ ] **Step 2: Update runDigest tests to use region**

In the `describe('runDigest', ...)` block, update the test that checks for `'🇦🇪 UAE Latest News Digest'` to also verify region is passed through. No structural changes needed — the existing tests pass `undefined` for region which defaults to `'uae'`, so the header stays `🇦🇪 UAE`.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass (63 existing + 3 new region tests = 66 total)

- [ ] **Step 4: Commit**

```bash
git add test/lib.test.ts
git commit -m "test: add region-aware rendering tests"
```

---

### Task 5: Remove fetchFn from translateDeepL

**Files:**
- Modify: `src/translate.ts`
- Modify: `src/pipeline.ts`
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Remove fetchFn parameter from translateDeepL**

In `src/translate.ts`, change the `translateDeepL` signature. Remove the `fetchFn` parameter and use `globalThis.fetch` directly:

```typescript
export async function translateDeepL(
  texts: string[],
  authKey: string,
  targetLang: string = 'RU',
): Promise<string[] | null> {
  if (texts.length === 0) return [];

  try {
    const response = await fetch(DEEPL_API_URL, {
```

(rest of the function stays the same, just remove all references to `fetchFn` and use `fetch` directly)

- [ ] **Step 2: Remove fetchFn from RunDigestOptions and runDigest**

In `src/pipeline.ts`, remove `fetchFn` from `RunDigestOptions` type and from the `translateDeepL` call:

```typescript
export type RunDigestOptions = {
  xml: string;
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  deeplAuthKey?: string;
  targetLang?: string;
  region?: string;
};
```

Update the `translateDeepL` call in `runDigest`:
```typescript
    const translated = await translateDeepL(titles, options.deeplAuthKey, options.targetLang);
```

- [ ] **Step 3: Update lib.ts barrel if needed**

Check that `src/lib.ts` barrel doesn't re-export `fetchFn` or reference it. It shouldn't since it only re-exports types and functions.

- [ ] **Step 4: Update unit tests to use DEEPL_API_URL env var**

In `test/lib.test.ts`, the `translateDeepL` tests currently pass `mockFetch` as 4th argument. Instead, set up a local test server (like cli.test.ts does) and override `DEEPL_API_URL`.

Replace the translateDeepL helper functions and describe block:

```typescript
import { beforeAll, afterAll } from 'bun:test';
import type { Server } from 'bun';
```

(These imports should already exist or be added to the existing import at line 1)

Add a test server for DeepL tests. Before the `describe('translateDeepL', ...)` block, add:

```typescript
let deeplServer: Server;
let deeplUrl: string;
let deeplHandler: (req: Request) => Response;

beforeAll(() => {
  deeplHandler = () => new Response(JSON.stringify({
    translations: [{ detected_source_language: 'EN', text: 'translated' }],
  }), { headers: { 'content-type': 'application/json' } });

  deeplServer = Bun.serve({
    port: 0,
    fetch(req) { return deeplHandler(req); },
  });
  deeplUrl = `http://localhost:${deeplServer.port}`;
  process.env.DEEPL_API_URL = deeplUrl;
});

afterAll(() => {
  deeplServer.stop(true);
  delete process.env.DEEPL_API_URL;
});
```

Then rewrite the `describe('translateDeepL', ...)` block to set `deeplHandler` per test instead of passing `mockFetch`:

```typescript
describe('translateDeepL', () => {
  test('returns translated texts on success', async () => {
    deeplHandler = () => new Response(JSON.stringify({
      translations: [
        { detected_source_language: 'EN', text: 'Рынок Дубая растёт' },
        { detected_source_language: 'EN', text: 'Аэропорт Абу-Даби открыт' },
      ],
    }), { headers: { 'content-type': 'application/json' } });

    const result = await translateDeepL(
      ['Dubai market rises', 'Abu Dhabi airport reopens'],
      'fake-key',
      'RU',
    );
    expect(result).toEqual(['Рынок Дубая растёт', 'Аэропорт Абу-Даби открыт']);
  });

  test('returns empty array for empty input', async () => {
    const result = await translateDeepL([], 'fake-key');
    expect(result).toEqual([]);
  });

  test('returns null on rate limit (429)', async () => {
    deeplHandler = () => new Response('Rate limited', { status: 429 });
    const result = await translateDeepL(['test'], 'fake-key', 'RU');
    expect(result).toBeNull();
  });

  test('returns null on quota exceeded (456)', async () => {
    deeplHandler = () => new Response('Quota exceeded', { status: 456 });
    const result = await translateDeepL(['test'], 'fake-key', 'RU');
    expect(result).toBeNull();
  });

  test('returns null on server error (500)', async () => {
    deeplHandler = () => new Response('Server error', { status: 500 });
    const result = await translateDeepL(['test'], 'fake-key', 'RU');
    expect(result).toBeNull();
  });

  test('returns null if response count mismatches', async () => {
    deeplHandler = () => new Response(JSON.stringify({
      translations: [{ detected_source_language: 'EN', text: 'only one' }],
    }), { headers: { 'content-type': 'application/json' } });
    const result = await translateDeepL(['text one', 'text two'], 'fake-key', 'RU');
    expect(result).toBeNull();
  });

  test('passes targetLang to DeepL API', async () => {
    let capturedBody: any;
    deeplHandler = (req: Request) => {
      req.json().then(body => { capturedBody = body; });
      return new Response(JSON.stringify({
        translations: [{ detected_source_language: 'EN', text: 'Markt in Dubai steigt' }],
      }), { headers: { 'content-type': 'application/json' } });
    };

    await translateDeepL(['Dubai market rises'], 'fake-key', 'DE');
    // Wait a tick for the async body parse
    await new Promise(r => setTimeout(r, 10));
    expect(capturedBody.target_lang).toBe('DE');
  });
});
```

Also remove the old `mockDeepLFetch` and `mockDeepLFetchError` helper functions at the top of the file. Update the `runDigest` tests to remove `fetchFn` from their options:

In each `runDigest` test that passes `fetchFn: mockFetch`, remove that property. For the test "uses DeepL when key and targetLang are provided", set `deeplHandler` before calling `runDigest`:

```typescript
  test('uses DeepL when key and targetLang are provided', async () => {
    deeplHandler = () => new Response(JSON.stringify({
      translations: [
        { detected_source_language: 'EN', text: 'Аэропорт Дубая возобновил работу после дождя' },
        { detected_source_language: 'EN', text: 'Обзор рынка Абу-Даби' },
      ],
    }), { headers: { 'content-type': 'application/json' } });

    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      deeplAuthKey: 'fake-key',
      targetLang: 'RU',
    });

    expect(result.output).toContain('Аэропорт Дубая возобновил работу после дождя');
    expect(result.output).toContain('Обзор рынка Абу-Даби');
    expect(result.output).toContain('1h ago');
    expect(result.output).toContain('2h ago');
    expect(result.digest).toHaveLength(2);
  });
```

For "falls back to English when DeepL fails":
```typescript
  test('falls back to English when DeepL fails', async () => {
    deeplHandler = () => new Response('Server error', { status: 500 });

    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      deeplAuthKey: 'fake-key',
      targetLang: 'RU',
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('Reuters, 1h ago');
    expect(result.digest).toHaveLength(2);
  });
```

For "skips DeepL when no targetLang", remove `fetchFn` and the `deeplCalled` tracking (since we can't intercept fetch anymore without fetchFn). Simplify to just check the output is English:

```typescript
  test('skips DeepL when no targetLang', async () => {
    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      deeplAuthKey: 'fake-key',
    });

    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('1h ago');
  });
```

- [ ] **Step 5: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/translate.ts src/pipeline.ts src/lib.ts test/lib.test.ts
git commit -m "refactor: remove fetchFn parameter, use DEEPL_API_URL env var for testing"
```
