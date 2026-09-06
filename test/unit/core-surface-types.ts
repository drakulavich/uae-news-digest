// Type-level pin of the /core surface: `bun run typecheck` fails if one of these public types disappears.
// Not a test file on purpose (no `.test.` suffix); tsconfig includes `test/`, so tsc checks it.
import type {
  DigestConfig, Topic, ResolveConfigOptions,
  RunOptions, DigestResult, TopicSection, FetchText, Translate, DigestItem,
  DigestJson, DigestJsonItem, JsonMeta, ImportanceTier, RssItem,
} from '../../src/core';

export type PublicTypes = [
  DigestConfig, Topic, ResolveConfigOptions,
  RunOptions, DigestResult, TopicSection, FetchText, Translate, DigestItem,
  DigestJson, DigestJsonItem, JsonMeta, ImportanceTier, RssItem,
];
