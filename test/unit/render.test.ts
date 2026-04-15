import { describe, expect, test } from 'bun:test';
import { emojiFor, renderDigest } from '../../src/render';
import { makeKey } from '../../src/normalize';
import type { DigestItem } from '../../src/digest';

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
