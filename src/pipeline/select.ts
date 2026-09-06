import { normalizeTitle, normalizeSource, makeKey } from './normalize';
import { scoreItem } from './scoring';
import { titleSimilarity } from './similarity';
import { scoreImportance, type ImportanceTier } from './importance';
import { matchesTerm } from './terms';
import type { RssItem } from './rss';
import { DEFAULT_SIMILARITY_THRESHOLD } from '../config/schema';
import type { Heuristics, MatchMode, Topic } from '../config/schema';

export type { MatchMode } from '../config/schema';

export type DigestItem = {
  score: number;
  importance: number;
  signals: string[];
  tier: ImportanceTier;
  publishedAt: Date;
  title: string;
  translatedTitle?: string;
  source: string;
  key: string;
  matchedTerms: string[];
  url?: string;
};

export function matchTerms(
  title: string,
  match: string[],
  mode: MatchMode,
): { ok: boolean; matchedTerms: string[] } {
  const matchedTerms = match.filter((t) => matchesTerm(title, t));
  let need: number;
  if (mode === 'all') need = match.length;
  else if (mode === 'any') need = 1;
  else need = Math.max(1, Math.min(mode, match.length));
  return { ok: matchedTerms.length >= need, matchedTerms };
}

export type SelectContext = {
  seenKeys: Set<string>;
  hours: number;
  now: Date;
  heuristics: Heuristics;
  /** CLI --limit: when given, caps this topic instead of its own `limit`. */
  limitOverride?: number;
};

export type SelectResult = { items: DigestItem[]; droppedByMatch: number };

export function parsePubDate(pubDate: string | undefined): Date | null {
  if (!pubDate) return null;
  const parsed = new Date(pubDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * One topic's selection: window, skip list, match filter, scoring, exact + fuzzy dedupe, limit.
 * `topic` supplies match/matchMode/limit; `ctx` supplies the run-wide state and heuristics.
 */
export function selectItems(
  rssItems: RssItem[],
  // `match`/`matchMode` as Partial: Topic's `matchMode` is a required key typed `MatchMode | undefined`
  // (the config transform always sets it, even to undefined), so a bare `Pick` would force callers to
  // pass `matchMode: undefined` explicitly even when omitting `match` entirely.
  topic: Pick<Topic, 'limit'> & Partial<Pick<Topic, 'match' | 'matchMode'>>,
  ctx: SelectContext,
): SelectResult {
  const { seenKeys, hours, now, heuristics } = ctx;
  const limit = ctx.limitOverride ?? topic.limit;
  const match = topic.match;
  const matchMode = topic.matchMode ?? 'all';
  const skip = heuristics.skip ?? [];
  const similarityThreshold = heuristics.dedupe?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const unique = new Map<string, DigestItem>();
  let droppedByMatch = 0;

  for (const item of rssItems) {
    const title = normalizeTitle(item.title);
    const source = normalizeSource(item.source);
    if (!title) continue;
    if (skip.some((t) => matchesTerm(title, t) || matchesTerm(source, t))) continue;

    const publishedAt = parsePubDate(item.pubDate);
    if (!publishedAt) continue;
    if (publishedAt < cutoff) continue;

    const key = makeKey(title, source);
    if (seenKeys.has(key)) continue;

    let matchedTerms: string[] = [];
    if (match && match.length > 0) {
      const m = matchTerms(title, match, matchMode);
      if (!m.ok) { droppedByMatch++; continue; }
      matchedTerms = m.matchedTerms;
    }

    const imp = scoreImportance(title, heuristics.importance);
    const digestItem: DigestItem = {
      score: scoreItem(title, source, heuristics.scoring),
      importance: imp.importance,
      signals: imp.signals,
      tier: imp.tier,
      publishedAt,
      title,
      source,
      key,
      matchedTerms,
      url: item.link,
    };

    const existing = unique.get(key);
    if (existing) {
      const replace = digestItem.score > existing.score || (digestItem.score === existing.score && digestItem.publishedAt > existing.publishedAt);
      if (replace) unique.set(key, digestItem);
      continue;
    }

    let fuzzyDup = false;
    for (const [existingKey, existingItem] of unique) {
      if (titleSimilarity(title, existingItem.title, heuristics.dedupe) >= similarityThreshold) {
        if (digestItem.score > existingItem.score || (digestItem.score === existingItem.score && digestItem.publishedAt > existingItem.publishedAt)) {
          unique.delete(existingKey);
          unique.set(key, digestItem);
        }
        fuzzyDup = true;
        break;
      }
    }

    if (!fuzzyDup) {
      unique.set(key, digestItem);
    }
  }

  const result = [...unique.values()]
    .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime() || a.title.localeCompare(b.title))
    .slice(0, limit);
  return { items: result, droppedByMatch };
}
