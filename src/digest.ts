import { normalizeTitle, normalizeSource, makeKey } from './normalize';
import { scoreItem, titleSimilarity } from './scoring';
import { scoreImportance, type ImportanceTier } from './importance';
import { escapeRegExp } from './terms';
import type { RssItem } from './rss';
import type { Heuristics, MatchMode } from './config/schema';

export type { MatchMode } from './config/schema';

const DEFAULT_SKIP_RE = /(opinion|daily mail|travel and tour world|tradingview|cycling|horse|football|msn|substack|influencer|hotel room|fitness journey|baskin-robbins)/i;
const FUZZY_SIMILARITY_THRESHOLD = 0.45;

export type DigestItem = {
  score: number;
  importance: number;
  signals: string[];
  tier: ImportanceTier;
  publishedAt: Date;
  title: string;
  source: string;
  key: string;
  matchedTerms?: string[];
  link?: string;
};

export function matchTerms(
  title: string,
  match: string[],
  mode: MatchMode,
): { ok: boolean; matchedTerms: string[] } {
  const hay = title.toLowerCase();
  const matchedTerms = match.filter((t) =>
    // Whole word + optional plural: "school" matches "school"/"schools"
    // but not "schooling"; "fee" matches "fee"/"fees".
    new RegExp('\\b' + escapeRegExp(t.toLowerCase()) + '(?:e?s)?\\b').test(hay),
  );
  let need: number;
  if (mode === 'all') need = match.length;
  else if (mode === 'any') need = 1;
  else need = Math.max(1, Math.min(mode, match.length));
  return { ok: matchedTerms.length >= need, matchedTerms };
}

export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  skipRe?: RegExp;
  match?: string[];
  matchMode?: MatchMode;
  heuristics: Heuristics;
};

export type BuildDigestResult = { items: DigestItem[]; droppedByMatch: number };

export function parsePubDate(pubDate: string | undefined): Date | null {
  if (!pubDate) return null;
  const parsed = new Date(pubDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildDigestWithStats(items: RssItem[], options: BuildDigestOptions): BuildDigestResult {
  const { seenKeys, hours, limit, now = new Date(), skipRe = DEFAULT_SKIP_RE, match, matchMode = 'all' } = options;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const unique = new Map<string, DigestItem>();
  let droppedByMatch = 0;

  for (const item of items) {
    const title = normalizeTitle(item.title);
    const source = normalizeSource(item.source);
    if (!title) continue;
    if (skipRe.test(title) || skipRe.test(source)) continue;

    const publishedAt = parsePubDate(item.pubDate);
    if (!publishedAt) continue;
    if (publishedAt < cutoff) continue;

    const key = makeKey(title, source);
    if (seenKeys.has(key)) continue;

    let matchedTerms: string[] | undefined;
    if (match && match.length > 0) {
      const m = matchTerms(title, match, matchMode);
      if (!m.ok) { droppedByMatch++; continue; }
      matchedTerms = m.matchedTerms;
    }

    const imp = scoreImportance(title);
    const digestItem: DigestItem = {
      score: scoreItem(title, source),
      importance: imp.importance,
      signals: imp.signals,
      tier: imp.tier,
      publishedAt,
      title,
      source,
      key,
      matchedTerms,
      link: item.link,
    };

    const existing = unique.get(key);
    if (existing) {
      const replace = digestItem.score > existing.score || (digestItem.score === existing.score && digestItem.publishedAt > existing.publishedAt);
      if (replace) unique.set(key, digestItem);
      continue;
    }

    let fuzzyDup = false;
    for (const [existingKey, existingItem] of unique) {
      if (titleSimilarity(title, existingItem.title) >= FUZZY_SIMILARITY_THRESHOLD) {
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

export function buildDigest(items: RssItem[], options: BuildDigestOptions): DigestItem[] {
  return buildDigestWithStats(items, options).items;
}
