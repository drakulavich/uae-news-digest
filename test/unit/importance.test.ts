import { describe, expect, test } from 'bun:test';
import { importanceThreshold, scoreImportance } from '../../src/pipeline/importance';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { ImportanceConfig } from '../../src/config/schema';

const importance = DEFAULT_CONFIG.importance!;
const threshold = importanceThreshold(importance);

describe('scoreImportance with the default config', () => {
  test('breaking-safety headline is tier "breaking" and above threshold', () => {
    const r = scoreImportance('UAE intercepts ballistic missile over Abu Dhabi airspace', importance);
    expect(r.tier).toBe('breaking');
    expect(r.importance).toBeGreaterThanOrEqual(threshold);
    expect(r.signals).toEqual(expect.arrayContaining(['missile', 'airspace']));
  });

  test('stem markers match inflections and are reported without the *', () => {
    const r = scoreImportance('Residents evacuated after gas leak', importance);
    expect(r.tier).toBe('breaking');
    expect(r.signals).toContain('evacuat');
    expect(r.signals.join()).not.toContain('*');
  });

  test('money/rules headline is tier "impact" and above threshold', () => {
    const r = scoreImportance('Dubai rents jump and new visa fees announced', importance);
    expect(r.tier).toBe('impact');
    expect(r.importance).toBeGreaterThanOrEqual(threshold);
    expect(r.signals).toEqual(expect.arrayContaining(['rent', 'visa', 'fees']));
  });

  test('PR puff headline is tier "fluff", negative, below threshold', () => {
    const r = scoreImportance("Dubai unveils world's tallest tower at glittering festival", importance);
    expect(r.tier).toBe('fluff');
    expect(r.importance).toBeLessThan(0);
  });

  test('plain headline is tier "neutral" with no signals', () => {
    const r = scoreImportance('Local council holds routine monthly meeting', importance);
    expect(r.tier).toBe('neutral');
    expect(r.importance).toBeLessThan(threshold);
    expect(r.signals).toHaveLength(0);
  });

  test('breaking outranks fluff when both are present', () => {
    expect(scoreImportance('Airport closed after attack; ribbon-cutting ceremony cancelled', importance).tier).toBe('breaking');
  });

  test('whole-word matching avoids false positives', () => {
    expect(scoreImportance('Council reviews current routine procedures', importance).signals).not.toContain('rent');
    expect(scoreImportance('Dubai taxi drivers complete training programme', importance).signals).not.toContain('tax');
    expect(scoreImportance('Dubai lawyer profiled in weekend feature', importance).signals).not.toContain('law');
  });
});

describe('scoreImportance with custom or absent config', () => {
  test('uses the configured weights and penalty', () => {
    const custom: ImportanceConfig = {
      threshold: 5,
      breaking: { weight: 10, markers: ['quake'] },
      fluff: { penalty: 1, markers: ['gala'] },
    };
    const r = scoreImportance('Quake shakes city gala', custom);
    expect(r.importance).toBe(9);
    expect(r.tier).toBe('breaking');
    expect(importanceThreshold(custom)).toBe(5);
  });

  test('is neutral when importance is not configured', () => {
    expect(scoreImportance('UAE intercepts missile', undefined)).toEqual({ importance: 0, signals: [], tier: 'neutral' });
    expect(importanceThreshold(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});
