# Configurable Region

## Problem

The RSS URL is hardcoded for UAE. Users who want news from other countries must manually construct the Google News RSS URL and pass it via `--rss-url`.

## Design

### New `--region` flag

A `--region <code>` CLI flag (default: `uae`) that selects a region preset. The preset determines the Google News RSS query parameters.

```
uae-news-digest                       # UAE news (default)
uae-news-digest --region us           # US news
uae-news-digest --region de           # Germany news
```

### Region presets

A `Record<string, { q: string; hl: string; gl: string; ceid: string }>` in lib.ts:

| Region | q | hl | gl | ceid |
|--------|---|----|----|------|
| `uae` | `UAE OR "Abu Dhabi" OR Dubai` | `en` | `AE` | `AE:en` |
| `us` | `USA OR "United States"` | `en` | `US` | `US:en` |
| `uk` | `UK OR "United Kingdom" OR London` | `en` | `GB` | `GB:en` |
| `de` | `Deutschland OR Berlin OR München` | `de` | `DE` | `DE:de` |
| `ru` | `Россия OR Москва` | `ru` | `RU` | `RU:ru` |

### `buildRssUrl(region: string)` function

Takes a region code, looks up the preset, and returns the full Google News RSS URL. Throws an error for unknown region codes listing available options.

### `--rss-url` overrides `--region`

If `--rss-url` is explicitly passed, it takes precedence. The `--region` flag is ignored when `--rss-url` is set.

Commander default for `--rss-url` is removed (no longer `DEFAULT_RSS_URL`). Instead, the main action resolves the URL as: `options.rssUrl ?? buildRssUrl(options.region)`.

### Scoring stays generic

The existing scoring heuristics (preferred sources like Reuters/AP/BBC, UAE-specific regexes) remain unchanged. They're useful enough for UAE and don't break other regions — non-matching items just score lower. Scoring customization per region is out of scope.

## Files Changed

| File | Action | What |
|------|--------|------|
| `src/lib.ts` | Modify | Add `REGION_PRESETS` map, `buildRssUrl` function, export both. Remove `DEFAULT_RSS_URL` export. |
| `src/core.ts` | Modify | Replace `DEFAULT_RSS_URL` export with `REGION_PRESETS` and `buildRssUrl` |
| `src/index.ts` | Modify | Add `--region <code>` flag (default `uae`), remove `--rss-url` default, resolve URL from region, update manifest and help text |
| `test/lib.test.ts` | Modify | Add tests for `buildRssUrl` — known region, unknown region error |
| `test/cli.test.ts` | Modify | Update integration tests that pass `--rss-url` (no changes needed — they already override) |
| `README.md` | Modify | Add `--region` to flags table and usage examples |
