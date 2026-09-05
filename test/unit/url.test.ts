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
