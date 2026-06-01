export type ImportanceTier = 'breaking' | 'impact' | 'neutral' | 'fluff';

export type ImportanceResult = {
  importance: number;
  signals: string[];
  tier: ImportanceTier;
};

export const IMPORTANCE_THRESHOLD = 2;

const BREAKING_WEIGHT = 4;
const IMPACT_WEIGHT = 2;
const FLUFF_PENALTY = 3;

/** Safety / threats — what demands an immediate reaction. */
export const BREAKING_MARKERS = [
  'breaking', 'urgent', 'evacuat', 'killed', 'attack', 'missile', 'drone',
  'airspace', 'airport closed', 'banned', 'alert', 'warning', 'storm',
  'flood', 'recall',
];

/** Money / rules / logistics — what materially affects a family's life. */
export const IMPACT_MARKERS = [
  // money / daily life
  'rent', 'fees', 'tax', 'fuel', 'fine', 'salary', 'subsidy',
  // rules / visa / documents
  'visa', 'residency', 'law', 'permit', 'licence', 'school', 'insurance',
  // logistics / infrastructure
  'flight', 'road closed', 'outage', 'metro',
];

/** PR puff — what to push down. */
export const FLUFF_MARKERS = [
  'unveils', 'launches', 'celebrates', 'award', 'vision', 'milestone',
  "world's first", "world's tallest", "world's largest", 'ranked',
  'inaugurat', 'honoured', 'festival',
];

/** The reproducible criterion the external agent applies to enriched JSON. */
export const FILTER_PROMPT =
  "You are a news filter for an expat family in the UAE. Keep only what " +
  "materially affects safety, money, rules/visas, or logistics. Drop PR, " +
  "launches, awards, rankings, and 'world's first/tallest/largest'.";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Markers matched as a prefix to catch inflections (evacuate/evacuation, inaugurate/inauguration). */
const STEM_MARKERS = new Set(['evacuat', 'inaugurat']);

function findMarkers(haystack: string, markers: string[]): string[] {
  const found: string[] = [];
  for (const m of markers) {
    // Stems match as a prefix (evacuat -> evacuate/evacuation).
    // Everything else matches as a whole word plus optional plural
    // (rent -> rent/rents), so "tax" does not match "taxi" nor "law" "lawyer".
    const pattern = STEM_MARKERS.has(m)
      ? '\\b' + escapeRegExp(m)
      : '\\b' + escapeRegExp(m) + '(?:e?s)?\\b';
    if (new RegExp(pattern, 'i').test(haystack)) found.push(m);
  }
  return found;
}

export function scoreImportance(title: string): ImportanceResult {
  const breaking = findMarkers(title, BREAKING_MARKERS);
  const impact = findMarkers(title, IMPACT_MARKERS);
  const fluff = findMarkers(title, FLUFF_MARKERS);

  const importance =
    breaking.length * BREAKING_WEIGHT +
    impact.length * IMPACT_WEIGHT -
    fluff.length * FLUFF_PENALTY;

  let tier: ImportanceTier;
  if (breaking.length > 0) tier = 'breaking';
  else if (importance < 0) tier = 'fluff';
  else if (impact.length > 0) tier = 'impact';
  else tier = 'neutral';

  return { importance, signals: [...breaking, ...impact, ...fluff], tier };
}
