import { describe, expect, test } from 'bun:test';
import { buildRssUrl } from '../../src/region';

describe('buildRssUrl', () => {
  test('returns Google News RSS URL for known region', () => {
    const url = buildRssUrl('uae');
    expect(url).toContain('news.google.com/rss/search');
    expect(url).toContain('UAE');
    expect(url).toContain('gl=AE');
  });

  test('supports us region', () => {
    const url = buildRssUrl('us');
    expect(url).toContain('gl=US');
    expect(url).toContain('USA');
  });

  test('supports uk region', () => {
    const url = buildRssUrl('uk');
    expect(url).toContain('gl=GB');
  });

  test('supports de region', () => {
    const url = buildRssUrl('de');
    expect(url).toContain('gl=DE');
    expect(url).toContain('hl=de');
  });

  test('supports ru region', () => {
    const url = buildRssUrl('ru');
    expect(url).toContain('gl=RU');
    expect(url).toContain('hl=ru');
  });

  test('is case-insensitive', () => {
    const url = buildRssUrl('UAE');
    expect(url).toContain('gl=AE');
  });

  test('throws for unknown region with available options', () => {
    expect(() => buildRssUrl('xx')).toThrow('Unknown region "xx"');
    expect(() => buildRssUrl('xx')).toThrow('uae');
  });
});
