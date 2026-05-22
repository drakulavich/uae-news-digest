import { parseRss } from './rss';
import { buildDigest } from './digest';
import { renderDigest } from './render';
import { translateDeepL } from './translate';
import type { DigestItem } from './digest';
import type { TopicConfig } from './topics';

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
