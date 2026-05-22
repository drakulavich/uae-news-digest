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

  test('accepts a raw locale+query object', () => {
    const url = buildRssUrl({
      q: '(Iran OR Tehran) AND (UAE OR oil)',
      hl: 'en',
      gl: 'AE',
      ceid: 'AE:en',
    });
    expect(url).toContain('news.google.com/rss/search');
    expect(url).toContain('Iran');
    expect(url).toContain('hl=en');
    expect(url).toContain('gl=AE');
    expect(url).toContain('ceid=AE%3Aen');
  });

  test('object form percent-encodes the query', () => {
    const url = buildRssUrl({ q: 'a b "c"', hl: 'en', gl: 'AE', ceid: 'AE:en' });
    expect(url).toContain('q=a%20b%20%22c%22');
  });

  test('object form rejects empty fields', () => {
    expect(() => buildRssUrl({ q: '', hl: 'en', gl: 'AE', ceid: 'AE:en' })).toThrow(/non-empty/);
    expect(() => buildRssUrl({ q: 'x', hl: '',   gl: 'AE', ceid: 'AE:en' })).toThrow(/non-empty/);
    expect(() => buildRssUrl({ q: 'x', hl: 'en', gl: '',   ceid: 'AE:en' })).toThrow(/non-empty/);
    expect(() => buildRssUrl({ q: 'x', hl: 'en', gl: 'AE', ceid: ''       })).toThrow(/non-empty/);
  });
});
