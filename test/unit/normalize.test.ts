import { describe, expect, test } from 'bun:test';
import { titleSimilarity } from '../../src/scoring';

describe('titleSimilarity', () => {
  test('identical titles return 1', () => {
    expect(titleSimilarity('Dubai market rises', 'Dubai market rises')).toBe(1);
  });

  test('completely different titles return low similarity', () => {
    const sim = titleSimilarity('Dubai airport closure', 'Iran nuclear talks resume');
    expect(sim).toBeLessThan(0.3);
  });

  test('similar titles about the same event score high', () => {
    const sim = titleSimilarity(
      'UAE says it intercepted 5 Iranian missiles, 17 drones',
      'UAE air defences engage 5 ballistic missiles, 17 UAVs'
    );
    expect(sim).toBeGreaterThan(0.4);
  });

  test('empty titles return 1', () => {
    expect(titleSimilarity('', '')).toBe(1);
  });
});
