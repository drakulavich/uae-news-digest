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

  test('handles malformed XML gracefully', () => {
    expect(() => parseRss('not xml at all')).not.toThrow();
    const items = parseRss('not xml at all');
    expect(items).toEqual([]);
  });

  test('handles XML with no rss root', () => {
    const xml = `<?xml version="1.0"?><feed><entry><title>Atom</title></entry></feed>`;
    expect(parseRss(xml)).toEqual([]);
  });
});
