import { describe, expect, test } from 'bun:test';
import { buildDigest, buildDigestWithStats, matchTerms } from '../../src/digest';
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

  test('attaches importance, signals, and tier to each item', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'UAE intercepts missile over Dubai airspace', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
    ];
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });
    expect(digest).toHaveLength(1);
    expect(digest[0]!.tier).toBe('breaking');
    expect(digest[0]!.importance).toBeGreaterThan(0);
    expect(digest[0]!.signals).toContain('missile');
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

describe('matchTerms', () => {
  test('mode "all" requires every term', () => {
    expect(matchTerms('Dubai school fees rise', ['school', 'fees'], 'all').ok).toBe(true);
    expect(matchTerms('Dubai school news', ['school', 'fees'], 'all').ok).toBe(false);
  });
  test('mode "any" requires one term and reports which matched', () => {
    const r = matchTerms('Dubai school news', ['school', 'fees'], 'any');
    expect(r.ok).toBe(true);
    expect(r.matchedTerms).toEqual(['school']);
  });
  test('numeric mode requires N terms', () => {
    expect(matchTerms('a b c', ['a', 'b', 'c'], 2).ok).toBe(true);
    expect(matchTerms('a only', ['a', 'b', 'c'], 2).ok).toBe(false);
  });
});

describe('buildDigestWithStats match filter', () => {
  test('drops off-keyword items and counts them; annotates matchedTerms', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai school fees increase for 2026', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Gulf News' },
      { title: 'Dubai weather stays warm this week', pubDate: 'Sun, 22 Mar 2026 07:10:00 GMT', source: 'Khaleej Times' },
    ];
    const { items: digest, droppedByMatch } = buildDigestWithStats(items, {
      seenKeys: new Set(), hours: 36, limit: 6, now, match: ['school', 'fees'], matchMode: 'all',
    });
    expect(digest).toHaveLength(1);
    expect(digest[0]!.matchedTerms).toEqual(['school', 'fees']);
    expect(droppedByMatch).toBe(1);
  });

  test('no match option = unchanged behavior, droppedByMatch 0', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai property sector update', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
    ];
    const { items: digest, droppedByMatch } = buildDigestWithStats(items, {
      seenKeys: new Set(), hours: 36, limit: 6, now,
    });
    expect(digest).toHaveLength(1);
    expect(droppedByMatch).toBe(0);
  });
});
