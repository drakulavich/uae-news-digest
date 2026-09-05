import { describe, expect, test } from 'bun:test';
import { parseRss } from '../../src/rss';

describe('parseRss', () => {
  test('extracts items and source text', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Dubai market rises</title><pubDate>Sun, 22 Mar 2026 04:00:00 GMT</pubDate><source url="https://example.com">Reuters</source></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      title: 'Dubai market rises',
      pubDate: 'Sun, 22 Mar 2026 04:00:00 GMT',
      source: 'Reuters',
    });
  });

  test('preserves the RSS item link when present', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Dubai market rises</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Sun, 22 Mar 2026 04:00:00 GMT</pubDate></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items[0]?.link).toBe('https://news.google.com/rss/articles/abc');
  });

  test('leaves link undefined when the RSS item has no link', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>No link here</title></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items[0]?.link).toBeUndefined();
  });

  test('returns empty array for empty channel', () => {
    const xml = `<?xml version="1.0"?><rss><channel></channel></rss>`;
    expect(parseRss(xml)).toEqual([]);
  });

  test('handles single item (not wrapped in array)', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Only one</title></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Only one');
  });

  test('throws on input that is not XML', () => {
    expect(() => parseRss('not xml at all')).toThrow('not an RSS document');
    expect(() => parseRss('not xml at all <<<')).toThrow();
  });

  test('throws on XML without an <rss><channel> root (Atom, HTML error page)', () => {
    const atom = `<?xml version="1.0"?><feed><entry><title>Atom</title></entry></feed>`;
    expect(() => parseRss(atom)).toThrow('not an RSS document');
    const html = '<!doctype html><html><body>Service unavailable</body></html>';
    expect(() => parseRss(html)).toThrow('not an RSS document');
  });
});
