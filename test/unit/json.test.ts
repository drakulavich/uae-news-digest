import { describe, expect, test } from 'bun:test';
import { hoursAgo, toJson } from '../../src/json';
import { parseConfig } from '../../src/config/schema';
import type { DigestItem } from '../../src/pipeline/select';
import type { DigestResult } from '../../src/pipeline/run';

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
