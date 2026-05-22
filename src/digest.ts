import { normalizeTitle, normalizeSource, makeKey } from './normalize';
import { scoreItem, titleSimilarity } from './scoring';
import type { RssItem } from './rss';

const DEFAULT_SKIP_RE = /(opinion|daily mail|travel and tour world|tradingview|cycling|horse|football|msn|substack|influencer|hotel room|fitness journey|baskin-robbins)/i;
const FUZZY_SIMILARITY_THRESHOLD = 0.45;

export type DigestItem = {
  score: number;
  publishedAt: Date;
  title: string;
  source: string;
  key: string;
};

export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  skipRe?: RegExp;
};

export function parsePubDate(pubDate: string | undefined): Date | null {
  if (!pubDate) return null;
  const parsed = new Date(pubDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildDigest(items: RssItem[], options: BuildDigestOptions): DigestItem[] {
  const { seenKeys, hours, limit, now = new Date(), skipRe = DEFAULT_SKIP_RE } = options;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const unique = new Map<string, DigestItem>();

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

    const digestItem: DigestItem = {
      score: scoreItem(title, source),
      publishedAt,
      title,
      source,
      key,
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

  return [...unique.values()]
    .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime() || a.title.localeCompare(b.title))
    .slice(0, limit);
}
