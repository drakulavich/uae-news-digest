import { REGION_PRESETS } from './region';
import type { DigestItem } from './digest';

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
