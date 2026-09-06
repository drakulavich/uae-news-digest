// src/url.ts
import type { Topic } from '../config/schema';

const GOOGLE_NEWS_RSS_SEARCH = 'https://news.google.com/rss/search';

/** The feed to fetch for a topic: its explicit `feedUrl`, else a Google News search over its query and locale. */
export function buildFeedUrl(topic: Topic): string {
  if (topic.feedUrl) return topic.feedUrl;
  const { hl, gl, ceid } = topic.locale;
  return `${GOOGLE_NEWS_RSS_SEARCH}?q=${encodeURIComponent(topic.query)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&ceid=${encodeURIComponent(ceid)}`;
}
