import { displayTerm, findTerms } from './terms';
import type { ImportanceConfig } from '../config/schema';

export type ImportanceTier = 'breaking' | 'impact' | 'neutral' | 'fluff';

export type ImportanceResult = {
  importance: number;
  signals: string[];
  tier: ImportanceTier;
};

/** Items at or above this score are promoted to the 🚨 Important block. No config → never. */
export function importanceThreshold(importance: ImportanceConfig | undefined): number {
  return importance?.threshold ?? Number.POSITIVE_INFINITY;
}

export function scoreImportance(title: string, importance: ImportanceConfig | undefined): ImportanceResult {
  if (!importance) return { importance: 0, signals: [], tier: 'neutral' };

  const breaking = findTerms(title, importance.breaking?.markers ?? []);
  const impact = findTerms(title, importance.impact?.markers ?? []);
  const fluff = findTerms(title, importance.fluff?.markers ?? []);

  const score =
    breaking.length * (importance.breaking?.weight ?? 0) +
    impact.length * (importance.impact?.weight ?? 0) -
    fluff.length * (importance.fluff?.penalty ?? 0);

  let tier: ImportanceTier;
  if (breaking.length > 0) tier = 'breaking';
  else if (score < 0) tier = 'fluff';
  else if (impact.length > 0) tier = 'impact';
  else tier = 'neutral';

  return { importance: score, signals: [...breaking, ...impact, ...fluff].map(displayTerm), tier };
}
