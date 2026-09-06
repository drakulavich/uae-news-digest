import { matchesTerm } from './terms';
import type { ScoringConfig } from '../config/schema';

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
