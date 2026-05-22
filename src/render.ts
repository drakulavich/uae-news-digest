import { REGION_PRESETS } from './region';
import type { DigestItem } from './digest';
import type { TopicSection } from './pipeline';
import type { LocaleContext } from './region';

const DEFAULT_LOCALE_CONTEXT: LocaleContext = {
  flag: '🇦🇪',
  name: 'UAE',
  timezone: 'Asia/Dubai',
};

export function emojiFor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('rain') || t.includes('weather') || t.includes('погода') || t.includes('дожд')) return '🌧️';
  if (t.includes('property') || t.includes('market') || t.includes('недвижимост') || t.includes('рынок')) return '📉';
  if (t.includes('flight') || t.includes('airspace') || t.includes('airport') || t.includes('рейс') || t.includes('аэропорт') || t.includes('воздушн')) return '✈️';
  if (t.includes('missile') || t.includes('drone') || t.includes('defence') || t.includes('defense') || t.includes('air attack') || t.includes('ракет') || t.includes('бпла') || t.includes('пво')) return '🛡️';
  if (t.includes('shipping') || t.includes('hormuz') || t.includes('судоход') || t.includes('ормуз')) return '⛴️';
  if (t.includes('hezbollah') || t.includes('terror') || t.includes('хезболла') || t.includes('террор')) return '🚨';
  if (t.includes('school') || t.includes('education') || t.includes('школ') || t.includes('образован')) return '🎓';
  if (t.includes('oil') || t.includes('gas') || t.includes('нефт') || t.includes('газ')) return '🛢️';
  if (t.includes('visa') || t.includes('виз')) return '🛂';
  return '•';
}

export function renderDigest(items: DigestItem[], translations?: Map<string, string>, now: Date = new Date(), region: string = 'uae'): string {
  const preset = REGION_PRESETS[region.toLowerCase()];
  const flag = preset?.flag ?? '📰';
  const name = preset?.name ?? 'News';

  if (items.length === 0) {
    return `${flag} ${name} Latest News Digest\n\n• No significant news in the check window.`;
  }

  const lines = [`${flag} ${name} Latest News Digest`, ''];
  for (const item of items) {
    const title = translations?.get(item.title) ?? item.title;
    const hoursAgo = Math.round((now.getTime() - item.publishedAt.getTime()) / 3_600_000);
    lines.push(`${emojiFor(item.title)} ${title} (${item.source}, ${hoursAgo}h ago)`);
  }
  return lines.join('\n');
}

export function renderTopicalDigest(
  sections: TopicSection[],
  translations?: Map<string, string>,
  now: Date = new Date(),
  locale: LocaleContext = DEFAULT_LOCALE_CONTEXT,
): string {
  const dateLabel = new Intl.DateTimeFormat('en-CA', {
    timeZone: locale.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const lines: string[] = [`${locale.flag} ${locale.name} digest — ${dateLabel}`, ''];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const prefix = section.topic.emoji ?? '•';
    lines.push(`${prefix} ${section.topic.name}`);

    if (section.items.length === 0) {
      lines.push('  (нет новых материалов)');
    } else {
      for (const item of section.items) {
        const title = translations?.get(item.title) ?? item.title;
        const hoursAgo = Math.round((now.getTime() - item.publishedAt.getTime()) / 3_600_000);
        lines.push(`  ${emojiFor(item.title)} ${title} (${item.source}, ${hoursAgo}h ago)`);
      }
    }

    if (i < sections.length - 1) lines.push('');
  }

  return lines.join('\n');
}
