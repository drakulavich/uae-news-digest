import { describe, expect, test } from 'bun:test';
import { displayTerm, escapeRegExp, findTerms, matchesTerm, termRegExp } from '../../src/pipeline/terms';

describe('matchesTerm', () => {
  test('matches whole words case-insensitively', () => {
    expect(matchesTerm('Dubai rents jump', 'rent')).toBe(true);
    expect(matchesTerm('DUBAI RENT jumps', 'rent')).toBe(true);
  });

  test('accepts s and es plurals', () => {
    expect(matchesTerm('new visa fees announced', 'fee')).toBe(true);
    expect(matchesTerm('two taxes raised', 'tax')).toBe(true);
  });

  test('does not match inside another word', () => {
    expect(matchesTerm('Council reviews current procedures', 'rent')).toBe(false);
    expect(matchesTerm('Dubai taxi drivers', 'tax')).toBe(false);
    expect(matchesTerm('Dubai lawyer profiled', 'law')).toBe(false);
    expect(matchesTerm('Ukraine talks resume', 'rain')).toBe(false);
  });

  test('trailing * matches a prefix (stem)', () => {
    expect(matchesTerm('Residents evacuated after fire', 'evacuat*')).toBe(true);
    expect(matchesTerm('Evacuation ordered', 'evacuat*')).toBe(true);
    expect(matchesTerm('Terrorism charges filed', 'terror*')).toBe(true);
    expect(matchesTerm('reevacuate now', 'evacuat*')).toBe(false); // still needs a left boundary
  });

  test('multi-word and punctuated terms are matched literally', () => {
    expect(matchesTerm('Source: AP News', 'ap news')).toBe(true);
    expect(matchesTerm('via ft.com today', 'ft.com')).toBe(true);
    expect(matchesTerm('via ftXcom today', 'ft.com')).toBe(false);
    expect(matchesTerm("Dubai unveils world's tallest tower", "world's tallest")).toBe(true);
  });

  test('is Unicode-aware', () => {
    expect(matchesTerm('нестабильная погода', 'погода')).toBe(true);
    expect(matchesTerm('непогода', 'погода')).toBe(false);
  });
});

describe('findTerms', () => {
  test('returns matching terms as written, in list order', () => {
    expect(findTerms('Evacuation after missile strike', ['missile', 'evacuat*', 'flood'])).toEqual(['missile', 'evacuat*']);
  });
});

describe('displayTerm', () => {
  test('strips one trailing *', () => {
    expect(displayTerm('evacuat*')).toBe('evacuat');
    expect(displayTerm('missile')).toBe('missile');
  });
});

describe('termRegExp', () => {
  test('is cached per term', () => {
    expect(termRegExp('rent')).toBe(termRegExp('rent'));
  });
});

describe('escapeRegExp', () => {
  test('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });
});
