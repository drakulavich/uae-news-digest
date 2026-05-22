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
