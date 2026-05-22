import { parseRss } from './rss';
import { buildDigest } from './digest';
import { renderDigest, renderTopicalDigest } from './render';
import { translateDeepL } from './translate';
import type { DigestItem } from './digest';
import type { TopicConfig, TopicsConfig } from './topics';

export type TopicSection = {
  topic: TopicConfig;
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
  const digest = buildDigest(items, {
    seenKeys: options.seenKeys,
    hours: options.hours,
    limit: options.limit,
    now: options.now,
  });

  let translations: Map<string, string> | undefined;
  const warnings: string[] = [];

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
    output: renderDigest(digest, translations, options.now ?? new Date(), options.region ?? 'uae'),
    nextSeenKeys: mergeSeenKeys(options.seenKeys, digest),
    warnings,
  };
}

export type TopicFetcher = (topic: TopicConfig) => Promise<string>;

export type RunTopicalDigestOptions = {
  config: TopicsConfig;
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

    const items = buildDigest(parseRss(result.value), {
      seenKeys: seen,
      hours: opts.hours,
      limit: opts.limitOverride ?? topic.limit,
      now,
    });

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
    output: renderTopicalDigest(sections, translations, now),
    nextSeenKeys: seen,
    warnings,
  };
}
