import { describe, expect, test } from 'bun:test';
import { scoreItem } from '../../src/scoring';

describe('scoreItem', () => {
  test('tier 1 international sources get +4', () => {
    expect(scoreItem('Generic headline', 'Reuters')).toBe(4);
    expect(scoreItem('Generic headline', 'BBC')).toBe(4);
    expect(scoreItem('Generic headline', 'AP News')).toBe(4);
    expect(scoreItem('Generic headline', 'The New York Times')).toBe(4);
    expect(scoreItem('Generic headline', 'The Washington Post')).toBe(4);
    expect(scoreItem('Generic headline', 'The Economist')).toBe(4);
    expect(scoreItem('Generic headline', 'Financial Times')).toBe(4);
    expect(scoreItem('Generic headline', 'Bloomberg')).toBe(4);
    expect(scoreItem('Generic headline', 'Wall Street Journal')).toBe(4);
    expect(scoreItem('Generic headline', 'The Guardian')).toBe(4);
  });

  test('tier 2 regional sources get +3', () => {
    expect(scoreItem('Generic headline', 'Al Jazeera')).toBe(3);
    expect(scoreItem('Generic headline', 'Deutsche Welle')).toBe(3);
    expect(scoreItem('Generic headline', 'France 24')).toBe(3);
    expect(scoreItem('Generic headline', 'CNBC')).toBe(3);
    expect(scoreItem('Generic headline', 'CNN')).toBe(3);
    expect(scoreItem('Generic headline', 'Anadolu Agency')).toBe(3);
  });

  test('tier 3 local sources get +2', () => {
    expect(scoreItem('Generic headline', 'Gulf News')).toBe(2);
    expect(scoreItem('Generic headline', 'Khaleej Times')).toBe(2);
    expect(scoreItem('Generic headline', 'The National')).toBe(2);
    expect(scoreItem('Generic headline', 'Zawya')).toBe(2);
  });

  test('unknown source gets 0 (source-only)', () => {
    expect(scoreItem('Generic headline about nothing', 'Unknown Blog')).toBe(0);
  });

  test('UAE mention in title gets +2', () => {
    expect(scoreItem('Dubai sees growth', 'Unknown Blog')).toBe(2);
    expect(scoreItem('Abu Dhabi airport news', 'Unknown Blog')).toBe(4);
  });

  test('priority keyword gets +2', () => {
    expect(scoreItem('Rain expected tomorrow', 'Unknown')).toBe(2);
    expect(scoreItem('Missile launch detected', 'Unknown')).toBe(2);
  });

  test('tier 1 + UAE + priority stacks to 8', () => {
    expect(scoreItem('Dubai airport closed due to rain', 'Reuters')).toBe(8);
  });

  test('tier 3 + UAE + priority stacks to 6', () => {
    expect(scoreItem('Dubai airport closed due to rain', 'Gulf News')).toBe(6);
  });

  test('tiers are mutually exclusive (no double-counting)', () => {
    // Reuters matches only tier 1, not tier 2 or tier 3
    expect(scoreItem('Generic headline', 'Reuters')).toBe(4);
  });
});
