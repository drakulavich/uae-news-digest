import { describe, expect, test } from 'bun:test';
import { emojiFor } from '../../src/output/emoji';
import { DEFAULT_CONFIG } from '../../src/config/load';

describe('emojiFor with the default rules', () => {
  const rules = DEFAULT_CONFIG.emoji;
  test.each([
    ['Heavy rain expected', '🌧️'],
    ['Unstable weather conditions', '🌧️'],
    ['Property prices surge', '📉'],
    ['Dubai market overview', '📉'],
    ['Airport reopens after delays', '✈️'],
    ['Airspace closed for safety', '✈️'],
    ['Missile intercepted', '🛡️'],
    ['Drone attack reported', '🛡️'],
    ['Hormuz strait tensions', '⛴️'],
    ['Hezbollah funding traced', '🚨'],
    ['Terrorism charges filed', '🚨'],
    ['Schools reopen after break', '🎓'],
    ['Oil prices drop sharply', '🛢️'],
    ['Something completely unrelated', '•'],
  ])('%s → %s', (title, emoji) => {
    expect(emojiFor(title, rules)).toBe(emoji);
  });

  test('first matching rule wins', () => {
    // "rain" (rule 1) beats "airport" (rule 3)
    expect(emojiFor('Dubai airport reopens after rain', rules)).toBe('🌧️');
  });
});

describe('emojiFor with custom or absent rules', () => {
  test('Unicode terms work', () => {
    expect(emojiFor('нестабильная погода обрушивается', [{ emoji: '🌧️', terms: ['погода'] }])).toBe('🌧️');
  });
  test('returns the bullet when no rules are configured', () => {
    expect(emojiFor('Heavy rain expected', undefined)).toBe('•');
  });
});
