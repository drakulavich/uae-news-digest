// One matcher for every configurable word list (importance markers, skip list,
// title boosts, emoji rules, topic match lists). Terms are plain strings, never regexes.

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NOT_WORD_CHAR_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_CHAR_AFTER = '(?![\\p{L}\\p{N}])';

const cache = new Map<string, RegExp>();

/**
 * "rent"      → whole word + optional s/es plural: rent, rents (not current, rental)
 * "evacuat*"  → prefix (stem): evacuate, evacuation (still needs a left word boundary)
 * Case-insensitive, Unicode-aware boundaries so non-Latin terms work.
 */
export function termRegExp(term: string): RegExp {
  const cached = cache.get(term);
  if (cached) return cached;
  const stem = term.endsWith('*');
  const body = escapeRegExp(stem ? term.slice(0, -1) : term);
  const source = stem
    ? `${NOT_WORD_CHAR_BEFORE}${body}`
    : `${NOT_WORD_CHAR_BEFORE}${body}(?:e?s)?${NOT_WORD_CHAR_AFTER}`;
  const re = new RegExp(source, 'iu');
  cache.set(term, re);
  return re;
}

export function matchesTerm(haystack: string, term: string): boolean {
  return termRegExp(term).test(haystack);
}

/** Terms from `terms` that occur in `haystack`, in list order, as written (with `*`). */
export function findTerms(haystack: string, terms: readonly string[]): string[] {
  return terms.filter((t) => matchesTerm(haystack, t));
}

/** Marker as shown to users: "evacuat*" → "evacuat". */
export function displayTerm(term: string): string {
  return term.endsWith('*') ? term.slice(0, -1) : term;
}
