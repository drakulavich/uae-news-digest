import { describe, expect, test } from 'bun:test';
import { buildDigest, buildDigestWithStats, matchTerms } from '../../src/digest';
import { makeKey } from '../../src/normalize';
import type { RssItem } from '../../src/rss';
import { DEFAULT_CONFIG } from '../../src/config/load';
import { parseConfig } from '../../src/config/schema';

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
      heuristics: DEFAULT_CONFIG,
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

    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now, heuristics: DEFAULT_CONFIG });
    expect(digest).toHaveLength(1);
  });

  test('wordless (non-Latin) titles: identical ones dedupe across sources, different ones both survive', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'الإمارات تطلق قمراً', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'الإمارات تطلق قمراً', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'Gulf News' },
      { title: 'ارتفاع أسعار النفط', pubDate: 'Sun, 22 Mar 2026 07:45:00 GMT', source: 'Reuters' },
    ];

    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now, heuristics: DEFAULT_CONFIG });
    expect(digest.map((d) => d.title).sort()).toEqual(['ارتفاع أسعار النفط', 'الإمارات تطلق قمراً'].sort());
  });

  test('returns empty for all-skipped items', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'UAE football roundup', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'MSN' },
    ];
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now, heuristics: DEFAULT_CONFIG });
    expect(digest).toHaveLength(0);
  });

  test('drops items with missing or malformed publication dates', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai airport reopens after rain', source: 'Reuters' },
      { title: 'Abu Dhabi market overview', pubDate: 'not a date', source: 'Gulf News' },
      { title: 'UAE oil prices rise', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
    ];

    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now, heuristics: DEFAULT_CONFIG });
    expect(digest).toHaveLength(1);
    expect(digest[0]?.title).toBe('UAE oil prices rise');
  });

  test('attaches importance, signals, and tier to each item', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'UAE intercepts missile over Dubai airspace', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
    ];
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now, heuristics: DEFAULT_CONFIG });
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
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 3, now, heuristics: DEFAULT_CONFIG });
    expect(digest).toHaveLength(3);
  });

  test('carries the RSS link as url and always sets matchedTerms', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai airport reopens after rain', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters', link: 'https://news.google.com/rss/articles/x' },
    ];
    const [item] = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now, heuristics: DEFAULT_CONFIG });
    expect(item!.url).toBe('https://news.google.com/rss/articles/x');
    expect(item!.matchedTerms).toEqual([]);
    expect(item!.translatedTitle).toBeUndefined();
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
  test('matches whole word + plural but not a longer different word', () => {
    expect(matchTerms('Dubai schools reopen', ['school'], 'any').ok).toBe(true);
    expect(matchTerms('Dubai schooling system overhaul', ['school'], 'any').ok).toBe(false);
  });
  test('matching is case-insensitive', () => {
    expect(matchTerms('Dubai SCHOOL fees rise', ['School'], 'any').ok).toBe(true);
  });
  test('empty match array means no filtering at matchTerms level', () => {
    // buildDigestWithStats guards empty arrays; matchTerms with [] requires 0 terms
    expect(matchTerms('anything', [], 'all').ok).toBe(true);
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
      seenKeys: new Set(), hours: 36, limit: 6, now, match: ['school', 'fees'], matchMode: 'all', heuristics: DEFAULT_CONFIG,
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
      seenKeys: new Set(), hours: 36, limit: 6, now, heuristics: DEFAULT_CONFIG,
    });
    expect(digest).toHaveLength(1);
    expect(droppedByMatch).toBe(0);
  });
});

describe('buildDigest heuristics come from the config', () => {
  const now = new Date('2026-03-22T08:00:00Z');
  const base = { seenKeys: new Set<string>(), hours: 36, limit: 6, now };
  const items: RssItem[] = [
    { title: 'UAE football roundup', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'MSN' },
    { title: 'Dubai flight status updates after rain', pubDate: 'Sun, 22 Mar 2026 06:45:00 GMT', source: 'Khaleej Times' },
  ];

  test('skip list drops matching titles and sources', () => {
    const cfg = parseConfig({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A', query: 'q' }], skip: ['football'] }, 'test');
    const digest = buildDigest(items, { ...base, heuristics: cfg });
    expect(digest.map((d) => d.title)).toEqual(['Dubai flight status updates after rain']);

    // Source arm: a clean title from a skipped source must be dropped too.
    const sourceItems: RssItem[] = [
      { title: 'Abu Dhabi weekend guide', pubDate: 'Sun, 22 Mar 2026 07:20:00 GMT', source: 'MSN' },
    ];
    const skipSourceCfg = parseConfig({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A', query: 'q' }], skip: ['msn'] }, 'test');
    expect(buildDigest(sourceItems, { ...base, heuristics: skipSourceCfg })).toHaveLength(0);

    const noSkipCfg = parseConfig({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A', query: 'q' }] }, 'test');
    expect(buildDigest(sourceItems, { ...base, heuristics: noSkipCfg })).toHaveLength(1);
  });

  test('no skip list keeps everything, and neutral heuristics score 0', () => {
    const cfg = parseConfig({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A', query: 'q' }] }, 'test');
    const digest = buildDigest(items, { ...base, heuristics: cfg });
    expect(digest).toHaveLength(2);
    expect(digest.every((d) => d.score === 0 && d.importance === 0 && d.tier === 'neutral')).toBe(true);
  });

  test('similarity threshold from config controls fuzzy dedupe', () => {
    const pair: RssItem[] = [
      { title: 'UAE says it intercepted 5 Iranian missiles, 17 drones', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'UAE air defences engage 5 ballistic missiles, 17 UAVs on March 24', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'Gulf News' },
    ];
    const strict = parseConfig({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A', query: 'q' }], dedupe: { ...DEFAULT_CONFIG.dedupe, similarityThreshold: 0.99 } }, 'test');
    expect(buildDigest(pair, { ...base, heuristics: DEFAULT_CONFIG })).toHaveLength(1);
    expect(buildDigest(pair, { ...base, heuristics: strict })).toHaveLength(2);
  });
});
