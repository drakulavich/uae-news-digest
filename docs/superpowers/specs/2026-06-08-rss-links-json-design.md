# RSS Links in JSON Output Design

## Context

Issue #43 asks for RSS item URLs to be preserved in `uae-news-digest --json` output so downstream LLM workflows can produce cited and shareable digests without a manual search step. The current pipeline parses RSS items into `title`, `pubDate`, and `source`, then rebuilds digest items without URL fields.

The first implementation should expose the raw Google News RSS item link and reserve an `originalUrl` field, but it should not resolve Google redirects yet.

## Goals

- Preserve the RSS item `<link>` from Google News as `googleUrl`.
- Carry URL metadata from `RssItem` to `DigestItem` through filtering, scoring, deduplication, and limiting.
- Emit URL fields in CLI JSON output when a URL is available.
- Keep text rendering unchanged.
- Add focused tests for RSS parsing, digest carry-through, and JSON output.

## Non-Goals

- Resolve Google News redirect URLs to publisher URLs.
- Add network calls after the RSS fetch.
- Use `<guid>` or `<source url>` as link fallbacks.
- Change digest deduplication keys or state-file behavior.
- Add links to text rendering.

## Data Model

`RssItem` will include optional URL metadata:

```ts
googleUrl?: string;
originalUrl?: string | null;
```

`parseRss()` will read the RSS item `<link>` element into `googleUrl` when present. When a `googleUrl` exists, it will set `originalUrl` to `null` to make the future publisher URL field explicit. When no RSS item link exists, both fields may be omitted.

`DigestItem` will include the same fields:

```ts
googleUrl?: string;
originalUrl?: string | null;
```

`buildDigest()` will copy these fields from the selected `RssItem` into the constructed `DigestItem`. Existing exact and fuzzy deduplication behavior remains based on normalized title and source. If deduplication chooses a replacement item, that replacement item's URL metadata wins along with its title, source, score, and publication date.

## JSON Output

`uae-news-digest --json` will include URL fields on each item when a Google RSS link is available:

```json
{
  "title": "Dubai airport reopens after rain",
  "source": "Reuters",
  "score": 8,
  "publishedAt": "2026-03-22T07:00:00.000Z",
  "hoursAgo": 1,
  "googleUrl": "https://news.google.com/rss/articles/example",
  "originalUrl": null
}
```

If an item has no `googleUrl`, JSON output omits both `googleUrl` and `originalUrl`. This keeps the field tied to URL availability while reserving the `originalUrl` shape for future redirect resolution.

Text rendering remains unchanged and continues to display title, source, and relative age only.

## Testing

Tests should cover:

- `parseRss()` extracts item `<link>` into `googleUrl` and sets `originalUrl` to `null`.
- Existing RSS parsing behavior for source text, malformed XML, empty feeds, and single items still passes.
- `buildDigest()` preserves `googleUrl` and `originalUrl` for selected items.
- CLI `--json` includes `googleUrl` and `originalUrl` for linked RSS items.
- Existing text-rendering tests continue to pass, confirming no text output change.

## Implementation Notes

The expected implementation is narrow:

- Update `src/rss.ts` types and parser mapping.
- Update `src/digest.ts` `DigestItem` construction.
- Update the JSON item mapper in `src/index.ts`.
- Adjust fixtures and tests that assert exact object shapes.

No public function signatures need to change beyond the exported TypeScript types gaining optional fields.
