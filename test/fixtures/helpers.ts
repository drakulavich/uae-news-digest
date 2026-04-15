import type { RssItem } from '../../src/rss';

/** Build an RssItem with sensible defaults; override any field. */
export function makeItem(overrides: Partial<RssItem> = {}): RssItem {
  return {
    title: 'Default title',
    pubDate: new Date('2026-04-15T10:00:00Z').toUTCString(),
    source: 'Reuters',
    ...overrides,
  };
}

/** Return a fixed Date for use as `now` in tests — keeps time-dependent logic deterministic. */
export function freezeNow(iso: string): Date {
  return new Date(iso);
}
