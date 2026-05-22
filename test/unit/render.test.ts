import { describe, expect, test } from 'bun:test';
import { emojiFor, renderDigest, renderTopicalDigest } from '../../src/render';
import { makeKey } from '../../src/normalize';
import type { DigestItem } from '../../src/digest';
import type { TopicConfig } from '../../src/topics';

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
    publishedAt: new Date('2026-03-22T07:00:00Z'),
    title: 'Dubai property sector shows early signs of weakness',
    source: 'Reuters',
    key: makeKey('Dubai property sector shows early signs of weakness', 'Reuters'),
  };

  test('prints digest with hours ago suffix', () => {
    const output = renderDigest([sampleItem], undefined, now);
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
    const output = renderDigest([recentItem], undefined, now);
    expect(output).toContain('Reuters, 0h ago');
  });

  test('uses DeepL translations when provided', () => {
    const translations = new Map([
      ['Dubai property sector shows early signs of weakness', 'Сектор недвижимости Дубая'],
    ]);
    const output = renderDigest([sampleItem], translations, now);
    expect(output).toContain('Сектор недвижимости Дубая');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('keeps original title when translations map has no entry', () => {
    const translations = new Map<string, string>();
    const output = renderDigest([sampleItem], translations, now);
    expect(output).toContain('Dubai property sector shows early signs of weakness');
  });

  test('prints empty message for no items', () => {
    const output = renderDigest([]);
    expect(output).toContain('No significant news in the check window.');
  });

  test('uses UAE header for default region', () => {
    const output = renderDigest([sampleItem], undefined, now);
    expect(output).toContain('🇦🇪 UAE');
  });

  test('uses US header for us region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'us');
    expect(output).toContain('🇺🇸 US');
  });

  test('uses Germany header for de region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'de');
    expect(output).toContain('🇩🇪 Germany');
  });

  test('uses generic header for unknown region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'xx');
    expect(output).toContain('📰 News');
  });
});

function makeItem(over: Partial<DigestItem>): DigestItem {
  return {
    score: 1,
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
    ], undefined, now);

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
    ], undefined, now);
    expect(out).toContain('• Plain');
  });

  test('shows placeholder for empty sections', () => {
    const out = renderTopicalDigest([
      { topic: makeTopic({ name: 'Quiet', emoji: '🤫' }), items: [] },
    ], undefined, now);
    expect(out).toContain('🤫 Quiet');
    expect(out).toContain('(нет новых материалов)');
  });

  test('uses translations when provided', () => {
    const translations = new Map([['GDP up', 'ВВП вырос']]);
    const out = renderTopicalDigest([
      { topic: makeTopic({}), items: [makeItem({ title: 'GDP up' })] },
    ], translations, now);
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
    );
    expect(out).toMatch(/^🇺🇸 US digest — 2026-05-22\n/);
  });
});
