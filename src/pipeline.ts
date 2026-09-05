// src/pipeline.ts
import { parseRss } from './rss';
import { buildDigestWithStats } from './digest';
import { buildFeedUrl } from './url';
import type { DigestItem } from './digest';
import type { DigestConfig, Topic } from './config/schema';

export type TopicSection = {
  topic: Topic;
  items: DigestItem[];
};

export type FetchText = (url: string) => Promise<string>;
export type Translate = (texts: string[], targetLang: string) => Promise<string[]>;

export type RunOptions = {
  config: DigestConfig;
  seenKeys: Set<string>;
  hours: number;
  /** CLI --limit: when given, caps every topic instead of its own `limit`. */
  limitOverride?: number;
  now: Date;
  fetchText: FetchText;
  translate?: Translate;
  targetLang?: string;
};

export type DigestResult = {
  sections: TopicSection[];
  warnings: string[];
  nextSeenKeys: Set<string>;
  /** Topics whose feed was fetched and parsed; 0 means nothing was retrieved. */
  fetchedTopics: number;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch every topic's feed (in parallel), select items per topic against a shared
 * seen-set so an earlier topic claims a story first, then translate titles in one batch.
 * Network and translation failures become warnings; the caller decides the exit code.
 */
export async function runDigest(opts: RunOptions): Promise<DigestResult> {
  const { config, now } = opts;
  const fetched = await Promise.allSettled(config.topics.map((topic) => opts.fetchText(buildFeedUrl(topic))));

  const seen = new Set(opts.seenKeys);
  const sections: TopicSection[] = [];
  const warnings: string[] = [];
  let fetchedTopics = 0;

  config.topics.forEach((topic, i) => {
    const outcome = fetched[i]!;
    if (outcome.status === 'rejected') {
      warnings.push(`Topic "${topic.slug}" failed: ${errorMessage(outcome.reason)}`);
      sections.push({ topic, items: [] });
      return;
    }

    let rssItems;
    try {
      rssItems = parseRss(outcome.value);
    } catch (err) {
      warnings.push(`Topic "${topic.slug}" failed: could not parse RSS (${errorMessage(err)})`);
      sections.push({ topic, items: [] });
      return;
    }
    fetchedTopics++;

    if (rssItems.length === 0) {
      warnings.push(`Topic "${topic.slug}": feed returned no items — check the query`);
    }

    const { items, droppedByMatch } = buildDigestWithStats(rssItems, {
      seenKeys: seen,
      hours: opts.hours,
      limit: opts.limitOverride ?? topic.limit,
      now,
      match: topic.match,
      matchMode: topic.matchMode,
      heuristics: config,
    });
    if (droppedByMatch > 0) {
      warnings.push(`Topic "${topic.slug}": ${droppedByMatch} item(s) dropped — missing required keywords`);
    }
    for (const item of items) seen.add(item.key);
    sections.push({ topic, items });
  });

  if (opts.targetLang && opts.translate) {
    const all = sections.flatMap((s) => s.items);
    const titles = [...new Set(all.map((i) => i.title))];
    if (titles.length > 0) {
      try {
        const translated = await opts.translate(titles, opts.targetLang);
        if (translated.length !== titles.length) {
          throw new Error(`expected ${titles.length} translations, got ${translated.length}`);
        }
        const byTitle = new Map(titles.map((t, i) => [t, translated[i]!]));
        for (const item of all) item.translatedTitle = byTitle.get(item.title);
      } catch (err) {
        warnings.push(`DeepL translation to ${opts.targetLang} failed (${errorMessage(err)}); using original titles.`);
      }
    }
  }

  return { sections, warnings, nextSeenKeys: seen, fetchedTopics };
}
