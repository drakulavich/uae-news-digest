import { XMLParser } from 'fast-xml-parser';
import { normalizeWhitespace } from './normalize';

export type RssItem = {
  title: string;
  pubDate?: string;
  source?: string;
  link?: string;
};

export function parseRss(xml: string): RssItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(xml) as any;
  const rawItems = parsed?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items.map((item: any) => ({
    title: normalizeWhitespace(String(item.title ?? '')),
    pubDate: item.pubDate ? String(item.pubDate) : undefined,
    source: typeof item.source === 'string'
      ? item.source
      : item.source?.['#text']
        ? String(item.source['#text'])
        : undefined,
    link: item.link ? String(item.link) : undefined,
  }));
}
