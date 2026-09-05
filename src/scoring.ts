import { matchesTerm } from './terms';
import type { DedupeConfig, ScoringConfig } from './config/schema';

/** Source-tier weight (first matching tier wins) plus one additive weight per matching title boost. */
export function scoreItem(title: string, source: string, scoring: ScoringConfig | undefined): number {
  if (!scoring) return 0;
  let score = 0;
  const tier = scoring.sourceTiers.find((t) => t.sources.some((s) => matchesTerm(source, s)));
  if (tier) score += tier.weight;
  for (const boost of scoring.titleBoosts) {
    if (boost.terms.some((t) => matchesTerm(title, t))) score += boost.weight;
  }
  return score;
}

function extractWords(title: string, dedupe: DedupeConfig | undefined): string[] {
  const synonyms = dedupe?.synonyms ?? {};
  const stop = new Set(dedupe?.stopWords ?? []);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map((w) => synonyms[w] ?? w)
    .filter((w) => w.length > 1 && !stop.has(w));
}

/** Jaccard similarity over synonym-normalised, stop-word-filtered title words. */
export function titleSimilarity(a: string, b: string, dedupe: DedupeConfig | undefined): number {
  const wa = new Set(extractWords(a, dedupe));
  const wb = new Set(extractWords(b, dedupe));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}
