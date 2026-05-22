// Barrel re-export — preserves existing import paths
export { REGION_PRESETS, buildRssUrl } from './region';
export type { RegionPreset } from './region';
export { normalizeWhitespace, normalizeTitle, normalizeSource, makeKey } from './normalize';
export { parseRss } from './rss';
export type { RssItem } from './rss';
export { scoreItem, titleSimilarity } from './scoring';
export { buildDigest, parsePubDate } from './digest';
export type { DigestItem, BuildDigestOptions } from './digest';
export { emojiFor, renderDigest } from './render';
export { translateDeepL, DEEPL_API_URL } from './translate';
export type { DeepLTranslation, DeepLResponse } from './translate';
export { readSeenKeys, writeSeenKeys, DEFAULT_STATE_FILE } from './state';
export { runDigest, mergeSeenKeys } from './pipeline';
export type { RunDigestOptions, RunDigestResult } from './pipeline';
