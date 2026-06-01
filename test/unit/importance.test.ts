import { describe, expect, test } from 'bun:test';
import { scoreImportance, IMPORTANCE_THRESHOLD } from '../../src/importance';

describe('scoreImportance', () => {
  test('breaking-safety headline is tier "breaking" and above threshold', () => {
    const r = scoreImportance('UAE intercepts ballistic missile over Abu Dhabi airspace');
    expect(r.tier).toBe('breaking');
    expect(r.importance).toBeGreaterThanOrEqual(IMPORTANCE_THRESHOLD);
    expect(r.signals).toContain('missile');
    expect(r.signals).toContain('airspace');
  });

  test('money/rules impact headline is tier "impact" and above threshold', () => {
    const r = scoreImportance('Dubai rents jump and new visa fees announced');
    expect(r.tier).toBe('impact');
    expect(r.importance).toBeGreaterThanOrEqual(IMPORTANCE_THRESHOLD);
    expect(r.signals).toEqual(expect.arrayContaining(['rent', 'visa', 'fees']));
  });

  test('PR puff headline is tier "fluff", negative, below threshold', () => {
    const r = scoreImportance("Dubai unveils world's tallest tower at glittering festival");
    expect(r.tier).toBe('fluff');
    expect(r.importance).toBeLessThan(0);
    expect(r.importance).toBeLessThan(IMPORTANCE_THRESHOLD);
  });

  test('plain headline is tier "neutral" and below threshold', () => {
    const r = scoreImportance('Local council holds routine monthly meeting');
    expect(r.tier).toBe('neutral');
    expect(r.importance).toBeLessThan(IMPORTANCE_THRESHOLD);
    expect(r.signals).toHaveLength(0);
  });

  test('breaking outranks fluff when both markers present', () => {
    const breaking = scoreImportance('Airport closed after attack; ribbon-cutting ceremony cancelled');
    expect(breaking.tier).toBe('breaking');
  });

  test('word-boundary matching avoids false positives', () => {
    // "current" must NOT match the "rent" marker
    const r = scoreImportance('Council reviews current routine procedures');
    expect(r.signals).not.toContain('rent');
  });

  test('"tax" marker does not fire on "taxi"', () => {
    const r = scoreImportance('Dubai taxi drivers complete training programme');
    expect(r.signals).not.toContain('tax');
  });

  test('"law" marker does not fire on "lawyer"', () => {
    const r = scoreImportance('Dubai lawyer profiled in weekend feature');
    expect(r.signals).not.toContain('law');
  });
});
