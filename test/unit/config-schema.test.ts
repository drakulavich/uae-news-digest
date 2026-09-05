// test/unit/config-schema.test.ts
import { describe, expect, test } from 'bun:test';
import { parseConfig } from '../../src/config/schema';

const minimal = {
  locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
  topics: [{ slug: 'a', name: 'A', query: 'q' }],
};

describe('parseConfig — structure', () => {
  test('accepts a minimal config and applies defaults', () => {
    const cfg = parseConfig(minimal, 'test');
    expect(cfg.display).toEqual({ flag: '🌐', name: 'News', timezone: 'UTC' });
    expect(cfg.topics[0]).toMatchObject({ slug: 'a', limit: 5, locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' } });
    expect(cfg.topics[0]!.matchMode).toBeUndefined();
    expect(cfg.skip).toBeUndefined();
    expect(cfg.scoring).toBeUndefined();
    expect(cfg.importance).toBeUndefined();
    expect(cfg.emoji).toBeUndefined();
  });

  test('requires locale', () => {
    expect(() => parseConfig({ topics: minimal.topics }, 'test')).toThrow(/locale/);
  });

  test('per-topic locale overrides the top-level one', () => {
    const cfg = parseConfig({
      ...minimal,
      topics: [{ slug: 'de', name: 'DE', query: 'x', locale: { hl: 'de', gl: 'DE', ceid: 'DE:de' } }],
    }, 'test');
    expect(cfg.topics[0]!.locale).toEqual({ hl: 'de', gl: 'DE', ceid: 'DE:de' });
  });

  test('rejects an empty topics array', () => {
    expect(() => parseConfig({ ...minimal, topics: [] }, 'test')).toThrow(/at least one topic/i);
  });

  test('rejects a topic missing slug, with the JSON path', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ name: 'X', query: 'q' }] }, 'test')).toThrow(/topics\[0\]\.slug/);
  });

  test('rejects a topic missing query', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A' }] }, 'test')).toThrow(/query/);
  });

  test('rejects duplicate slugs', () => {
    expect(() => parseConfig({
      ...minimal,
      topics: [{ slug: 'x', name: 'X', query: 'a' }, { slug: 'x', name: 'Y', query: 'b' }],
    }, 'test')).toThrow(/duplicate.*slug.*x/i);
  });

  test('rejects a non-positive limit', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', limit: 0 }] }, 'test')).toThrow(/limit/);
  });

  test('rejects unknown keys (typos)', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', matchmode: 'any' }] }, 'test')).toThrow(/matchmode/);
    expect(() => parseConfig({ ...minimal, scorring: {} }, 'test')).toThrow(/scorring/);
  });

  test('trims whitespace from string fields', () => {
    const cfg = parseConfig({ ...minimal, topics: [{ slug: '  economy ', name: ' Экономика  ', query: '  UAE economy  ', emoji: ' 💰 ' }] }, 'test');
    expect(cfg.topics[0]).toMatchObject({ slug: 'economy', name: 'Экономика', query: 'UAE economy', emoji: '💰' });
  });

  test('includes the source in the error message', () => {
    expect(() => parseConfig({}, '/tmp/x.json')).toThrow(/Invalid config at \/tmp\/x\.json/);
  });

  test('accepts an absolute http(s) feedUrl on a topic', () => {
    const cfg = parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', feedUrl: 'http://localhost:8080/rss' }] }, 'test');
    expect(cfg.topics[0]!.feedUrl).toBe('http://localhost:8080/rss');
  });

  test('rejects a relative or non-http feedUrl', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', feedUrl: '/rss' }] }, 'test')).toThrow(/feedUrl/);
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', feedUrl: 'ftp://x/rss' }] }, 'test')).toThrow(/feedUrl/);
  });
});

describe('parseConfig — match / matchMode', () => {
  const withMatch = (extra: Record<string, unknown>) =>
    parseConfig({ ...minimal, topics: [{ slug: 's', name: 'S', query: 'q', ...extra }] }, 'test').topics[0]!;

  test('parses match and matchMode', () => {
    const t = withMatch({ match: ['school', 'fees'], matchMode: 'any' });
    expect(t.match).toEqual(['school', 'fees']);
    expect(t.matchMode).toBe('any');
  });

  test('defaults matchMode to "all" when match is present', () => {
    expect(withMatch({ match: ['school'] }).matchMode).toBe('all');
  });

  test('accepts a positive-integer matchMode', () => {
    expect(withMatch({ match: ['a', 'b', 'c'], matchMode: 2 }).matchMode).toBe(2);
  });

  test('rejects an invalid matchMode', () => {
    expect(() => withMatch({ match: ['a'], matchMode: 'sometimes' })).toThrow(/matchMode/);
  });

  test('rejects a non-array or empty match', () => {
    expect(() => withMatch({ match: 'school' })).toThrow(/match/);
    expect(() => withMatch({ match: [] })).toThrow(/match/);
    expect(() => withMatch({ match: ['ok', 5] })).toThrow(/match\[1\]/);
  });

  test('rejects matchMode without match', () => {
    expect(() => withMatch({ matchMode: 'any' })).toThrow(/matchMode requires/);
  });
});

describe('parseConfig — heuristics', () => {
  test('parses every heuristic section and applies nested defaults', () => {
    const cfg = parseConfig({
      ...minimal,
      display: { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' },
      skip: ['opinion', 'horse'],
      scoring: {
        sourceTiers: [{ weight: 5, sources: ['reuters'] }],
        titleBoosts: [{ weight: 2, terms: ['Dubai'] }],
      },
      dedupe: { synonyms: { drones: 'uav' } },
      importance: {
        breaking: { weight: 4, markers: ['missile', 'evacuat*'] },
        fluff: { penalty: 3, markers: ['award'] },
      },
      emoji: [{ emoji: '🌧️', terms: ['rain'] }],
      agentPrompt: 'Keep what matters.',
    }, 'test');

    expect(cfg.display.name).toBe('UAE');
    expect(cfg.skip).toEqual(['opinion', 'horse']);
    expect(cfg.scoring!.sourceTiers[0]).toEqual({ weight: 5, sources: ['reuters'] });
    expect(cfg.dedupe).toEqual({ similarityThreshold: 0.45, synonyms: { drones: 'uav' }, stopWords: [] });
    expect(cfg.importance!.threshold).toBe(2);
    expect(cfg.importance!.impact).toBeUndefined();
    expect(cfg.importance!.breaking!.markers).toContain('evacuat*');
    expect(cfg.emoji![0]!.emoji).toBe('🌧️');
    expect(cfg.agentPrompt).toBe('Keep what matters.');
  });

  test('rejects a marker with * anywhere but the end', () => {
    expect(() => parseConfig({ ...minimal, importance: { breaking: { weight: 1, markers: ['ev*acuat'] } } }, 'test')).toThrow(/markers\[0\]/);
    expect(() => parseConfig({ ...minimal, skip: ['**'] }, 'test')).toThrow(/skip\[0\]/);
  });

  test('rejects negative weights and out-of-range thresholds', () => {
    expect(() => parseConfig({ ...minimal, scoring: { sourceTiers: [{ weight: -1, sources: ['x'] }] } }, 'test')).toThrow(/weight/);
    expect(() => parseConfig({ ...minimal, dedupe: { similarityThreshold: 1.5 } }, 'test')).toThrow(/similarityThreshold/);
  });

  test('rejects an empty term list', () => {
    expect(() => parseConfig({ ...minimal, emoji: [{ emoji: '🌧️', terms: [] }] }, 'test')).toThrow(/terms/);
  });

  test('rejects a stopWords entry containing "*"', () => {
    expect(() => parseConfig({ ...minimal, dedupe: { stopWords: ['the*'] } }, 'test')).toThrow(/stopWords\[0\]/);
  });

  test('lower-cases dedupe synonyms and stop words so they match title tokens', () => {
    const cfg = parseConfig({ ...minimal, dedupe: { synonyms: { Drone: 'UAV', Drones: 'uav' }, stopWords: ['The', 'says'] } }, 'test');
    expect(cfg.dedupe!.synonyms).toEqual({ drone: 'uav', drones: 'uav' });
    expect(cfg.dedupe!.stopWords).toEqual(['the', 'says']);
  });

  test('rejects dedupe tokens with spaces or punctuation (they can never match a title token)', () => {
    expect(() => parseConfig({ ...minimal, dedupe: { synonyms: { 'air space': 'airport' } } }, 'test')).toThrow(/synonyms/);
    expect(() => parseConfig({ ...minimal, dedupe: { synonyms: { airspace: 'air-port' } } }, 'test')).toThrow(/synonyms/);
    expect(() => parseConfig({ ...minimal, dedupe: { stopWords: ["world's"] } }, 'test')).toThrow(/stopWords\[0\]/);
  });
});
