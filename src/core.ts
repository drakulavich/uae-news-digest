// The public programmatic API: import from '@drakulavich/uae-news-digest/core'.
// Everything not listed here is internal and may change without notice.
export { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from './config/load';
export type { ResolveConfigOptions } from './config/load';
export { parseConfig } from './config/schema';
export type { DigestConfig, Topic } from './config/schema';
export { runDigest } from './pipeline/run';
export type { RunOptions, DigestResult, TopicSection, FetchText, Translate } from './pipeline/run';
export type { DigestItem } from './pipeline/select';
export type { ImportanceTier } from './pipeline/importance';
export { parseRss } from './pipeline/rss';
export type { RssItem } from './pipeline/rss';
export { renderText } from './output/text';
export { toJson } from './output/json';
export type { DigestJson, DigestJsonItem, JsonMeta } from './output/json';
export { DEFAULT_STATE_FILE, readSeenKeys, writeSeenKeys } from './state';
export { DEEPL_API_URL, translateDeepL } from './translate';
