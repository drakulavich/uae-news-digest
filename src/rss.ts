import { XMLParser } from 'fast-xml-parser';
import { normalizeWhitespace } from './normalize';

export type RssItem = {
  title: string;
  pubDate?: string;
  source?: string;
  googleUrl?: string;
  originalUrl?: string | null;
};

export function parseRss(xml: string): RssItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(xml) as any;
  const rawItems = parsed?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items.map((item: any) => {
    const googleUrl = item.link ? String(item.link) : undefined;

    return {
      title: normalizeWhitespace(String(item.title ?? '')),
      ...(googleUrl ? { googleUrl, originalUrl: null } : {}),
      pubDate: item.pubDate ? String(item.pubDate) : undefined,
      source: typeof item.source === 'string'
        ? item.source
        : item.source?.['#text']
          ? String(item.source['#text'])
          : undefined,
    };
  });
}
