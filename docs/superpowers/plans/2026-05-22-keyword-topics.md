# Keyword Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a topic-driven digest mode where one CLI run fetches and renders N labelled sections (e.g. "Экономика ОАЭ", "Недвижимость", "Иран → ОАЭ") driven by a JSON config file, while leaving the existing single-region path intact.

**Architecture:** Add a thin orchestration layer (`runTopicalDigest`) above the existing `runDigest`. A new `topics.ts` loads/validates a JSON config; `buildRssUrl` gains an overload for raw `{q, hl, gl, ceid}`. The CLI auto-detects the config file in three locations and branches; if no config is found, behaviour is unchanged. Inter-topic dedup is "first topic in config wins"; one DeepL batch covers all titles together.

**Tech Stack:** Bun, TypeScript (strict), Commander, `bun:test`. No new dependencies — JSON parsed via `Bun.file().json()`.

---

## Spec reference

Source of truth: `docs/superpowers/specs/2026-05-22-keyword-topics-design.md`. Re-read it before starting.

## File map

| file | action | responsibility |
|---|---|---|
| `src/topics.ts` | create | `TopicConfig`, `TopicsConfig` types; `loadTopicsConfig(path)`; `resolveTopicsConfigPath(cwd, env)` |
| `src/region.ts` | modify | overload `buildRssUrl` to accept `{q, hl, gl, ceid}` |
| `src/pipeline.ts` | modify | add `runTopicalDigest()` and `TopicSection` / `RunTopicalDigestOptions` / `RunTopicalDigestResult` types |
| `src/render.ts` | modify | add `renderTopicalDigest(sections, translations, now)` |
| `src/index.ts` | modify | resolve config path, branch pipelines, new `--topics-config` / `--no-topics` flags, `mode` in JSON output |
| `src/lib.ts` | modify | re-export new symbols |
| `src/core.ts` | modify | re-export `loadTopicsConfig`, types, `runTopicalDigest` |
| `test/unit/topics.test.ts` | create | config load + validation |
| `test/unit/region.test.ts` | modify | tests for object-form `buildRssUrl` |
| `test/unit/render.test.ts` | modify | tests for `renderTopicalDigest` |
| `test/integration/topical-digest.test.ts` | create | end-to-end `runTopicalDigest` with stub fetcher + DeepL server |
| `test/cli.test.ts` | modify | auto-detect config, `--no-topics`, warnings, JSON `mode` |
| `README.md` | modify | document topics mode and config schema |

---

## Task 1: `buildRssUrl` accepts a raw locale+query object

**Files:**
- Modify: `src/region.ts`
- Test: `test/unit/region.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/region.test.ts` inside the existing `describe('buildRssUrl', ...)` block (just before its closing `});`):

```typescript
  test('accepts a raw locale+query object', () => {
    const url = buildRssUrl({
      q: '(Iran OR Tehran) AND (UAE OR oil)',
      hl: 'en',
      gl: 'AE',
      ceid: 'AE:en',
    });
    expect(url).toContain('news.google.com/rss/search');
    expect(url).toContain('Iran');
    expect(url).toContain('hl=en');
    expect(url).toContain('gl=AE');
    expect(url).toContain('ceid=AE%3Aen');
  });

  test('object form percent-encodes the query', () => {
    const url = buildRssUrl({ q: 'a b "c"', hl: 'en', gl: 'AE', ceid: 'AE:en' });
    expect(url).toContain('q=a%20b%20%22c%22');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/unit/region.test.ts`
Expected: FAIL — the object overload does not yet exist (TypeScript compile error or runtime error).

- [ ] **Step 3: Implement the overload**

Replace the contents of `src/region.ts` with:

```typescript
export type RegionPreset = {
  q: string;
  hl: string;
  gl: string;
  ceid: string;
  flag: string;
  name: string;
};

export type RssLocale = {
  q: string;
  hl: string;
  gl: string;
  ceid: string;
};

export const REGION_PRESETS: Record<string, RegionPreset> = {
  uae: { q: 'UAE OR "Abu Dhabi" OR Dubai', hl: 'en', gl: 'AE', ceid: 'AE:en', flag: '🇦🇪', name: 'UAE' },
  us:  { q: 'USA OR "United States"', hl: 'en', gl: 'US', ceid: 'US:en', flag: '🇺🇸', name: 'US' },
  uk:  { q: 'UK OR "United Kingdom" OR London', hl: 'en', gl: 'GB', ceid: 'GB:en', flag: '🇬🇧', name: 'UK' },
  de:  { q: 'Deutschland OR Berlin OR München', hl: 'de', gl: 'DE', ceid: 'DE:de', flag: '🇩🇪', name: 'Germany' },
  ru:  { q: 'Россия OR Москва', hl: 'ru', gl: 'RU', ceid: 'RU:ru', flag: '🇷🇺', name: 'Russia' },
};

export function buildRssUrl(regionOrLocale: string | RssLocale): string {
  const locale = typeof regionOrLocale === 'string'
    ? resolveRegion(regionOrLocale)
    : regionOrLocale;
  const q = encodeURIComponent(locale.q);
  const hl = encodeURIComponent(locale.hl);
  const gl = encodeURIComponent(locale.gl);
  const ceid = encodeURIComponent(locale.ceid);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

function resolveRegion(region: string): RssLocale {
  const preset = REGION_PRESETS[region.toLowerCase()];
  if (!preset) {
    const available = Object.keys(REGION_PRESETS).join(', ');
    throw new Error(`Unknown region "${region}". Available: ${available}`);
  }
  return preset;
}
```

- [ ] **Step 4: Run all unit tests to verify pass and no regressions**

Run: `bun test test/unit/region.test.ts`
Expected: PASS, all existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/region.ts test/unit/region.test.ts
git commit -m "feat(region): add object overload to buildRssUrl

Allows arbitrary {q, hl, gl, ceid} input — needed for keyword topics
that supply their own query without a named region preset."
```

---

## Task 2: Topics config types and loader

**Files:**
- Create: `src/topics.ts`
- Test: `test/unit/topics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/topics.test.ts`:

```typescript
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTopicsConfig } from '../../src/topics';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'topics-test-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
}

describe('loadTopicsConfig', () => {
  test('loads a valid config with inherited locale', async () => {
    const path = writeConfig('ok.json', {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [
        { slug: 'economy', name: 'Экономика', query: 'UAE economy' },
        { slug: 'iran', name: 'Иран', emoji: '⚠️', query: 'Iran UAE', limit: 3 },
      ],
    });

    const cfg = await loadTopicsConfig(path);

    expect(cfg.locale).toEqual({ hl: 'en', gl: 'AE', ceid: 'AE:en' });
    expect(cfg.topics).toHaveLength(2);
    expect(cfg.topics[0]).toMatchObject({ slug: 'economy', name: 'Экономика', limit: 5 });
    expect(cfg.topics[1]).toMatchObject({ slug: 'iran', emoji: '⚠️', limit: 3 });
  });

  test('defaults locale to UAE when omitted', async () => {
    const path = writeConfig('no-locale.json', {
      topics: [{ slug: 'a', name: 'A', query: 'x' }],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.locale).toEqual({ hl: 'en', gl: 'AE', ceid: 'AE:en' });
  });

  test('per-topic locale overrides top-level', async () => {
    const path = writeConfig('per-topic-locale.json', {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [
        { slug: 'ru', name: 'RU', query: 'x', locale: { hl: 'ru', gl: 'RU', ceid: 'RU:ru' } },
      ],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]?.locale).toEqual({ hl: 'ru', gl: 'RU', ceid: 'RU:ru' });
  });

  test('rejects malformed JSON with file path in message', async () => {
    const path = writeConfig('broken.json', '{ not json');
    await expect(loadTopicsConfig(path)).rejects.toThrow(/broken\.json/);
  });

  test('rejects empty topics array', async () => {
    const path = writeConfig('empty.json', { topics: [] });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/at least one topic/i);
  });

  test('rejects topic missing slug', async () => {
    const path = writeConfig('no-slug.json', {
      topics: [{ name: 'X', query: 'q' }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/slug/);
  });

  test('rejects topic missing query', async () => {
    const path = writeConfig('no-query.json', {
      topics: [{ slug: 'a', name: 'A' }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/query/);
  });

  test('rejects duplicate slugs', async () => {
    const path = writeConfig('dup.json', {
      topics: [
        { slug: 'x', name: 'X', query: 'a' },
        { slug: 'x', name: 'Y', query: 'b' },
      ],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/duplicate.*slug.*x/i);
  });

  test('rejects non-positive limit', async () => {
    const path = writeConfig('bad-limit.json', {
      topics: [{ slug: 'a', name: 'A', query: 'q', limit: 0 }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/limit/);
  });

  test('rejects nonexistent file with helpful message', async () => {
    await expect(loadTopicsConfig('/nope/missing.json')).rejects.toThrow(/missing\.json/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test test/unit/topics.test.ts`
Expected: FAIL — `src/topics.ts` does not exist.

- [ ] **Step 3: Implement `src/topics.ts`**

Create `src/topics.ts`:

```typescript
import type { RssLocale } from './region';

const DEFAULT_LOCALE: RssLocale = { q: '', hl: 'en', gl: 'AE', ceid: 'AE:en' };
const DEFAULT_TOPIC_LIMIT = 5;

export type TopicConfig = {
  slug: string;
  name: string;
  emoji?: string;
  query: string;
  limit: number;
  locale: Omit<RssLocale, 'q'>;
};

export type TopicsConfig = {
  locale: Omit<RssLocale, 'q'>;
  topics: TopicConfig[];
};

export async function loadTopicsConfig(path: string): Promise<TopicsConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Topics config not found: ${path}`);
  }

  let raw: unknown;
  try {
    raw = await file.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse topics config at ${path}: ${msg}`);
  }

  return validate(raw, path);
}

function validate(raw: unknown, path: string): TopicsConfig {
  if (!isObject(raw)) {
    throw new Error(`Topics config at ${path} must be a JSON object`);
  }

  const localeRaw = raw.locale;
  const locale: Omit<RssLocale, 'q'> = localeRaw === undefined
    ? { hl: DEFAULT_LOCALE.hl, gl: DEFAULT_LOCALE.gl, ceid: DEFAULT_LOCALE.ceid }
    : parseLocale(localeRaw, `${path} → locale`);

  const topicsRaw = raw.topics;
  if (!Array.isArray(topicsRaw) || topicsRaw.length === 0) {
    throw new Error(`Topics config at ${path} must define at least one topic in the "topics" array`);
  }

  const topics: TopicConfig[] = [];
  const seenSlugs = new Set<string>();
  for (let i = 0; i < topicsRaw.length; i++) {
    const t = topicsRaw[i];
    const where = `${path} → topics[${i}]`;
    if (!isObject(t)) throw new Error(`${where} must be an object`);

    const slug = requireString(t.slug, `${where}.slug`);
    const name = requireString(t.name, `${where}.name`);
    const query = requireString(t.query, `${where}.query`);
    const emoji = t.emoji === undefined ? undefined : requireString(t.emoji, `${where}.emoji`);

    let limit = DEFAULT_TOPIC_LIMIT;
    if (t.limit !== undefined) {
      if (typeof t.limit !== 'number' || !Number.isInteger(t.limit) || t.limit <= 0) {
        throw new Error(`${where}.limit must be a positive integer (got ${JSON.stringify(t.limit)})`);
      }
      limit = t.limit;
    }

    const topicLocale = t.locale === undefined
      ? locale
      : parseLocale(t.locale, `${where}.locale`);

    if (seenSlugs.has(slug)) {
      throw new Error(`Topics config at ${path}: duplicate slug "${slug}"`);
    }
    seenSlugs.add(slug);

    topics.push({ slug, name, emoji, query, limit, locale: topicLocale });
  }

  return { locale, topics };
}

function parseLocale(raw: unknown, where: string): Omit<RssLocale, 'q'> {
  if (!isObject(raw)) throw new Error(`${where} must be an object with hl/gl/ceid`);
  return {
    hl: requireString(raw.hl, `${where}.hl`),
    gl: requireString(raw.gl, `${where}.gl`),
    ceid: requireString(raw.ceid, `${where}.ceid`),
  };
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${where} must be a non-empty string`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun test test/unit/topics.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/topics.ts test/unit/topics.test.ts
git commit -m "feat(topics): add JSON config loader with validation

Loads a topics config (locale + topics[]), enforces required fields,
duplicate-slug detection, positive-integer limits, and locale
inheritance. Surfaces the config path in every error."
```

---

## Task 3: Config path resolver

**Files:**
- Modify: `src/topics.ts`
- Modify: `test/unit/topics.test.ts`

The resolver looks in three places in order: explicit path, `./digest.config.json`, then XDG-style user config.

- [ ] **Step 1: Add the failing test**

Append to `test/unit/topics.test.ts`:

```typescript
import { resolveTopicsConfigPath } from '../../src/topics';

describe('resolveTopicsConfigPath', () => {
  test('returns explicit path when provided and file exists', async () => {
    const path = writeConfig('explicit.json', { topics: [{ slug: 'a', name: 'A', query: 'q' }] });
    const result = await resolveTopicsConfigPath({ explicit: path, cwd: dir, env: {} });
    expect(result).toBe(path);
  });

  test('throws when explicit path is missing', async () => {
    await expect(resolveTopicsConfigPath({ explicit: '/nope.json', cwd: dir, env: {} }))
      .rejects.toThrow(/nope\.json/);
  });

  test('finds digest.config.json in cwd', async () => {
    const path = writeConfig('digest.config.json', { topics: [{ slug: 'a', name: 'A', query: 'q' }] });
    const result = await resolveTopicsConfigPath({ cwd: dir, env: {} });
    expect(result).toBe(path);
  });

  test('falls back to XDG_CONFIG_HOME location', async () => {
    const xdg = mkdtempSync(join(tmpdir(), 'xdg-'));
    try {
      const subdir = join(xdg, 'uae-news-digest');
      require('node:fs').mkdirSync(subdir, { recursive: true });
      const path = join(subdir, 'topics.json');
      writeFileSync(path, JSON.stringify({ topics: [{ slug: 'a', name: 'A', query: 'q' }] }));
      const cwdNoConfig = mkdtempSync(join(tmpdir(), 'cwd-empty-'));
      try {
        const result = await resolveTopicsConfigPath({
          cwd: cwdNoConfig,
          env: { XDG_CONFIG_HOME: xdg },
        });
        expect(result).toBe(path);
      } finally {
        rmSync(cwdNoConfig, { recursive: true, force: true });
      }
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  test('returns null when no config found', async () => {
    const emptyCwd = mkdtempSync(join(tmpdir(), 'cwd-none-'));
    try {
      const result = await resolveTopicsConfigPath({
        cwd: emptyCwd,
        env: { HOME: emptyCwd },
      });
      expect(result).toBeNull();
    } finally {
      rmSync(emptyCwd, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test test/unit/topics.test.ts`
Expected: FAIL — `resolveTopicsConfigPath` is not exported.

- [ ] **Step 3: Implement the resolver**

Append to `src/topics.ts`:

```typescript
import { join } from 'node:path';

export type ResolveTopicsConfigOptions = {
  explicit?: string;
  cwd: string;
  env: Record<string, string | undefined>;
};

export async function resolveTopicsConfigPath(
  opts: ResolveTopicsConfigOptions,
): Promise<string | null> {
  if (opts.explicit) {
    if (!(await Bun.file(opts.explicit).exists())) {
      throw new Error(`Topics config not found: ${opts.explicit}`);
    }
    return opts.explicit;
  }

  const cwdCandidate = join(opts.cwd, 'digest.config.json');
  if (await Bun.file(cwdCandidate).exists()) return cwdCandidate;

  const xdg = opts.env.XDG_CONFIG_HOME
    ?? (opts.env.HOME ? join(opts.env.HOME, '.config') : null);
  if (xdg) {
    const xdgCandidate = join(xdg, 'uae-news-digest', 'topics.json');
    if (await Bun.file(xdgCandidate).exists()) return xdgCandidate;
  }

  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/unit/topics.test.ts`
Expected: PASS (all 15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/topics.ts test/unit/topics.test.ts
git commit -m "feat(topics): add config path resolver

Resolves topics config in priority order: explicit path,
./digest.config.json, then \$XDG_CONFIG_HOME/uae-news-digest/topics.json
(falling back to ~/.config). Returns null when nothing is found so
the CLI can branch into legacy mode."
```

---

## Task 4: `renderTopicalDigest`

**Files:**
- Modify: `src/render.ts`
- Test: `test/unit/render.test.ts`

Reuses the existing per-item line format (`emoji title (source, Nh ago)`) so it stays visually consistent with the legacy renderer; adds section headings between groups.

- [ ] **Step 1: Add the failing test**

Append to `test/unit/render.test.ts` (inside an existing describe or as a new `describe('renderTopicalDigest', ...)`). If unsure, add at the bottom of the file:

```typescript
import { renderTopicalDigest } from '../../src/render';
import type { DigestItem } from '../../src/digest';
import type { TopicConfig } from '../../src/topics';

function makeItem(over: Partial<DigestItem>): DigestItem {
  return {
    score: 1,
    publishedAt: new Date('2026-05-22T08:00:00Z'),
    title: 'Title',
    source: 'Reuters',
    key: 'k',
    ...over,
  };
}

function makeTopic(over: Partial<TopicConfig>): TopicConfig {
  return {
    slug: 'topic',
    name: 'Topic',
    emoji: '📌',
    query: 'q',
    limit: 5,
    locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
    ...over,
  };
}

describe('renderTopicalDigest', () => {
  const now = new Date('2026-05-22T10:00:00Z');

  test('renders sections in given order with emoji + name headings', () => {
    const out = renderTopicalDigest([
      {
        topic: makeTopic({ slug: 'economy', name: 'Экономика', emoji: '💰' }),
        items: [makeItem({ title: 'GDP up', source: 'Reuters', publishedAt: new Date('2026-05-22T09:00:00Z') })],
      },
      {
        topic: makeTopic({ slug: 'realty', name: 'Недвижимость', emoji: '🏠' }),
        items: [makeItem({ title: 'Emaar launches tower', source: 'Arabian Business', publishedAt: new Date('2026-05-22T08:00:00Z') })],
      },
    ], undefined, now);

    const economyIdx = out.indexOf('💰 Экономика');
    const realtyIdx = out.indexOf('🏠 Недвижимость');
    expect(economyIdx).toBeGreaterThan(-1);
    expect(realtyIdx).toBeGreaterThan(economyIdx);
    expect(out).toContain('GDP up (Reuters, 1h ago)');
    expect(out).toContain('Emaar launches tower (Arabian Business, 2h ago)');
  });

  test('falls back to bullet when emoji is missing', () => {
    const out = renderTopicalDigest([
      { topic: makeTopic({ name: 'Plain', emoji: undefined }), items: [makeItem({})] },
    ], undefined, now);
    expect(out).toContain('• Plain');
  });

  test('shows placeholder for empty sections', () => {
    const out = renderTopicalDigest([
      { topic: makeTopic({ name: 'Quiet', emoji: '🤫' }), items: [] },
    ], undefined, now);
    expect(out).toContain('🤫 Quiet');
    expect(out).toContain('(нет новых материалов)');
  });

  test('uses translations when provided', () => {
    const translations = new Map([['GDP up', 'ВВП вырос']]);
    const out = renderTopicalDigest([
      { topic: makeTopic({}), items: [makeItem({ title: 'GDP up' })] },
    ], translations, now);
    expect(out).toContain('ВВП вырос (Reuters');
    expect(out).not.toContain('GDP up (');
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test test/unit/render.test.ts`
Expected: FAIL — `renderTopicalDigest` not exported.

- [ ] **Step 3: Implement `renderTopicalDigest`**

Append to `src/render.ts`:

```typescript
import type { TopicConfig } from './topics';

export type RenderedSection = {
  topic: TopicConfig;
  items: DigestItem[];
};

export function renderTopicalDigest(
  sections: RenderedSection[],
  translations?: Map<string, string>,
  now: Date = new Date(),
): string {
  const dateLabel = now.toISOString().slice(0, 10);
  const lines: string[] = [`🇦🇪 UAE digest — ${dateLabel}`, ''];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const prefix = section.topic.emoji ?? '•';
    lines.push(`${prefix} ${section.topic.name}`);

    if (section.items.length === 0) {
      lines.push('  (нет новых материалов)');
    } else {
      for (const item of section.items) {
        const title = translations?.get(item.title) ?? item.title;
        const hoursAgo = Math.round((now.getTime() - item.publishedAt.getTime()) / 3_600_000);
        lines.push(`  ${emojiFor(item.title)} ${title} (${item.source}, ${hoursAgo}h ago)`);
      }
    }

    if (i < sections.length - 1) lines.push('');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/unit/render.test.ts`
Expected: PASS — all four new tests, plus existing render tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/unit/render.test.ts
git commit -m "feat(render): add renderTopicalDigest for sectioned output

Groups items under topic headings, supports translations, and prints
a placeholder so empty sections stay visible (quiet ≠ broken)."
```

---

## Task 5: `runTopicalDigest` pipeline (without translation)

**Files:**
- Modify: `src/pipeline.ts`
- Test: `test/integration/topical-digest.test.ts`

Pipeline takes an injected fetcher (mirrors how DeepL is tested today — no real network) and orchestrates per-topic `runDigest` with cross-topic dedup.

- [ ] **Step 1: Write the failing integration test**

Create `test/integration/topical-digest.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { runTopicalDigest } from '../../src/pipeline';
import type { TopicConfig, TopicsConfig } from '../../src/topics';

function topic(over: Partial<TopicConfig>): TopicConfig {
  return {
    slug: 'topic',
    name: 'Topic',
    query: 'q',
    limit: 5,
    locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
    ...over,
  };
}

function rssXml(items: { title: string; source: string; pubDate: string }[]): string {
  const body = items
    .map((i) =>
      `<item><title>${i.title}</title><pubDate>${i.pubDate}</pubDate>` +
      `<source url="https://example.com">${i.source}</source></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss><channel>${body}</channel></rss>`;
}

const NOW = new Date('2026-05-22T12:00:00Z');

describe('runTopicalDigest', () => {
  test('renders sections in config order, applies per-topic limits', async () => {
    const config: TopicsConfig = {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [
        topic({ slug: 'economy', name: 'Economy', emoji: '💰', limit: 2 }),
        topic({ slug: 'realty', name: 'Realty', emoji: '🏠', limit: 1 }),
      ],
    };

    const fetchByQuery = new Map<string, string>([
      [
        'economy',
        rssXml([
          { title: 'UAE inflation eases', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' },
          { title: 'Non-oil GDP rises', source: 'Bloomberg', pubDate: 'Fri, 22 May 2026 10:00:00 GMT' },
          { title: 'Third econ story', source: 'BBC', pubDate: 'Fri, 22 May 2026 09:00:00 GMT' },
        ]),
      ],
      [
        'realty',
        rssXml([
          { title: 'Emaar new tower in Dubai Marina', source: 'Arabian Business', pubDate: 'Fri, 22 May 2026 11:30:00 GMT' },
          { title: 'Aldar acquires Abu Dhabi plot', source: 'The National', pubDate: 'Fri, 22 May 2026 10:30:00 GMT' },
        ]),
      ],
    ]);

    const result = await runTopicalDigest({
      config,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async (t) => fetchByQuery.get(t.slug)!,
      now: NOW,
    });

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.topic.slug).toBe('economy');
    expect(result.sections[0]!.items.length).toBeLessThanOrEqual(2);
    expect(result.sections[1]!.topic.slug).toBe('realty');
    expect(result.sections[1]!.items.length).toBeLessThanOrEqual(1);
    expect(result.warnings).toEqual([]);
    expect(result.output).toContain('💰 Economy');
    expect(result.output).toContain('🏠 Realty');
  });

  test('global dedup: first topic in config wins', async () => {
    const config: TopicsConfig = {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [
        topic({ slug: 'economy', name: 'Economy', emoji: '💰', limit: 5 }),
        topic({ slug: 'iran', name: 'Iran', emoji: '⚠️', limit: 5 }),
      ],
    };
    const shared = rssXml([
      { title: 'US-Iran sanctions hit UAE oil exports', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' },
    ]);
    const result = await runTopicalDigest({
      config,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () => shared,
      now: NOW,
    });

    const economyTitles = result.sections[0]!.items.map((i) => i.title);
    const iranTitles = result.sections[1]!.items.map((i) => i.title);
    expect(economyTitles).toContain('US-Iran sanctions hit UAE oil exports');
    expect(iranTitles).not.toContain('US-Iran sanctions hit UAE oil exports');
  });

  test('respects persisted seenKeys (article skipped in all topics)', async () => {
    const config: TopicsConfig = {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [topic({ slug: 'a', name: 'A' })],
    };
    const xml = rssXml([
      { title: 'Old news', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' },
      { title: 'Fresh news', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:30:00 GMT' },
    ]);
    // Build the key the same way digest.ts does, via runDigest beforehand.
    const seed = await runTopicalDigest({
      config,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () => xml,
      now: NOW,
    });
    const seenKey = seed.sections[0]!.items.find((i) => i.title === 'Old news')?.key;
    expect(seenKey).toBeDefined();

    const result = await runTopicalDigest({
      config,
      seenKeys: new Set([seenKey!]),
      hours: 36,
      fetchTopicRss: async () => xml,
      now: NOW,
    });
    const titles = result.sections[0]!.items.map((i) => i.title);
    expect(titles).not.toContain('Old news');
    expect(titles).toContain('Fresh news');
  });

  test('one failing topic produces a warning, others still render', async () => {
    const config: TopicsConfig = {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [
        topic({ slug: 'good', name: 'Good', emoji: '✅' }),
        topic({ slug: 'bad', name: 'Bad', emoji: '❌' }),
      ],
    };
    const result = await runTopicalDigest({
      config,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async (t) => {
        if (t.slug === 'bad') throw new Error('boom');
        return rssXml([{ title: 'works', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' }]);
      },
      now: NOW,
    });
    expect(result.sections).toHaveLength(2);
    expect(result.sections[1]!.items).toEqual([]);
    expect(result.warnings.some((w) => w.includes('bad') && w.includes('boom'))).toBe(true);
  });

  test('empty topic produces a "zero items" warning', async () => {
    const config: TopicsConfig = {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [topic({ slug: 'silent', name: 'Silent' })],
    };
    const result = await runTopicalDigest({
      config,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () => rssXml([]),
      now: NOW,
    });
    expect(result.warnings.some((w) => w.includes('silent') && /0 items/i.test(w))).toBe(true);
  });

  test('advances nextSeenKeys with every selected item', async () => {
    const config: TopicsConfig = {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [topic({ slug: 'a', name: 'A' })],
    };
    const result = await runTopicalDigest({
      config,
      seenKeys: new Set(['preexisting']),
      hours: 36,
      fetchTopicRss: async () =>
        rssXml([{ title: 'Fresh', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' }]),
      now: NOW,
    });
    expect(result.nextSeenKeys.has('preexisting')).toBe(true);
    for (const item of result.sections[0]!.items) {
      expect(result.nextSeenKeys.has(item.key)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test test/integration/topical-digest.test.ts`
Expected: FAIL — `runTopicalDigest` not exported.

- [ ] **Step 3: Implement `runTopicalDigest`**

In `src/pipeline.ts`, **extend the existing import block** at the top (don't create duplicates — `parseRss`, `buildDigest`, and `renderDigest` are already imported there):

```typescript
import { renderTopicalDigest } from './render';
import type { RenderedSection } from './render';
import type { TopicConfig, TopicsConfig } from './topics';
```

Then **append below the existing `runDigest`** (do not touch it):

```typescript

export type TopicFetcher = (topic: TopicConfig) => Promise<string>;

export type RunTopicalDigestOptions = {
  config: TopicsConfig;
  seenKeys: Set<string>;
  hours: number;
  limitOverride?: number;
  fetchTopicRss: TopicFetcher;
  now?: Date;
};

export type RunTopicalDigestResult = {
  sections: RenderedSection[];
  output: string;
  nextSeenKeys: Set<string>;
  warnings: string[];
};

export async function runTopicalDigest(
  opts: RunTopicalDigestOptions,
): Promise<RunTopicalDigestResult> {
  const now = opts.now ?? new Date();
  const fetched = await Promise.allSettled(
    opts.config.topics.map((t) => opts.fetchTopicRss(t)),
  );

  const seen = new Set(opts.seenKeys);
  const sections: RenderedSection[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < opts.config.topics.length; i++) {
    const topic = opts.config.topics[i]!;
    const result = fetched[i]!;
    if (result.status === 'rejected') {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`Topic "${topic.slug}" failed: ${msg}`);
      sections.push({ topic, items: [] });
      continue;
    }

    const items = buildDigest(parseRss(result.value), {
      seenKeys: seen,
      hours: opts.hours,
      limit: opts.limitOverride ?? topic.limit,
      now,
    });

    if (items.length === 0) {
      warnings.push(`Topic "${topic.slug}" returned 0 items — check the query syntax`);
    }

    for (const it of items) seen.add(it.key);
    sections.push({ topic, items });
  }

  return {
    sections,
    output: renderTopicalDigest(sections, undefined, now),
    nextSeenKeys: seen,
    warnings,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/integration/topical-digest.test.ts`
Expected: PASS — all six tests; existing pipeline tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts test/integration/topical-digest.test.ts
git commit -m "feat(pipeline): add runTopicalDigest

Fetches every topic in parallel via an injected fetcher, applies
in-memory cross-topic dedup in config order, and surfaces per-topic
warnings (failed fetch, zero items) without aborting the run."
```

---

## Task 6: DeepL batch translation in `runTopicalDigest`

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `test/integration/topical-digest.test.ts`

One DeepL call covering every title across every topic — cheaper than N calls.

- [ ] **Step 1: Add failing test (uses the same DeepL test-server pattern as `pipeline.test.ts`)**

Append to `test/integration/topical-digest.test.ts`:

```typescript
import { beforeAll, afterAll, beforeEach } from 'bun:test';
import type { Server } from 'bun';

type DeepLHandler = (req: Request) => Response | Promise<Response>;
let deeplHandler: DeepLHandler = () => new Response('Not configured', { status: 500 });
let deeplServer: Server<undefined>;
const deeplRequests: { body: unknown }[] = [];

beforeAll(() => {
  deeplServer = Bun.serve({ port: 0, fetch: (req) => deeplHandler(req) });
  process.env.DEEPL_API_URL = `http://localhost:${deeplServer.port}/translate`;
});
afterAll(() => {
  deeplServer.stop(true);
  delete process.env.DEEPL_API_URL;
});
beforeEach(() => {
  deeplRequests.length = 0;
  deeplHandler = () => new Response('Not configured', { status: 500 });
});

describe('runTopicalDigest with DeepL', () => {
  test('translates all titles across topics in a single batch', async () => {
    deeplHandler = async (req) => {
      const body = await req.json();
      deeplRequests.push({ body });
      const translated = (body as { text: string[] }).text.map((t) => `[ru] ${t}`);
      return new Response(
        JSON.stringify({ translations: translated.map((text) => ({ detected_source_language: 'EN', text })) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const config: TopicsConfig = {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [
        topic({ slug: 'a', name: 'A', emoji: '🅰️' }),
        topic({ slug: 'b', name: 'B', emoji: '🅱️' }),
      ],
    };
    const result = await runTopicalDigest({
      config,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async (t) =>
        rssXml([{ title: `Story for ${t.slug}`, source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' }]),
      now: NOW,
      deeplAuthKey: 'fake',
      targetLang: 'RU',
    });

    expect(deeplRequests).toHaveLength(1);
    expect((deeplRequests[0]!.body as { text: string[] }).text.sort()).toEqual(
      ['Story for a', 'Story for b'],
    );
    expect(result.output).toContain('[ru] Story for a');
    expect(result.output).toContain('[ru] Story for b');
  });

  test('falls back gracefully when DeepL fails', async () => {
    deeplHandler = async () => new Response('boom', { status: 500 });
    const config: TopicsConfig = {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [topic({ slug: 'a', name: 'A' })],
    };
    const result = await runTopicalDigest({
      config,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () =>
        rssXml([{ title: 'Story', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' }]),
      now: NOW,
      deeplAuthKey: 'fake',
      targetLang: 'RU',
    });
    expect(result.output).toContain('Story (Reuters');
    expect(result.warnings.some((w) => /DeepL/.test(w) && /RU/.test(w))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test test/integration/topical-digest.test.ts`
Expected: FAIL — `runTopicalDigest` does not accept `deeplAuthKey`/`targetLang`.

- [ ] **Step 3: Wire translation into the pipeline**

Edit `src/pipeline.ts`. `translateDeepL` is already imported at the top — no new import needed. Add `deeplAuthKey` and `targetLang` to `RunTopicalDigestOptions`, then insert the translation pass inside `runTopicalDigest` between section assembly and the `return`.

Update the options type:

```typescript
export type RunTopicalDigestOptions = {
  config: TopicsConfig;
  seenKeys: Set<string>;
  hours: number;
  limitOverride?: number;
  fetchTopicRss: TopicFetcher;
  now?: Date;
  deeplAuthKey?: string;
  targetLang?: string;
};
```

Replace the final block of `runTopicalDigest` (the `return { ... }` at the bottom) with:

```typescript
  let translations: Map<string, string> | undefined;
  if (opts.targetLang && opts.deeplAuthKey) {
    const titles = sections.flatMap((s) => s.items.map((i) => i.title));
    if (titles.length > 0) {
      const translated = await translateDeepL(titles, opts.deeplAuthKey, opts.targetLang);
      if (translated) {
        translations = new Map();
        for (let i = 0; i < titles.length; i++) {
          translations.set(titles[i]!, translated[i]!);
        }
      } else {
        warnings.push(`DeepL translation to ${opts.targetLang} failed; using original titles.`);
      }
    }
  }

  return {
    sections,
    output: renderTopicalDigest(sections, translations, now),
    nextSeenKeys: seen,
    warnings,
  };
```

- [ ] **Step 4: Run tests**

Run: `bun test test/integration/topical-digest.test.ts`
Expected: PASS — both new DeepL tests + all previous tests.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline.ts test/integration/topical-digest.test.ts
git commit -m "feat(pipeline): batch DeepL translation across topics

Collects every title from every section into one DeepL request. On
failure, falls back to original titles and warns — same contract as
runDigest."
```

---

## Task 7: CLI wiring — auto-detect config, branch pipelines, new flags

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli.test.ts`

- [ ] **Step 1: Read the current CLI tests to learn the harness**

Run: `bun test test/cli.test.ts --rerun-each 0 -t 'help' || true`
Then open `test/cli.test.ts` and skim how it spawns the CLI (look for `Bun.spawn` or `Bun.$`). Reuse the same helpers in the new tests.

- [ ] **Step 2: Add failing CLI tests**

Append to `test/cli.test.ts` (use the harness already in the file — `runCli` / `spawnCli` / equivalent). The tests below assume a helper `runCli(args, { cwd, env })` returning `{ stdout, stderr, exitCode }`. If the file uses a different name, adapt:

```typescript
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('topics mode', () => {
  function writeTopicsCwd(): { cwd: string; cleanup: () => void } {
    const cwd = mkdtempSync(join(tmpdir(), 'cli-topics-'));
    writeFileSync(
      join(cwd, 'digest.config.json'),
      JSON.stringify({
        topics: [
          { slug: 'a', name: 'Alpha', emoji: '🅰️', query: 'alpha' },
          { slug: 'b', name: 'Beta',  emoji: '🅱️', query: 'beta' },
        ],
      }),
    );
    return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
  }

  test('auto-detects digest.config.json in cwd and switches to topics mode', async () => {
    const { cwd, cleanup } = writeTopicsCwd();
    try {
      // UAE_NEWS_DIGEST_TOPIC_FIXTURE is a test-only env hook (see Task 7
      // makeFetcher): when set, every topic fetch reads that file instead of
      // hitting the network. Avoids needing a Bun.serve stub for N parallel
      // fetches in the CLI integration test.
      const { stdout, stderr, exitCode } = await runCli(
        ['--json', '--hours', '99999', '--state-file', join(cwd, 'state.json')],
        {
          cwd,
          env: {
            ...process.env,
            UAE_NEWS_DIGEST_TOPIC_FIXTURE: join(import.meta.dir, 'fixtures', 'sample-feed.xml'),
            UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z',
          },
        },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.mode).toBe('topics');
      expect(parsed.topics).toEqual([
        expect.objectContaining({ slug: 'a', name: 'Alpha' }),
        expect.objectContaining({ slug: 'b', name: 'Beta' }),
      ]);
      for (const item of parsed.items) {
        expect(['a', 'b']).toContain(item.topic);
      }
    } finally {
      cleanup();
    }
  });

  test('--no-topics forces legacy mode even with config present', async () => {
    const { cwd, cleanup } = writeTopicsCwd();
    try {
      const { stdout, exitCode } = await runCli(
        [
          '--json', '--no-topics',
          '--rss-url', `file://${join(import.meta.dir, 'fixtures', 'sample-feed.xml')}`,
          '--hours', '99999',
          '--state-file', join(cwd, 'state.json'),
        ],
        { cwd, env: { ...process.env, UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z' } },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.mode).toBe('region');
      expect(parsed.topics).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test('warns when --region is explicitly passed alongside topics config', async () => {
    const { cwd, cleanup } = writeTopicsCwd();
    try {
      const { stderr } = await runCli(
        [
          '--region', 'us',
          '--json',
          '--state-file', join(cwd, 'state.json'),
        ],
        {
          cwd,
          env: {
            ...process.env,
            UAE_NEWS_DIGEST_TOPIC_FIXTURE: join(import.meta.dir, 'fixtures', 'sample-feed.xml'),
            UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z',
          },
        },
      );
      expect(stderr).toMatch(/--region.*ignored.*topics config/i);
    } finally {
      cleanup();
    }
  });
});
```

- [ ] **Step 3: Run to verify fail**

Run: `bun test test/cli.test.ts`
Expected: FAIL — `mode` field absent, no auto-detect, no `--no-topics` flag.

- [ ] **Step 4: Implement CLI changes**

Edit `src/index.ts`:

**4a.** Add imports near the top:

```typescript
import { readFile } from 'node:fs/promises';
import { loadTopicsConfig, resolveTopicsConfigPath } from './topics';
import { runTopicalDigest } from './pipeline';
import { buildRssUrl as _buildRssUrlForTopic } from './region';
import type { TopicConfig, TopicsConfig } from './topics';
```

(`_buildRssUrlForTopic` aliases `buildRssUrl` so its object-form usage in the topic fetcher reads clearly.)

**4b.** Add the two new flags inside the `program.option(...)` chain, after `--state-file`:

```typescript
  .option('--topics-config <path>', 'path to topics config JSON (overrides auto-detect)')
  .option('--no-topics', 'force legacy region mode even if a topics config is present')
```

(`--no-topics` becomes `options.topics === false` in Commander.)

**4c.** Replace the body of `program.action(async (options) => { ... })` so it branches. The full new body:

```typescript
program.action(async (options) => {
  try {
    const hours = validatePositiveNumber('hours', options.hours);
    const limit = validatePositiveNumber('limit', options.limit);
    const timeoutMs = validatePositiveNumber('timeout-ms', options.timeoutMs);
    const deeplAuthKey = process.env.DEEPL_AUTH_KEY;
    const now = resolveNow(process.env.UAE_NEWS_DIGEST_NOW);

    if (options.targetLang && !deeplAuthKey) {
      console.error(`--target-lang requires DEEPL_AUTH_KEY to be set.`);
      process.exit(1);
    }

    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
    const seenKeys = await readSeenKeys(options.stateFile);

    // Resolve topics config (skipped if --no-topics)
    let topicsConfig: TopicsConfig | null = null;
    let topicsConfigPath: string | null = null;
    if (options.topics !== false) {
      topicsConfigPath = await resolveTopicsConfigPath({
        explicit: options.topicsConfig,
        cwd: process.cwd(),
        env: process.env as Record<string, string | undefined>,
      });
      if (topicsConfigPath) {
        topicsConfig = await loadTopicsConfig(topicsConfigPath);
      }
    }

    if (topicsConfig) {
      await runInTopicsMode({
        config: topicsConfig,
        configPath: topicsConfigPath!,
        options,
        hours,
        limit,
        timeoutMs,
        deeplAuthKey,
        now,
        seenKeys,
      });
      return;
    }

    // Legacy region path (unchanged behaviour)
    const rssUrl = options.rssUrl ?? buildRssUrl(options.region);

    const response = await fetch(rssUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (uae-news-digest)' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`RSS fetch failed: HTTP ${response.status} ${response.statusText}. Check --rss-url or try again.`);
      process.exit(1);
    }

    const xml = await response.text();

    if (options.targetLang && deeplAuthKey) {
      console.error(`Translating to ${options.targetLang} via DeepL...`);
    }

    const result = await runDigest({
      xml,
      seenKeys,
      hours,
      limit,
      deeplAuthKey,
      targetLang: options.targetLang,
      region: options.region,
      now,
    });

    if (!options.json) {
      for (const warning of result.warnings) console.error(warning);
    }

    if (options.json) {
      process.stdout.write(JSON.stringify({
        tool: TOOL_ID,
        version: VERSION,
        mode: 'region',
        query: { hours, limit, targetLang: options.targetLang ?? null },
        count: result.digest.length,
        warnings: result.warnings,
        items: result.digest.map(d => ({
          title: d.title,
          source: d.source,
          score: d.score,
          publishedAt: d.publishedAt.toISOString(),
          hoursAgo: Math.round((now.getTime() - d.publishedAt.getTime()) / 3_600_000),
        })),
      }, null, 2) + '\n');
    } else {
      process.stdout.write(result.output + '\n');
    }

    if (options.dryRun) console.error('(dry run — state file not updated)');
    if (result.digest.length > 0 && !options.dryRun) {
      await writeSeenKeys(options.stateFile, result.nextSeenKeys);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timeout') || message.includes('TimeoutError') || message.includes('AbortError')) {
      console.error(`RSS feed did not respond within the timeout. Retry, or pass --timeout-ms 30000.`);
    } else if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('fetch failed') || message.includes('NetworkError')) {
      console.error(`Could not reach news.google.com. Check your connection.`);
    } else {
      console.error(message);
    }
    process.exit(1);
  }
});
```

**4d.** Add the `runInTopicsMode` helper above `program.action(...)`:

```typescript
type TopicsRunArgs = {
  config: TopicsConfig;
  configPath: string;
  options: any;  // Commander-supplied; intentionally loose
  hours: number;
  limit: number;
  timeoutMs: number;
  deeplAuthKey: string | undefined;
  now: Date;
  seenKeys: Set<string>;
};

async function runInTopicsMode(args: TopicsRunArgs): Promise<void> {
  const { config, configPath, options, hours, limit, timeoutMs, deeplAuthKey, now, seenKeys } = args;

  // Warn about flags the legacy path uses but topics mode ignores.
  // Use commander's option-source so we don't warn on defaults.
  const regionSource = (program as unknown as { getOptionValueSource?: (k: string) => string | undefined })
    .getOptionValueSource?.('region');
  if (regionSource === 'cli') {
    console.error(`--region "${options.region}" ignored: topics config in use (${configPath})`);
  }
  if (options.rssUrl) {
    console.error(`--rss-url ignored: topics config in use (${configPath})`);
  }

  const limitExplicitlySet =
    (program as unknown as { getOptionValueSource?: (k: string) => string | undefined })
      .getOptionValueSource?.('limit') === 'cli';
  const limitOverride = limitExplicitlySet ? limit : undefined;

  const fetchTopicRss = makeFetcher(timeoutMs);

  const result = await runTopicalDigest({
    config,
    seenKeys,
    hours,
    limitOverride,
    fetchTopicRss,
    now,
    deeplAuthKey,
    targetLang: options.targetLang,
  });

  if (!options.json) {
    for (const w of result.warnings) console.error(w);
  }

  if (options.json) {
    const items = result.sections.flatMap((s) =>
      s.items.map((d) => ({
        topic: s.topic.slug,
        title: d.title,
        source: d.source,
        score: d.score,
        publishedAt: d.publishedAt.toISOString(),
        hoursAgo: Math.round((now.getTime() - d.publishedAt.getTime()) / 3_600_000),
      })),
    );
    process.stdout.write(JSON.stringify({
      tool: TOOL_ID,
      version: VERSION,
      mode: 'topics',
      query: { hours, targetLang: options.targetLang ?? null },
      topics: result.sections.map((s) => ({
        slug: s.topic.slug,
        name: s.topic.name,
        count: s.items.length,
      })),
      count: items.length,
      warnings: result.warnings,
      items,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(result.output + '\n');
  }

  if (options.dryRun) console.error('(dry run — state file not updated)');
  const wroteAny = result.sections.some((s) => s.items.length > 0);
  if (wroteAny && !options.dryRun) {
    await writeSeenKeys(options.stateFile, result.nextSeenKeys);
  }
}

function makeFetcher(timeoutMs: number) {
  return async (topic: TopicConfig): Promise<string> => {
    // Test hook: when UAE_NEWS_DIGEST_TOPIC_FIXTURE is set, all topics read it.
    const fixture = process.env.UAE_NEWS_DIGEST_TOPIC_FIXTURE;
    if (fixture) return await readFile(fixture, 'utf-8');

    const url = _buildRssUrlForTopic({
      q: topic.query,
      hl: topic.locale.hl,
      gl: topic.locale.gl,
      ceid: topic.locale.ceid,
    });
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (uae-news-digest)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  };
}
```

- [ ] **Step 5: Run all tests and typecheck**

Run: `bun run typecheck && bun test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/cli.test.ts
git commit -m "feat(cli): wire topics mode into the CLI

Auto-detects digest.config.json (cwd, then XDG), adds --topics-config
and --no-topics flags, warns when --region/--rss-url are passed
alongside a topics config, and emits a mode field in JSON output."
```

---

## Task 8: Re-exports for `lib.ts` and `core.ts`

**Files:**
- Modify: `src/lib.ts`
- Modify: `src/core.ts`

- [ ] **Step 1: Read current `core.ts`**

Run: `cat src/core.ts`
Make sure new exports follow the same pattern.

- [ ] **Step 2: Add re-exports to `src/lib.ts`**

Append:

```typescript
export type { RssLocale } from './region';
export { loadTopicsConfig, resolveTopicsConfigPath } from './topics';
export type { TopicConfig, TopicsConfig, ResolveTopicsConfigOptions } from './topics';
export { runTopicalDigest } from './pipeline';
export type { TopicFetcher, RunTopicalDigestOptions, RunTopicalDigestResult } from './pipeline';
export { renderTopicalDigest } from './render';
export type { RenderedSection } from './render';
```

- [ ] **Step 3: Mirror in `src/core.ts`**

Add the same exports to `src/core.ts` so they're available from `@drakulavich/uae-news-digest/core`.

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib.ts src/core.ts
git commit -m "feat(api): re-export topics symbols from lib/core

Makes loadTopicsConfig, runTopicalDigest, and related types available
from both the internal lib barrel and the public ./core entry."
```

---

## Task 9: README documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Topics mode" section**

Open `README.md`, find the section that documents `--region`, and add immediately after it:

````markdown
## Topics mode

For per-topic digests (e.g. economy, real estate, regional politics) run alongside or in place of the default single-region feed, create a `digest.config.json` file:

```json
{
  "locale": { "hl": "en", "gl": "AE", "ceid": "AE:en" },
  "topics": [
    {
      "slug": "economy",
      "name": "Экономика ОАЭ",
      "emoji": "💰",
      "query": "(UAE OR Emirates) AND (economy OR GDP OR inflation OR ADNOC OR non-oil)",
      "limit": 5
    },
    {
      "slug": "realty",
      "name": "Недвижимость",
      "emoji": "🏠",
      "query": "(Dubai OR \"Abu Dhabi\") AND (\"real estate\" OR property OR Emaar OR Aldar)",
      "limit": 4
    },
    {
      "slug": "iran",
      "name": "Иран → ОАЭ",
      "emoji": "⚠️",
      "query": "(Iran OR Tehran OR \"Strait of Hormuz\") AND (UAE OR Dubai OR oil OR shipping)",
      "limit": 4
    }
  ]
}
```

The CLI looks for the config in this order:

1. `--topics-config <path>` (explicit override)
2. `./digest.config.json` (current working directory)
3. `$XDG_CONFIG_HOME/uae-news-digest/topics.json` (falls back to `~/.config/...`)

When a config is found, the CLI fetches each topic in parallel and renders one section per topic. Cross-topic dedup is "first topic in config wins" — reorder the array to set priority. To force the legacy region mode while a config is present, pass `--no-topics`.

The example `query` strings above are starting points, not optimal — iterate them against real Google News output.
````

- [ ] **Step 2: Mention new flags in the flags table**

Find the flags table and add rows for `--topics-config <path>` and `--no-topics`.

- [ ] **Step 3: Smoke test the build still works**

Run: `bun run build`
Expected: PASS — no build/type errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): document topics mode

Adds a Topics mode section with a starter config, file resolution
order, and the two new CLI flags."
```

---

## Task 10: Full verification sweep

**Files:** none

- [ ] **Step 1: Run the full suite**

Run: `bun test`
Expected: every test green.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 3: Build smoke**

Run: `bun run build`
Expected: clean.

- [ ] **Step 4: Hand-test the topics flow against a real config**

Create a throwaway `/tmp/digest.config.json` matching the README example, then:

```bash
( cd /tmp && uae-news-digest --json --hours 168 --state-file /tmp/state.json )
```

Expected: JSON output with `mode: "topics"`, `topics: [...]`, and items grouped by topic.

If you see one section returning `(нет новых материалов)` repeatedly, that's a query issue (Google News dropped your boolean) — refine the `query` string in the config and re-run.

- [ ] **Step 5: Push the branch and open a PR**

```bash
git push -u origin feat/keyword-topics
gh pr create --title "feat: keyword topics digest mode" --body "$(cat <<'EOF'
## Summary
- Adds a topic-driven digest mode triggered by a JSON config file
- Topics run in parallel, dedup is "first topic in config wins"
- One DeepL batch per run covers every translated title
- Legacy region mode is unchanged; new mode activates only when a config is found

## Test plan
- [ ] `bun test` passes locally
- [ ] `bun run typecheck` passes
- [ ] Hand-tested against a real topics config (economy / realty / iran)
- [ ] Verified `--no-topics` falls back to legacy region mode

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **Don't fold `runDigest` into `runTopicalDigest`.** The legacy path is the simpler one and keeps `--region` working without indirection.
- **Don't add a `TopicFetcher` registry.** The CLI builds one fetcher inline (Task 7); tests inject their own. Keep the surface small.
- **Avoid `Bun.spawn` inside `runInTopicsMode`** for the `getOptionValueSource` check. It's a sync read on the commander instance. The cast is intentional — commander's TS types don't expose it.
- **`UAE_NEWS_DIGEST_TOPIC_FIXTURE`** is a test-only escape hatch. Don't mention it in the README. It exists because writing a Bun-server stub for three parallel topic fetches in the CLI integration test would double the test code; the env var is the minimum viable injection point.
