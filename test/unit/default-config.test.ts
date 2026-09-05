import { describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '../../src/config/load';
import { parseConfig } from '../../src/config/schema';
import defaultJson from '../../src/config/default.json';

describe('built-in default config', () => {
  test('validates against the schema', () => {
    expect(() => parseConfig(defaultJson, 'default.json')).not.toThrow();
  });

  test('describes the UAE region with one topic', () => {
    expect(DEFAULT_CONFIG.display).toEqual({ flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' });
    expect(DEFAULT_CONFIG.locale).toEqual({ hl: 'en', gl: 'AE', ceid: 'AE:en' });
    expect(DEFAULT_CONFIG.topics).toHaveLength(1);
    expect(DEFAULT_CONFIG.topics[0]!.query).toBe('UAE OR "Abu Dhabi" OR Dubai');
    expect(DEFAULT_CONFIG.topics[0]!.limit).toBe(6);
  });

  test('carries every heuristic section', () => {
    expect(DEFAULT_CONFIG.skip).toContain('opinion');
    expect(DEFAULT_CONFIG.scoring!.sourceTiers.map((t) => t.weight)).toEqual([5, 3, 2]);
    expect(DEFAULT_CONFIG.scoring!.titleBoosts).toHaveLength(2);
    expect(DEFAULT_CONFIG.dedupe!.similarityThreshold).toBe(0.45);
    expect(DEFAULT_CONFIG.dedupe!.synonyms.drones).toBe('uav');
    expect(DEFAULT_CONFIG.dedupe!.stopWords).toContain('says');
    expect(DEFAULT_CONFIG.importance!.threshold).toBe(2);
    expect(DEFAULT_CONFIG.importance!.breaking!.markers).toContain('evacuat*');
    expect(DEFAULT_CONFIG.importance!.fluff!.markers).toContain('inaugurat*');
    expect(DEFAULT_CONFIG.emoji![0]).toEqual({ emoji: '🌧️', terms: ['rain', 'weather'] });
    expect(DEFAULT_CONFIG.agentPrompt).toMatch(/^You are a news filter for an expat family in the UAE/);
  });
});
