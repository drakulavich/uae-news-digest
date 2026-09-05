import type { DigestItem } from './digest';
import type { DigestResult } from './pipeline';
import { importanceThreshold } from './importance';
import { matchesTerm } from './terms';
import type { EmojiRule, DigestConfig } from './config/schema';
import { hoursAgo } from './json';

/** First rule whose term appears in the title wins; no rules or no match → "•". */
export function emojiFor(title: string, rules: readonly EmojiRule[] | undefined): string {
  const rule = rules?.find((r) => r.terms.some((t) => matchesTerm(title, t)));
  return rule?.emoji ?? '•';
}

function itemLine(item: DigestItem, now: Date, showSignals: boolean, emoji: readonly EmojiRule[] | undefined): string {
  const title = item.translatedTitle ?? item.title;
  const marker = showSignals && item.signals.length > 0 ? ` [${item.signals.join(', ')}]` : '';
  return `  ${emojiFor(item.title, emoji)} ${title} (${item.source}, ${hoursAgo(item.publishedAt, now)}h ago)${marker}`;
}

/** The human-readable digest: header, optional 🚨 Important block, one section per topic in config order. */
export function renderText(result: DigestResult, config: DigestConfig, now: Date): string {
  const { display } = config;
  const dateLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone: display.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const lines: string[] = [`${display.flag} ${display.name} digest — ${dateLabel}`, ''];

  const threshold = importanceThreshold(config.importance);
  const important = result.sections.flatMap((s) =>
    s.items.filter((i) => i.importance >= threshold).map((item) => ({ item, topic: s.topic })),
  );
  const importantKeys = new Set(important.map((e) => e.item.key));

  if (important.length > 0) {
    lines.push('🚨 Important');
    for (const { item, topic } of important) {
      lines.push(`${itemLine(item, now, true, config.emoji)} — ${topic.name}`);
    }
    lines.push('');
  }

  result.sections.forEach((section, i) => {
    lines.push(`${section.topic.emoji ?? '•'} ${section.topic.name}`);
    const visible = section.items.filter((item) => !importantKeys.has(item.key));
    if (visible.length === 0) {
      lines.push(section.items.length > 0 ? '  (all items are in 🚨 Important)' : '  (no new items)');
    } else {
      for (const item of visible) lines.push(itemLine(item, now, false, config.emoji));
    }
    if (i < result.sections.length - 1) lines.push('');
  });

  return lines.join('\n');
}
