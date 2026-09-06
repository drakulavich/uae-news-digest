import type { DedupeConfig } from '../config/schema';

function extractWords(title: string, dedupe: DedupeConfig | undefined): string[] {
  const synonyms = dedupe?.synonyms ?? {};
  const stop = new Set(dedupe?.stopWords ?? []);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    // hasOwn: a plain object inherits keys like "constructor" that must not act as synonyms.
    .map((w) => (Object.hasOwn(synonyms, w) ? synonyms[w]! : w))
    .filter((w) => w.length > 1 && !stop.has(w));
}

/** Jaccard similarity over synonym-normalised, stop-word-filtered title words. */
export function titleSimilarity(a: string, b: string, dedupe: DedupeConfig | undefined): number {
  const wa = new Set(extractWords(a, dedupe));
  const wb = new Set(extractWords(b, dedupe));
  // No words to compare (e.g. non-Latin titles under ASCII extraction): only a verbatim repeat counts as a duplicate.
  if (wa.size === 0 || wb.size === 0) return a === b && a.length > 0 ? 1 : 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}
