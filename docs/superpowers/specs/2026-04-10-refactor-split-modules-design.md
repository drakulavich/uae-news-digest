# Refactor: Split lib.ts into Focused Modules

## Problem

`src/lib.ts` is a 367-line file containing 7 unrelated concerns: region presets, RSS parsing, normalization, scoring, dedup, translation, rendering, and state I/O. Every feature touches this one file. The emoji header is hardcoded to "🇦🇪 UAE" despite supporting 5 regions. The `fetchFn` dependency injection parameter exists only for testing and is superseded by the `DEEPL_API_URL` env var approach used in integration tests.

## Design

### Module split

| File | Responsibility | Exports |
|------|---------------|---------|
| `src/region.ts` | Region presets with display metadata | `REGION_PRESETS`, `buildRssUrl`, `RegionPreset` type |
| `src/rss.ts` | RSS XML parsing | `parseRss`, `RssItem` type |
| `src/normalize.ts` | Title/source normalization, key generation | `normalizeTitle`, `normalizeSource`, `normalizeWhitespace`, `makeKey` |
| `src/scoring.ts` | Item scoring, title similarity, synonyms | `scoreItem`, `titleSimilarity` |
| `src/digest.ts` | Digest builder with filtering and dedup | `buildDigest`, `BuildDigestOptions`, `DigestItem` type |
| `src/render.ts` | Digest rendering with region-aware header, emoji | `renderDigest`, `emojiFor` |
| `src/translate.ts` | DeepL translation | `translateDeepL`, `DEEPL_API_URL`, `DeepLTranslation`, `DeepLResponse` types |
| `src/state.ts` | Seen-keys file I/O | `readSeenKeys`, `writeSeenKeys`, `DEFAULT_STATE_FILE` |
| `src/pipeline.ts` | Orchestrator: parse → filter → translate → render | `runDigest`, `mergeSeenKeys`, `RunDigestOptions` type |
| `src/lib.ts` | Barrel re-export — preserves existing import paths | Re-exports everything from above modules |
| `src/core.ts` | Public API re-exports | Same as lib.ts barrel but curated for external consumers |

### Region-aware rendering

Extend `REGION_PRESETS` entries with display metadata:

```typescript
export type RegionPreset = {
  q: string;
  hl: string;
  gl: string;
  ceid: string;
  flag: string;
  name: string;
};

export const REGION_PRESETS: Record<string, RegionPreset> = {
  uae: { q: 'UAE OR "Abu Dhabi" OR Dubai', hl: 'en', gl: 'AE', ceid: 'AE:en', flag: '🇦🇪', name: 'UAE' },
  us:  { q: 'USA OR "United States"', hl: 'en', gl: 'US', ceid: 'US:en', flag: '🇺🇸', name: 'US' },
  uk:  { q: 'UK OR "United Kingdom" OR London', hl: 'en', gl: 'GB', ceid: 'GB:en', flag: '🇬🇧', name: 'UK' },
  de:  { q: 'Deutschland OR Berlin OR München', hl: 'de', gl: 'DE', ceid: 'DE:de', flag: '🇩🇪', name: 'Germany' },
  ru:  { q: 'Россия OR Москва', hl: 'ru', gl: 'RU', ceid: 'RU:ru', flag: '🇷🇺', name: 'Russia' },
};
```

`renderDigest` takes a `region` string parameter, looks up `flag` and `name` from `REGION_PRESETS`, and renders a region-aware header:

```
🇺🇸 US Latest News Digest
```

Falls back to a generic header if region is not found (e.g. when `--rss-url` is used without `--region`).

### Remove `fetchFn` parameter

Remove `fetchFn` from `translateDeepL` signature and `RunDigestOptions` type. The `DEEPL_API_URL` env var override is sufficient for testing. Update unit tests to use a local test server (same pattern as `test/cli.test.ts`) or mock `globalThis.fetch`.

### Move `validatePositiveNumber` to index.ts

It's CLI validation, not library logic. Move it from lib.ts into index.ts where it's used. Remove from lib.ts, core.ts exports.

### Pipeline changes

`RunDigestOptions` gains a `region?: string` field. `runDigest` passes it to `renderDigest` for the header. When not provided, defaults to `'uae'` for backward compatibility.

### Test changes

- `test/lib.test.ts` — imports stay the same (barrel re-export). Update `renderDigest` tests to pass `region` parameter. Update `translateDeepL` tests to use `DEEPL_API_URL` env var override instead of `fetchFn`. Remove `validatePositiveNumber` from imports.
- `test/cli.test.ts` — no changes needed (already uses test server).

## Files Changed

| File | Action |
|------|--------|
| `src/region.ts` | Create |
| `src/rss.ts` | Create |
| `src/normalize.ts` | Create |
| `src/scoring.ts` | Create |
| `src/digest.ts` | Create |
| `src/render.ts` | Create |
| `src/translate.ts` | Create |
| `src/state.ts` | Create |
| `src/pipeline.ts` | Create |
| `src/lib.ts` | Rewrite as barrel |
| `src/core.ts` | Update exports |
| `src/index.ts` | Inline `validatePositiveNumber`, pass `region` to `runDigest` |
| `test/lib.test.ts` | Update for region-aware rendering, remove `fetchFn` usage |
| `test/cli.test.ts` | No changes |
