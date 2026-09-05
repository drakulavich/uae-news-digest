import { describe, expect, test } from 'bun:test';
import { emojiFor, renderDigest, renderTopicalDigest } from '../../src/render';
import { IMPORTANCE_THRESHOLD } from '../../src/importance';
import { makeKey } from '../../src/normalize';
import type { DigestItem } from '../../src/digest';
import type { TopicConfig } from '../../src/topics';
import { DEFAULT_CONFIG } from '../../src/config/load';

describe('emojiFor', () => {
  test('weather/rain', () => {
    expect(emojiFor('Heavy rain expected')).toBe('🌧️');
    expect(emojiFor('Unstable weather conditions')).toBe('🌧️');
  });

  test('property/market', () => {
    expect(emojiFor('Property prices surge')).toBe('📉');
    expect(emojiFor('Dubai market overview')).toBe('📉');
  });

  test('aviation', () => {
    expect(emojiFor('Airport reopens after delays')).toBe('✈️');
    expect(emojiFor('Airspace closed for safety')).toBe('✈️');
  });

  test('military', () => {
    expect(emojiFor('Missile intercepted')).toBe('🛡️');
    expect(emojiFor('Drone attack reported')).toBe('🛡️');
  });

  test('shipping', () => {
    expect(emojiFor('Hormuz strait tensions')).toBe('⛴️');
  });

  test('terrorism', () => {
    expect(emojiFor('Hezbollah funding traced')).toBe('🚨');
  });

  test('education', () => {
    expect(emojiFor('Schools reopen after break')).toBe('🎓');
  });

  test('oil/energy', () => {
    expect(emojiFor('Oil prices drop sharply')).toBe('🛢️');
  });

  test('default bullet for unmatched', () => {
    expect(emojiFor('Something completely unrelated')).toBe('•');
  });

  test('Russian погода', () => {
    expect(emojiFor('нестабильная погода обрушивается')).toBe('🌧️');
  });
});

describe('renderDigest', () => {
  const now = new Date('2026-03-22T08:00:00Z');
  const sampleItem: DigestItem = {
    score: 5,
    importance: 0,
    signals: [],
    tier: 'neutral',
    publishedAt: new Date('2026-03-22T07:00:00Z'),
    title: 'Dubai property sector shows early signs of weakness',
    source: 'Reuters',
    key: makeKey('Dubai property sector shows early signs of weakness', 'Reuters'),
  };

  test('prints digest with hours ago suffix', () => {
    const output = renderDigest([sampleItem], undefined, now, 'uae', DEFAULT_CONFIG);
    expect(output).toContain('🇦🇪 UAE Latest News Digest');
    expect(output).toContain('📉');
    expect(output).toContain('Dubai property sector shows early signs of weakness');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('shows 0h ago for very recent items', () => {
    const recentItem: DigestItem = {
      ...sampleItem,
      publishedAt: new Date('2026-03-22T07:45:00Z'),
    };
    const output = renderDigest([recentItem], undefined, now, 'uae', DEFAULT_CONFIG);
    expect(output).toContain('Reuters, 0h ago');
  });

  test('uses DeepL translations when provided', () => {
    const translations = new Map([
      ['Dubai property sector shows early signs of weakness', 'Сектор недвижимости Дубая'],
    ]);
    const output = renderDigest([sampleItem], translations, now, 'uae', DEFAULT_CONFIG);
    expect(output).toContain('Сектор недвижимости Дубая');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('keeps original title when translations map has no entry', () => {
    const translations = new Map<string, string>();
    const output = renderDigest([sampleItem], translations, now, 'uae', DEFAULT_CONFIG);
    expect(output).toContain('Dubai property sector shows early signs of weakness');
  });

  test('prints empty message for no items', () => {
    const output = renderDigest([], undefined, now, 'uae', DEFAULT_CONFIG);
    expect(output).toContain('No significant news in the check window.');
  });

  test('uses UAE header for default region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'uae', DEFAULT_CONFIG);
    expect(output).toContain('🇦🇪 UAE');
  });

  test('uses US header for us region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'us', DEFAULT_CONFIG);
    expect(output).toContain('🇺🇸 US');
  });

  test('uses Germany header for de region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'de', DEFAULT_CONFIG);
    expect(output).toContain('🇩🇪 Germany');
  });

  test('uses generic header for unknown region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'xx', DEFAULT_CONFIG);
    expect(output).toContain('📰 News');
  });
});

function makeItem(over: Partial<DigestItem>): DigestItem {
  return {
    score: 1,
    importance: 0,
    signals: [],
    tier: 'neutral',
    publishedAt: new Date('2026-05-22T08:00:00Z'),
    title: 'Title',
    source: 'Reuters',
    key: 'k',
    ...over,
  };
}

function makeTopic(over: Partial<TopicConfig>): TopicConfig {
  return {
    slug: 'topic',
    name: 'Topic',
    emoji: '📌',
    query: 'q',
    limit: 5,
    locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
    ...over,
  };
}

describe('renderTopicalDigest', () => {
  const now = new Date('2026-05-22T10:00:00Z');

  test('renders sections in given order with emoji + name headings', () => {
    const out = renderTopicalDigest([
      {
        topic: makeTopic({ slug: 'economy', name: 'Экономика', emoji: '💰' }),
        items: [makeItem({ title: 'GDP up', source: 'Reuters', publishedAt: new Date('2026-05-22T09:00:00Z') })],
      },
      {
        topic: makeTopic({ slug: 'realty', name: 'Недвижимость', emoji: '🏠' }),
        items: [makeItem({ title: 'Emaar launches tower', source: 'Arabian Business', publishedAt: new Date('2026-05-22T08:00:00Z') })],
      },
    ], undefined, now, { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' }, DEFAULT_CONFIG);

    const economyIdx = out.indexOf('💰 Экономика');
    const realtyIdx = out.indexOf('🏠 Недвижимость');
    expect(economyIdx).toBeGreaterThan(-1);
    expect(realtyIdx).toBeGreaterThan(economyIdx);
    expect(out).toContain('GDP up (Reuters, 1h ago)');
    expect(out).toContain('Emaar launches tower (Arabian Business, 2h ago)');
  });

  test('falls back to bullet when emoji is missing', () => {
    const out = renderTopicalDigest([
      { topic: makeTopic({ name: 'Plain', emoji: undefined }), items: [makeItem({})] },
    ], undefined, now, { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' }, DEFAULT_CONFIG);
    expect(out).toContain('• Plain');
  });

  test('shows placeholder for empty sections', () => {
    const out = renderTopicalDigest([
      { topic: makeTopic({ name: 'Quiet', emoji: '🤫' }), items: [] },
    ], undefined, now, { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' }, DEFAULT_CONFIG);
    expect(out).toContain('🤫 Quiet');
    expect(out).toContain('(нет новых материалов)');
  });

  test('shows a promotion placeholder when every section item went to 🚨 Important', () => {
    const out = renderTopicalDigest([
      { topic: makeTopic({ name: 'Security', emoji: '🛡️' }),
        items: [makeItem({ title: 'Missile intercepted over Abu Dhabi airspace', importance: 8, signals: ['missile', 'airspace'], tier: 'breaking', key: 'imp1' })] },
    ], undefined, now, { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' }, DEFAULT_CONFIG);
    expect(out).toContain('🚨 Important');
    expect(out).toContain('(всё в 🚨 Important)');
    expect(out).not.toContain('(нет новых материалов)');
  });

  test('uses translations when provided', () => {
    const translations = new Map([['GDP up', 'ВВП вырос']]);
    const out = renderTopicalDigest([
      { topic: makeTopic({}), items: [makeItem({ title: 'GDP up' })] },
    ], translations, now, { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' }, DEFAULT_CONFIG);
    expect(out).toContain('ВВП вырос (Reuters');
    expect(out).not.toContain('GDP up (');
  });

  test('uses UAE local date in header', () => {
    // 21:30 UTC = 01:30 next-day UAE (UTC+4)
    const lateUtc = new Date('2026-05-22T21:30:00Z');
    const out = renderTopicalDigest(
      [{ topic: makeTopic({}), items: [] }],
      undefined,
      lateUtc,
      { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' },
      DEFAULT_CONFIG,
    );
    expect(out).toMatch(/^🇦🇪 UAE digest — 2026-05-23\n/);
  });

  test('renders flag, name, and timezone from passed locale context', () => {
    // 02:30 UTC on 2026-05-23 = 21:30 NY (UTC-4 in May) on 2026-05-22
    const out = renderTopicalDigest(
      [{ topic: makeTopic({}), items: [] }],
      undefined,
      new Date('2026-05-23T02:30:00Z'),
      { flag: '🇺🇸', name: 'US', timezone: 'America/New_York' },
      DEFAULT_CONFIG,
    );
    expect(out).toMatch(/^🇺🇸 US digest — 2026-05-22\n/);
  });
});

describe('renderDigest 🚨 Important block', () => {
  test('promotes important items into a top block and omits them from the list below', () => {
    const now = new Date('2026-03-22T10:00:00Z');
    const items = [
      { score: 7, importance: 8, signals: ['missile', 'airspace'], tier: 'breaking' as const,
        publishedAt: new Date('2026-03-22T08:00:00Z'), title: 'UAE intercepts missile over Dubai airspace', source: 'Reuters', key: 'k1' },
      { score: 5, importance: 0, signals: [], tier: 'neutral' as const,
        publishedAt: new Date('2026-03-22T09:00:00Z'), title: 'Local council holds routine meeting', source: 'Gulf News', key: 'k2' },
    ];
    const out = renderDigest(items, undefined, now, 'uae', DEFAULT_CONFIG);
    expect(out).toContain('🚨 Important');
    const importantIdx = out.indexOf('🚨 Important');
    const missileIdx = out.indexOf('UAE intercepts missile');
    expect(missileIdx).toBeGreaterThan(importantIdx);
    expect(out.split('UAE intercepts missile').length - 1).toBe(1); // appears exactly once
    expect(out).toContain('[missile, airspace]');
  });

  test('no 🚨 block when nothing clears the threshold', () => {
    const now = new Date('2026-03-22T10:00:00Z');
    const items = [
      { score: 2, importance: IMPORTANCE_THRESHOLD - 1, signals: [], tier: 'neutral' as const,
        publishedAt: new Date('2026-03-22T09:00:00Z'), title: 'Routine update', source: 'Gulf News', key: 'k3' },
    ];
    const out = renderDigest(items, undefined, now, 'uae', DEFAULT_CONFIG);
    expect(out).not.toContain('🚨 Important');
  });

  test('signal markers never leak into the regular body (fluff item below threshold)', () => {
    const now = new Date('2026-03-22T10:00:00Z');
    const items = [
      // fluff item: has signals but stays below threshold, so it remains in the body
      { score: 5, importance: -3, signals: ['launches', "world's first"], tier: 'fluff' as const,
        publishedAt: new Date('2026-03-22T09:00:00Z'), title: 'Dubai hotel launches AI concierge', source: 'Reuters', key: 'f1' },
    ];
    const out = renderDigest(items, undefined, now, 'uae', DEFAULT_CONFIG);
    expect(out).not.toContain('🚨 Important');
    expect(out).toContain('Dubai hotel launches AI concierge');
    expect(out).not.toContain('[launches'); // marker must NOT appear in the body
  });
});
