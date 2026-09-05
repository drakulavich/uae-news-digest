import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { Server } from 'bun';
import { runTopicalDigest } from '../../src/pipeline';
import { parseConfig } from '../../src/config/schema';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { DigestConfig } from '../../src/config/schema';

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

const LOCALE = { hl: 'en', gl: 'AE', ceid: 'AE:en' };

/** Build a validated config from partial topics; heuristics default to the built-in UAE set so existing assertions hold. */
function config(topics: Record<string, unknown>[], extra: Record<string, unknown> = {}): DigestConfig {
  const { locale: _l, display: _d, topics: _t, ...heuristics } = DEFAULT_CONFIG;
  return parseConfig({ locale: LOCALE, topics, ...heuristics, ...extra }, 'test');
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
    const cfg = config([
      { slug: 'economy', name: 'Economy', emoji: '💰', limit: 2, query: 'q' },
      { slug: 'realty', name: 'Realty', emoji: '🏠', limit: 1, query: 'q' },
    ]);

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
      config: cfg,
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
    const cfg = config([
      { slug: 'economy', name: 'Economy', emoji: '💰', limit: 5, query: 'q' },
      { slug: 'iran', name: 'Iran', emoji: '⚠️', limit: 5, query: 'q' },
    ]);
    const shared = rssXml([
      { title: 'US-Iran sanctions hit UAE oil exports', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' },
    ]);
    const result = await runTopicalDigest({
      config: cfg,
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
    const cfg = config([{ slug: 'a', name: 'A', query: 'q' }]);
    const xml = rssXml([
      { title: 'Old news', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:00:00 GMT' },
      { title: 'Fresh news', source: 'Reuters', pubDate: 'Fri, 22 May 2026 11:30:00 GMT' },
    ]);
    // Build the key the same way digest.ts does, via runDigest beforehand.
    const seed = await runTopicalDigest({
      config: cfg,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () => xml,
      now: NOW,
    });
    const seenKey = seed.sections[0]!.items.find((i) => i.title === 'Old news')?.key;
    expect(seenKey).toBeDefined();

    const result = await runTopicalDigest({
      config: cfg,
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
    const cfg = config([
      { slug: 'good', name: 'Good', emoji: '✅', query: 'q' },
      { slug: 'bad', name: 'Bad', emoji: '❌', query: 'q' },
    ]);
    const result = await runTopicalDigest({
      config: cfg,
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
    const cfg = config([{ slug: 'silent', name: 'Silent', query: 'q' }]);
    const result = await runTopicalDigest({
      config: cfg,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () => rssXml([]),
      now: NOW,
    });
    expect(result.warnings.some((w) => w.includes('silent') && /0 items/i.test(w))).toBe(true);
  });

  test('advances nextSeenKeys with every selected item', async () => {
    const cfg = config([{ slug: 'a', name: 'A', query: 'q' }]);
    const result = await runTopicalDigest({
      config: cfg,
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

  test('emits a dropped-items warning when a topic match filter rejects items', async () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Dubai school fees rise for 2026</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source>Gulf News</source></item>
      <item><title>Dubai weather stays warm</title><pubDate>Sun, 22 Mar 2026 07:05:00 GMT</pubDate><source>Khaleej Times</source></item>
    </channel></rss>`;

    const result = await runTopicalDigest({
      config: config([
        { slug: 'schools', name: 'Schools', query: 'school fees', limit: 5, match: ['school', 'fees'], matchMode: 'all' },
      ]),
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () => xml,
      now,
    });

    expect(result.sections[0]!.items).toHaveLength(1);
    expect(result.warnings.some((w) => /dropped/.test(w))).toBe(true);
  });

  test('a config without heuristic sections produces neutral items', async () => {
    const result = await runTopicalDigest({
      config: parseConfig({ locale: LOCALE, topics: [{ slug: 'a', name: 'A', query: 'q' }] }, 'test'),
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async () => rssXml([{ title: 'Missile intercepted over Abu Dhabi airspace', source: 'Reuters', pubDate: NOW.toUTCString() }]),
      now: NOW,
    });
    expect(result.sections[0]!.items[0]).toMatchObject({ score: 0, importance: 0, tier: 'neutral', signals: [] });
    expect(result.output).not.toContain('🚨 Important');
    expect(result.output).toContain('• Missile intercepted');
  });
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

    const cfg = config([
      { slug: 'a', name: 'A', emoji: '🅰️', query: 'q' },
      { slug: 'b', name: 'B', emoji: '🅱️', query: 'q' },
    ]);
    const result = await runTopicalDigest({
      config: cfg,
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
    const cfg = config([{ slug: 'a', name: 'A', query: 'q' }]);
    const result = await runTopicalDigest({
      config: cfg,
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

  test('gathers important items across topics into one top block', async () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const realEstateXml = `<?xml version="1.0"?><rss><channel>
      <item><title>Missile intercepted over Abu Dhabi airspace</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source>Reuters</source></item>
    </channel></rss>`;
    const calmXml = `<?xml version="1.0"?><rss><channel>
      <item><title>Routine community newsletter published</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source>Gulf News</source></item>
    </channel></rss>`;

    const result = await runTopicalDigest({
      config: config([
        { slug: 'realestate', name: 'Real Estate', query: 'property', limit: 5 },
        { slug: 'community', name: 'Community', query: 'community', limit: 5 },
      ]),
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async (t) => (t.slug === 'realestate' ? realEstateXml : calmXml),
      now,
    });

    const importantIdx = result.output.indexOf('🚨 Important');
    const realEstateIdx = result.output.indexOf('Real Estate');
    expect(importantIdx).toBeGreaterThanOrEqual(0);
    expect(realEstateIdx).toBeGreaterThan(importantIdx); // block precedes topic sections
    expect(result.output).toContain('Missile intercepted');
    expect(result.output.split('Missile intercepted').length - 1).toBe(1); // not duplicated below
    // the promoted line is tagged with its originating topic
    expect(result.output).toMatch(/Missile intercepted[^\n]*— Real Estate/);
  });

  test('de-duplicates identical titles before calling DeepL', async () => {
    deeplHandler = async (req) => {
      const body = await req.json();
      deeplRequests.push({ body });
      const translated = (body as { text: string[] }).text.map((t) => `[ru] ${t}`);
      return new Response(
        JSON.stringify({ translations: translated.map((text) => ({ detected_source_language: 'EN', text })) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const cfg = config([
      { slug: 'a', name: 'A', query: 'q' },
      { slug: 'b', name: 'B', query: 'q' },
    ]);
    // Same headline from two different sources → both items survive cross-topic
    // dedup (different keys), but the title appears twice in the title list.
    const result = await runTopicalDigest({
      config: cfg,
      seenKeys: new Set(),
      hours: 36,
      fetchTopicRss: async (t) =>
        rssXml([{
          title: 'Shared headline',
          source: t.slug === 'a' ? 'Reuters' : 'Bloomberg',
          pubDate: 'Fri, 22 May 2026 11:00:00 GMT',
        }]),
      now: NOW,
      deeplAuthKey: 'fake',
      targetLang: 'RU',
    });

    expect(deeplRequests).toHaveLength(1);
    expect((deeplRequests[0]!.body as { text: string[] }).text).toEqual(['Shared headline']);
    expect(result.output).toContain('[ru] Shared headline (Reuters');
    expect(result.output).toContain('[ru] Shared headline (Bloomberg');
  });
});
