import { parseRss } from './rss';
import { buildDigestWithStats } from './digest';
import { renderDigest, renderTopicalDigest } from './render';
import { translateDeepL } from './translate';
import { localeContextFor } from './region';
import type { DigestItem, MatchMode } from './digest';
import type { DigestConfig, Heuristics, Topic } from './config/schema';

export type TopicSection = {
  topic: Topic;
  items: DigestItem[];
};

export type RunDigestOptions = {
  xml: string;
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  deeplAuthKey?: string;
  targetLang?: string;
  region?: string;
  match?: string[];
  matchMode?: MatchMode;
  heuristics: Heuristics;
};

export type RunDigestResult = {
  digest: DigestItem[];
  output: string;
  nextSeenKeys: Set<string>;
  warnings: string[];
};

export function mergeSeenKeys(seenKeys: Set<string>, digest: DigestItem[]): Set<string> {
  return new Set([...seenKeys, ...digest.map((item) => item.key)]);
}

export async function runDigest(options: RunDigestOptions): Promise<RunDigestResult> {
  const items = parseRss(options.xml);
  const { items: digest, droppedByMatch } = buildDigestWithStats(items, {
    seenKeys: options.seenKeys,
    hours: options.hours,
    limit: options.limit,
    now: options.now,
    match: options.match,
    matchMode: options.matchMode,
    heuristics: options.heuristics,
  });

  let translations: Map<string, string> | undefined;
  const warnings: string[] = [];

  if (droppedByMatch > 0) {
    warnings.push(`${droppedByMatch} item(s) dropped — missing required keywords`);
  }

  if (options.targetLang && options.deeplAuthKey && digest.length > 0) {
    const titles = digest.map((d) => d.title);
    const translated = await translateDeepL(titles, options.deeplAuthKey, options.targetLang);
    if (translated) {
      translations = new Map();
      for (let i = 0; i < titles.length; i++) {
        translations.set(titles[i]!, translated[i]!);
      }
    } else {
      warnings.push(`DeepL translation to ${options.targetLang} failed; using original titles.`);
    }
  }

  return {
    digest,
    output: renderDigest(digest, translations, options.now ?? new Date(), options.region ?? 'uae', options.heuristics),
    nextSeenKeys: mergeSeenKeys(options.seenKeys, digest),
    warnings,
  };
}

export type TopicFetcher = (topic: Topic) => Promise<string>;

export type RunTopicalDigestOptions = {
  config: DigestConfig;
  seenKeys: Set<string>;
  hours: number;
  limitOverride?: number;
  fetchTopicRss: TopicFetcher;
  now?: Date;
  deeplAuthKey?: string;
  targetLang?: string;
};

export type RunTopicalDigestResult = {
  sections: TopicSection[];
  output: string;
  nextSeenKeys: Set<string>;
  warnings: string[];
};

export async function runTopicalDigest(
  opts: RunTopicalDigestOptions,
): Promise<RunTopicalDigestResult> {
  const now = opts.now ?? new Date();
  const fetched = await Promise.allSettled(
    opts.config.topics.map((t) => opts.fetchTopicRss(t)),
  );

  const seen = new Set(opts.seenKeys);
  const sections: TopicSection[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < opts.config.topics.length; i++) {
    const topic = opts.config.topics[i]!;
    const result = fetched[i]!;
    if (result.status === 'rejected') {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`Topic "${topic.slug}" failed: ${msg}`);
      sections.push({ topic, items: [] });
      continue;
    }

    const { items, droppedByMatch } = buildDigestWithStats(parseRss(result.value), {
      seenKeys: seen,
      hours: opts.hours,
      limit: opts.limitOverride ?? topic.limit,
      now,
      match: topic.match,
      matchMode: topic.matchMode,
      heuristics: opts.config,
    });

    if (droppedByMatch > 0) {
      warnings.push(`Topic "${topic.slug}": ${droppedByMatch} item(s) dropped — missing required keywords`);
    }

    if (items.length === 0) {
      warnings.push(`Topic "${topic.slug}" returned 0 items — check the query syntax`);
    }

    for (const it of items) seen.add(it.key);
    sections.push({ topic, items });
  }

  let translations: Map<string, string> | undefined;
  if (opts.targetLang && opts.deeplAuthKey) {
    const titles = [...new Set(sections.flatMap((s) => s.items.map((i) => i.title)))];
    if (titles.length > 0) {
      const translated = await translateDeepL(titles, opts.deeplAuthKey, opts.targetLang);
      if (translated) {
        translations = new Map();
        for (let i = 0; i < titles.length; i++) {
          translations.set(titles[i]!, translated[i]!);
        }
      } else {
        warnings.push(`DeepL translation to ${opts.targetLang} failed; using original titles.`);
      }
    }
  }

  return {
    sections,
    output: renderTopicalDigest(sections, translations, now, localeContextFor(opts.config.locale.gl), opts.config),
    nextSeenKeys: seen,
    warnings,
  };
}
