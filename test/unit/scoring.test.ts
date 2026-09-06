import { describe, expect, test } from 'bun:test';
import { scoreItem } from '../../src/pipeline/scoring';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { ScoringConfig } from '../../src/config/schema';

const scoring = DEFAULT_CONFIG.scoring!;

describe('scoreItem with the default config', () => {
  test('tier 1 international sources get +5', () => {
    for (const s of ['Reuters', 'BBC', 'AP News', 'The New York Times', 'The Washington Post', 'The Economist', 'Financial Times', 'Bloomberg', 'Wall Street Journal', 'The Guardian']) {
      expect(scoreItem('Generic headline', s, scoring)).toBe(5);
    }
  });

  test('tier 2 regional sources get +3', () => {
    for (const s of ['Al Jazeera', 'Deutsche Welle', 'France 24', 'CNBC', 'CNN', 'Anadolu Agency']) {
      expect(scoreItem('Generic headline', s, scoring)).toBe(3);
    }
  });

  test('tier 3 local sources get +2', () => {
    for (const s of ['Gulf News', 'Khaleej Times', 'The National', 'Zawya']) {
      expect(scoreItem('Generic headline', s, scoring)).toBe(2);
    }
  });

  test('unknown source gets 0', () => {
    expect(scoreItem('Generic headline about nothing', 'Unknown Blog', scoring)).toBe(0);
  });

  test('UAE mention and priority keyword each add +2, once per boost', () => {
    expect(scoreItem('Dubai sees growth', 'Unknown Blog', scoring)).toBe(2);
    expect(scoreItem('Abu Dhabi airport news', 'Unknown Blog', scoring)).toBe(4);
    expect(scoreItem('Rain expected tomorrow', 'Unknown', scoring)).toBe(2);
    expect(scoreItem('Dubai airport closed due to rain', 'Reuters', scoring)).toBe(9);
    expect(scoreItem('Dubai airport closed due to rain', 'Gulf News', scoring)).toBe(6);
  });

  test('boost terms match whole words only', () => {
    expect(scoreItem('Ukraine talks resume', 'Unknown', scoring)).toBe(0); // "rain" must not fire
  });
});

describe('scoreItem with custom or absent config', () => {
  test('first matching tier wins, tiers are evaluated in order', () => {
    const custom: ScoringConfig = {
      sourceTiers: [{ weight: 9, sources: ['gazette'] }, { weight: 1, sources: ['gazette', 'herald'] }],
      titleBoosts: [],
    };
    expect(scoreItem('x', 'Daily Gazette', custom)).toBe(9);
    expect(scoreItem('x', 'Herald', custom)).toBe(1);
  });

  test('returns 0 when scoring is not configured', () => {
    expect(scoreItem('Dubai airport closed due to rain', 'Reuters', undefined)).toBe(0);
  });
});
