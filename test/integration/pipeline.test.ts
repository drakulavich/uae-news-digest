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

  test("carries the caller's pre-existing keys forward into nextSeenKeys", async () => {
    const cfg = config([{ slug: 'a', name: 'A' }]);
    const result = await runDigest({
      config: cfg, seenKeys: new Set(['preexisting']), hours: 36, now: NOW,
      fetchText: feeds({ a: rss([{ title: 'GDP up' }, { title: 'Rents climb' }]) }),
    });
    expect(result.sections[0]!.items).toHaveLength(2);
    expect(result.nextSeenKeys.has('preexisting')).toBe(true);
    // the carried-over key plus one per selected item
    expect(result.nextSeenKeys.size).toBe(1 + result.sections[0]!.items.length);
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

  test('an HTTP 200 body that is not RSS is a failed topic, not an empty feed', async () => {
    const cfg = config([{ slug: 'html', name: 'HTML' }]);
    const html = '<!doctype html><html><body>Service unavailable</body></html>';
    const result = await runDigest({ config: cfg, seenKeys: new Set(), hours: 36, now: NOW, fetchText: feeds({ html }) });
    expect(result.fetchedTopics).toBe(0);
    expect(result.sections[0]!.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toStartWith('Topic "html" failed: could not parse RSS');
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
