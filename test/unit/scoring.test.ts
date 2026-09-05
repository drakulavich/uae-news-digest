import { describe, expect, test } from 'bun:test';
import { scoreItem, titleSimilarity } from '../../src/scoring';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { DedupeConfig, ScoringConfig } from '../../src/config/schema';

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

describe('titleSimilarity', () => {
  const dedupe = DEFAULT_CONFIG.dedupe!;

  test('is 1 for identical titles and 0 for disjoint ones', () => {
    expect(titleSimilarity('Dubai rents rise', 'Dubai rents rise', dedupe)).toBe(1);
    expect(titleSimilarity('Dubai rents rise', 'Oil output falls', dedupe)).toBe(0);
  });

  test('synonyms and stop words from the config bring paraphrases together', () => {
    const a = 'UAE says it intercepted 5 Iranian missiles, 17 drones';
    const b = 'UAE air defences engage 5 ballistic missiles, 17 UAVs on March 24';
    expect(titleSimilarity(a, b, dedupe)).toBeGreaterThanOrEqual(0.45);
    expect(titleSimilarity(a, b, undefined)).toBeLessThan(0.45);
  });

  test('a custom dedupe config is honoured', () => {
    const custom: DedupeConfig = { similarityThreshold: 0.5, synonyms: { auto: 'car', automobile: 'car' }, stopWords: ['the'] };
    expect(titleSimilarity('the auto market', 'the automobile market', custom)).toBe(1);
  });

  test('empty titles return 1', () => {
    expect(titleSimilarity('', '', dedupe)).toBe(1);
  });

  test('synonym lookup ignores inherited object properties', () => {
    // "constructor" is a real word and also an inherited key of every plain object;
    // it must survive as a token, not be replaced by Object's constructor function.
    const custom: DedupeConfig = { similarityThreshold: 0.5, synonyms: {}, stopWords: [] };
    expect(titleSimilarity('constructor plan', 'constructor scheme', custom)).toBeCloseTo(1 / 3);
  });
});
