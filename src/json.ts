import type { DigestResult } from './pipeline';
import type { ImportanceTier } from './importance';

export function hoursAgo(publishedAt: Date, now: Date): number {
  return Math.round((now.getTime() - publishedAt.getTime()) / 3_600_000);
}

export type DigestJsonItem = {
  topic: string;
  title: string;
  translatedTitle: string | null;
  source: string;
  url: string | null;
  publishedAt: string;
  hoursAgo: number;
  score: number;
  importance: number;
  tier: ImportanceTier;
  signals: string[];
  matchedTerms: string[];
};

export type DigestJson = {
  tool: string;
  version: string;
  generatedAt: string;
  query: { hours: number; limit: number | null; targetLang: string | null };
  topics: { slug: string; name: string; count: number }[];
  count: number;
  warnings: string[];
  items: DigestJsonItem[];
};

export type JsonMeta = {
  tool: string;
  version: string;
  hours: number;
  limit?: number;
  targetLang?: string;
  now: Date;
};

/** The machine-readable envelope printed by `--json`. Items are flat, in section order, tagged with their topic slug. */
export function toJson(result: DigestResult, meta: JsonMeta): DigestJson {
  const items = result.sections.flatMap((s) =>
    s.items.map((d): DigestJsonItem => ({
      topic: s.topic.slug,
      title: d.title,
      translatedTitle: d.translatedTitle ?? null,
      source: d.source,
      url: d.url ?? null,
      publishedAt: d.publishedAt.toISOString(),
      hoursAgo: hoursAgo(d.publishedAt, meta.now),
      score: d.score,
      importance: d.importance,
      tier: d.tier,
      signals: d.signals,
      matchedTerms: d.matchedTerms,
    })),
  );
  return {
    tool: meta.tool,
    version: meta.version,
    generatedAt: meta.now.toISOString(),
    query: { hours: meta.hours, limit: meta.limit ?? null, targetLang: meta.targetLang ?? null },
    topics: result.sections.map((s) => ({ slug: s.topic.slug, name: s.topic.name, count: s.items.length })),
    count: items.length,
    warnings: result.warnings,
    items,
  };
}
