import { describe, expect, test } from 'bun:test';
import { buildDigest } from '../../src/digest';
import { makeKey } from '../../src/normalize';
import type { RssItem } from '../../src/rss';

describe('buildDigest', () => {
  test('filters seen, old, and low-signal items deterministically', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai property sector shows early signs of weakness', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'Dubai property sector shows early signs of weakness', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'UAE football roundup', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'MSN' },
      { title: 'Abu Dhabi airport reopens airspace', pubDate: 'Fri, 20 Mar 2026 01:00:00 GMT', source: 'The National' },
      { title: 'Dubai flight status updates after rain', pubDate: 'Sun, 22 Mar 2026 06:45:00 GMT', source: 'Khaleej Times' },
    ];

    const digest = buildDigest(items, {
      seenKeys: new Set([makeKey('Dubai flight status updates after rain', 'Khaleej Times')]),
      hours: 36,
      limit: 6,
      now,
    });

    expect(digest).toHaveLength(1);
    expect(digest[0]?.title).toContain('Dubai property sector');
    expect(digest[0]?.source).toBe('Reuters');
  });

  test('fuzzy dedup coalesces similar titles from different sources', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'UAE says it intercepted 5 Iranian missiles, 17 drones', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'UAE air defences engage 5 ballistic missiles, 17 UAVs on March 24', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'Gulf News' },
    ];

    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });
    expect(digest).toHaveLength(1);
  });

  test('returns empty for all-skipped items', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'UAE football roundup', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'MSN' },
    ];
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });
    expect(digest).toHaveLength(0);
  });

  test('drops items with missing or malformed publication dates', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai airport reopens after rain', source: 'Reuters' },
      { title: 'Abu Dhabi market overview', pubDate: 'not a date', source: 'Gulf News' },
      { title: 'UAE oil prices rise', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
    ];

    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });
    expect(digest).toHaveLength(1);
    expect(digest[0]?.title).toBe('UAE oil prices rise');
  });

  test('preserves URL metadata on selected digest items', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      {
        title: 'Dubai airport reopens after rain',
        pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT',
        source: 'Reuters',
        googleUrl: 'https://news.google.com/rss/articles/dubai-airport',
        originalUrl: null,
      },
    ];

    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });

    expect(digest).toHaveLength(1);
    expect(digest[0]?.googleUrl).toBe('https://news.google.com/rss/articles/dubai-airport');
    expect(digest[0]?.originalUrl).toBeNull();
  });

  test('respects limit', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const topics = ['airport closure', 'property market crash', 'oil price surge', 'visa regulation change', 'metro expansion plan', 'weather sandstorm warning', 'hospital opening ceremony', 'shipping trade agreement', 'drone technology expo', 'education reform policy'];
    const items: RssItem[] = topics.map((topic, i) => ({
      title: `Dubai ${topic}`,
      pubDate: `Sun, 22 Mar 2026 0${Math.min(7, i)}:00:00 GMT`,
      source: 'Reuters',
    }));
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 3, now });
    expect(digest).toHaveLength(3);
  });
});
