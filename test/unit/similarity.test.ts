import { describe, expect, test } from 'bun:test';
import { titleSimilarity } from '../../src/pipeline/similarity';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { DedupeConfig } from '../../src/config/schema';

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

  test('titles with no words match only when they are the same string', () => {
    expect(titleSimilarity('', '', dedupe)).toBe(0);
    // Non-Latin titles reduce to empty word sets under ASCII extraction; different ones must not collapse into one item…
    expect(titleSimilarity('الإمارات تطلق قمراً', 'ارتفاع أسعار النفط', dedupe)).toBe(0);
    // …but the same headline syndicated by two sources is still a duplicate.
    expect(titleSimilarity('الإمارات تطلق قمراً', 'الإمارات تطلق قمراً', dedupe)).toBe(1);
    expect(titleSimilarity('الإمارات تطلق قمراً', 'Dubai rents rise', dedupe)).toBe(0);
  });

  test('synonym lookup ignores inherited object properties', () => {
    // "constructor" is a real word and also an inherited key of every plain object;
    // it must survive as a token, not be replaced by Object's constructor function.
    const custom: DedupeConfig = { similarityThreshold: 0.5, synonyms: {}, stopWords: [] };
    expect(titleSimilarity('constructor plan', 'constructor scheme', custom)).toBeCloseTo(1 / 3);
  });
});
