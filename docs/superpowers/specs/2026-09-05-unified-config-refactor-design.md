# Unified Config Refactor (v1.0.0)

## Problem

The codebase has grown two parallel implementations of the same idea.

- **Two pipelines.** Region mode (`runDigest`) and topics mode (`runTopicalDigest`) each
  fetch, select, translate, and render. `renderDigest` / `renderTopicalDigest`, two JSON
  serializers, two state-write blocks, and two translation blocks are near-duplicates.
  Region mode is a topics config with one topic.
- **The CLI does everything.** `src/index.ts` (458 lines) parses flags, performs network
  calls, branches on mode, serializes JSON, classifies errors by substring matching on
  `error.message`, and writes state. The topics fetcher lives in the CLI and carries a
  fixture-file env-var hack.
- **UAE knowledge is hard-coded into generic modules** although the tool advertises
  `--region us|uk|de`: `UAE_RE` / `PRIORITY_RE` in scoring, Iran/Hormuz synonyms in the
  fuzzy deduper, `DEFAULT_SKIP_RE` in digest, importance markers, the emoji table in
  render, Russian strings in the topical renderer.
- **Two near-identical barrels** (`lib.ts`, `core.ts`), a misplaced `escapeRegExp`,
  three representations of one concept (`RegionPreset`, `RssLocale`, `LocaleContext`),
  `translateDeepL` swallowing errors into `null`.

## Decisions taken during brainstorming

| Question | Decision |
|---|---|
| Driver | All of: unify pipelines, make heuristics regional, clean up the CLI. Staged PRs. |
| Compatibility | None required. `/core` API and CLI output may change. Release as **1.0.0**. |
| Region mode | Removed. The config file is the single source of truth; without one the CLI uses a built-in UAE config. |
| Heuristics | Move entirely into the config. Absent section = neutral behaviour. |
| Validation | `zod` schema; the TypeScript type is inferred from it. |
| Sequencing | Strangler in place: four PRs, each keeps tests green. |

## Non-goals

- Localizing the text renderer. Renderer strings are English only.
- New heuristics or new scoring behaviour. The built-in UAE config reproduces today's lists and weights.
- Windows support, alternative feeds, or any change to the RSS source (Google News only).
- Regex support in the config. Lists are plain strings; the code builds patterns.

## Design

### 1. Config schema

One JSON document describes topics, locale, display, and all heuristics. Only `locale` and
`topics` are required; every heuristic section is optional and its absence means "off"
(no boost, no Important block, `•` as the emoji marker, no skip list).

```jsonc
{
  "locale": { "hl": "en", "gl": "AE", "ceid": "AE:en" },
  "display": { "flag": "🇦🇪", "name": "UAE", "timezone": "Asia/Dubai" },
  "topics": [
    { "slug": "security", "name": "UAE Security", "emoji": "🛡️",
      "query": "UAE OR \"Abu Dhabi\" OR Dubai", "limit": 5,
      "match": ["missile"], "matchMode": "any",
      "locale": { "hl": "en", "gl": "AE", "ceid": "AE:en" } }
  ],
  "skip": ["opinion", "daily mail", "tradingview", "horse", "football"],
  "scoring": {
    "sourceTiers": [
      { "weight": 5, "sources": ["reuters", "bbc", "bloomberg"] },
      { "weight": 3, "sources": ["al jazeera", "cnn"] },
      { "weight": 2, "sources": ["gulf news", "khaleej times", "the national"] }
    ],
    "titleBoosts": [
      { "weight": 2, "terms": ["UAE", "Dubai", "Abu Dhabi", "Sharjah"] },
      { "weight": 2, "terms": ["weather", "missile", "airspace", "property"] }
    ]
  },
  "dedupe": {
    "similarityThreshold": 0.45,
    "synonyms": { "drones": "uav", "intercepted": "engage" },
    "stopWords": ["the", "a", "in", "says", "said"]
  },
  "importance": {
    "threshold": 2,
    "breaking": { "weight": 4, "markers": ["breaking", "evacuat*", "missile"] },
    "impact":   { "weight": 2, "markers": ["rent", "visa", "school"] },
    "fluff":    { "penalty": 3, "markers": ["unveils", "award", "inaugurat*"] }
  },
  "emoji": [
    { "emoji": "🌧️", "terms": ["rain", "weather"] },
    { "emoji": "✈️", "terms": ["flight", "airport"] }
  ],
  "agentPrompt": "You are a news filter for an expat family in the UAE. ..."
}
```

Rules:

- **Field semantics.**
  - `display` defaults to `{ flag: "🌐", name: "News", timezone: "UTC" }`.
  - `topics[].limit` defaults to 5. `topics[].locale` defaults to the top-level `locale`.
  - `topics[].matchMode` is `"all" | "any" | positive integer`, defaults to `"all"`, and is
    rejected when `match` is absent. Slugs must be unique.
  - `skip` entries are matched case-insensitively against title and source as substrings
    (today's behaviour).
  - `scoring.sourceTiers` are evaluated in order; the first tier whose list matches the
    source wins. `scoring.titleBoosts` are additive; each boost applies once if any of
    its terms matches the title.
  - `dedupe.similarityThreshold` defaults to 0.45. `synonyms` and `stopWords` default to
    empty. Word extraction stays ASCII-lowercase as today.
  - `importance.*.markers` match as whole words with optional `s`/`es` plural. A trailing
    `*` means prefix (stem) match. This replaces the separate `STEM_MARKERS` set.
    `importance.threshold` defaults to 2.
  - `emoji` rules are evaluated in order; the first rule whose term appears in the title
    wins; otherwise `•`.
- **No regexes in the config.** The code escapes every string and adds word boundaries.
- **Built-in default** lives at `src/config/default.json`, reproduces today's UAE lists and
  weights, and is validated by the same schema. A test asserts it parses.
- **Discovery order** is unchanged; the flag is renamed: `--config <path>`, then
  `./digest.config.json`, then `$XDG_CONFIG_HOME/uae-news-digest/topics.json` (or
  `~/.config/...`). `--no-topics` and `--topics-config` are removed.
- **Not in the config**: `--hours`, `--limit`, `--timeout-ms`, `--target-lang`,
  `--state-file`, `--dry-run`, `--json`. These are run parameters, not source description.
- Renderer strings `(нет новых материалов)` and `(всё в 🚨 Important)` become
  `(no new items)` and `(all items are in 🚨 Important)`.

`zod` infers `DigestConfig`, the only configuration type in the project. `RegionPreset`,
`TopicsConfig`, `RssLocale`, and `LocaleContext` are deleted.

### 2. Pipeline and programmatic API

```ts
// Config
loadConfig(path: string): Promise<DigestConfig>
resolveConfigPath({ explicit?, cwd, env }): Promise<string | null>
DEFAULT_CONFIG: DigestConfig

// Pipeline
runDigest(options: RunOptions): Promise<DigestResult>
type RunOptions = {
  config: DigestConfig;
  seenKeys: Set<string>;
  hours: number;
  limitOverride?: number;                            // CLI --limit applies to every topic
  now: Date;
  fetchText: (url: string) => Promise<string>;      // injected network
  translate?: (texts: string[], lang: string) => Promise<string[]>;
  targetLang?: string;
};
type DigestResult = {
  sections: { topic: Topic; items: DigestItem[] }[];
  warnings: string[];
  nextSeenKeys: Set<string>;
  fetchedTopics: number;                            // 0 = nothing was fetched
};
type DigestItem = {
  key: string; title: string; translatedTitle?: string; source: string; url?: string;
  publishedAt: Date; score: number; importance: number; tier: ImportanceTier;
  signals: string[]; matchedTerms: string[];
};

// Output
renderText(result: DigestResult, config: DigestConfig, now: Date): string
toJson(result: DigestResult, config: DigestConfig,
       query: { hours: number; limit?: number; targetLang?: string; now: Date }): DigestJson
```

- **Network and DeepL are injected.** The pipeline knows nothing about `fetch`, timeouts,
  user-agent, or env vars. The CLI builds `fetchText` from `fetch` + `AbortSignal.timeout`
  and `translate` from `translateDeepL` + the auth key. Pipeline tests pass stubs.
  The `UAE_NEWS_DIGEST_TOPIC_FIXTURE` env var is removed; CLI tests point a topic's URL at
  a local `Bun.serve` via a temp config, as `cli.test.ts` does today.
- **Steps take config slices.** `scoreItem(title, source, config.scoring)`,
  `titleSimilarity(a, b, config.dedupe)`, `scoreImportance(title, config.importance)`,
  `emojiFor(title, config.emoji)`, `selectItems(rssItems, topic, ctx)` replaces
  `buildDigestWithStats`. Module-level UAE constants disappear.
- **Translation lands on the item** as `translatedTitle` instead of a `Map` threaded
  through renderers. `translateDeepL` throws a descriptive error (HTTP status, timeout,
  count mismatch) instead of returning `null`; `runDigest` catches it and emits one
  warning, leaving titles untouched.
- **URL building** for a topic (`https://news.google.com/rss/search?q=…&hl=…&gl=…&ceid=…`)
  is an internal helper in the pipeline; it is no longer exported.
- **One text format**, today's topical layout: `{flag} {name} digest — {YYYY-MM-DD}` in the
  display timezone, the `🚨 Important` block with `[signals]` and `— Topic` suffix, then
  one section per topic in config order. A single-topic config still prints its heading.
- **One JSON format**; `mode` is dropped, `googleUrl` becomes `url`, `translatedTitle` and
  `generatedAt` are added:

```jsonc
{
  "tool": "uae-news-digest", "version": "1.0.0",
  "generatedAt": "2026-09-05T08:00:00.000Z",
  "query": { "hours": 36, "limit": null, "targetLang": null },
  "topics": [{ "slug": "security", "name": "UAE Security", "count": 3 }],
  "count": 3, "warnings": [],
  "items": [{
    "topic": "security", "title": "...", "translatedTitle": null,
    "source": "Reuters", "url": "https://news.google.com/...",
    "publishedAt": "2026-09-05T06:00:00.000Z", "hoursAgo": 2,
    "score": 7, "importance": 4, "tier": "breaking",
    "signals": ["missile"], "matchedTerms": []
  }]
}
```

- **Partial failures are warnings.** A topic whose fetch or parse fails yields an empty
  section and a warning. If `fetchedTopics === 0` the CLI exits 1 after printing the
  warnings to stderr; otherwise exit 0.
- **Cross-topic dedupe** stays sequential: the earlier topic in config order claims an item.
- **State write rule** is unchanged: write only when at least one item was produced and
  `--dry-run` is absent.

Removed from `/core`: `buildDigest`, `buildDigestWithStats`, `runTopicalDigest`,
`renderDigest`, `renderTopicalDigest`, `mergeSeenKeys`, `buildRssUrl`, `REGION_PRESETS`,
`localeContextFor`, `parsePubDate`, `matchTerms`, `loadTopicsConfig`,
`resolveTopicsConfigPath`, `IMPORTANCE_THRESHOLD`, `FILTER_PROMPT`, `emojiFor`,
`scoreItem`, `titleSimilarity`, `scoreImportance`, `normalize*`, `makeKey`.

Public `/core` after the refactor: `loadConfig`, `resolveConfigPath`, `DEFAULT_CONFIG`,
`runDigest`, `renderText`, `toJson`, `parseRss`, `readSeenKeys`, `writeSeenKeys`,
`DEFAULT_STATE_FILE`, `translateDeepL`, `DEEPL_API_URL`, and the types `DigestConfig`,
`Topic`, `RunOptions`, `DigestResult`, `DigestItem`, `DigestJson`, `ImportanceTier`,
`RssItem`.

### 3. CLI and errors

Default command flags: `--config`, `--hours`, `--limit`, `--timeout-ms`, `--target-lang`,
`--state-file`, `--dry-run`, `--json`, `--prompt`.
Removed: `--region`, `--rss-url`, `--match`, `--match-mode`, `--no-topics`, `--topics-config`.

Subcommands:

- `manifest` — unchanged purpose; the flag list is derived from the Commander `program`
  object rather than duplicated by hand.
- `healthcheck [--rss-url <url>]` — smoke-tests the URL of the first topic of the resolved
  config (built-in UAE config when none is found). `--rss-url` remains for deterministic
  smoke tests.
- `config print-default` — prints the built-in config to stdout so users can copy and edit it.
- `config validate [path]` — runs the file (or the discovered config) through the schema;
  prints `ok` and exits 0, or prints every issue with its JSON path and exits 1.
- `--prompt` prints `config.agentPrompt`. If the section is absent: exit 1 with a message
  naming the missing key.

Errors:

- `CliError` with `kind: 'usage' | 'config' | 'network' | 'timeout'` and a human-readable
  message that says what failed, why, and what to do.
- The `fetchText` adapter classifies at the source: `TimeoutError`/`AbortError` →
  `timeout` ("retry or pass --timeout-ms 30000"), `ECONNREFUSED`/`ENOTFOUND`/`fetch failed`
  → `network`, non-2xx → `network` with the status. No substring matching on
  `error.message` at the top level.
- `zod` issues are wrapped into `CliError('config', …)` with the config path and JSON path
  of each issue.
- `index.ts` calls `main(argv): Promise<number>`; one `try/catch` prints the message and
  calls `process.exit`. Scattered `process.exit(1)` calls inside actions and the
  `uncaughtException` handler are removed.
- `mkdir -p` for the state directory moves from the CLI into `writeSeenKeys`.
- `meta.ts` imports `package.json` directly instead of reading it with top-level `await`.

Exit codes: 0 success; 1 for usage, config, network, timeout, or "no topic fetched".

### 4. File layout and tests

```
src/
  index.ts              # bin: calls cli/main, maps the return value to process.exit
  cli/
    program.ts          # Commander definition
    run.ts              # default command action
    commands.ts         # manifest, healthcheck, config print-default / validate
    adapters.ts         # fetchText with timeout + user-agent, translate with auth key
    errors.ts           # CliError and network-error classification
  config/
    schema.ts           # zod schema, DigestConfig / Topic types
    load.ts             # loadConfig, resolveConfigPath
    default.json        # built-in UAE config
  pipeline/
    run.ts              # runDigest
    select.ts           # window, skip, match, dedupe, limit for one topic
    scoring.ts  importance.ts  similarity.ts  normalize.ts  rss.ts  url.ts
  output/
    text.ts  json.ts  emoji.ts
  translate.ts  state.ts  meta.ts
  core.ts               # the only public barrel
```

`lib.ts` is deleted; internal code imports concrete modules.

Tests:

- Unit tests for pipeline modules pass config slices explicitly and no longer rely on UAE
  constants.
- `test/integration/pipeline.test.ts` drives `runDigest` with a stub `fetchText` and stub
  `translate`; no HTTP server.
- `test/cli.test.ts` stays end-to-end via `Bun.spawn` + local `Bun.serve`; the topic URL is
  supplied through a temp config file, not env vars.
- New tests: the default config passes the schema; `config validate` reports a broken file
  with a JSON path; `manifest` lists exactly the flags defined on `program`; `--prompt`
  fails cleanly without `agentPrompt`; exit 1 when every topic fails, exit 0 when one
  succeeds.
- The text golden fixture is regenerated once and reviewed by eye in the PR.
- `test/fetch-guard.ts` stays as is.

## Staging (four PRs)

1. **Config schema + heuristics in config.** Add `zod`, `src/config/schema.ts`,
   `default.json`. Pipeline modules take config slices. Existing topics config keeps
   loading (new sections optional). Region mode still works, reading heuristics from
   `DEFAULT_CONFIG`. Tests: default config validates; unit tests take slices.
2. **Unified pipeline.** `runDigest(config)` over N topics; delete `runTopicalDigest`,
   `renderDigest`, `renderTopicalDigest`, `buildDigestWithStats`, duplicate JSON code.
   Region flags removed; no config → `DEFAULT_CONFIG`. New JSON and text formats. Golden
   fixture regenerated.
3. **CLI slimming.** `src/cli/*`, `CliError`, adapters, `config` subcommands, `manifest`
   derived from `program`, `healthcheck` from config, `--prompt` from config, `mkdir` into
   `writeSeenKeys`, `meta.ts` JSON import.
4. **Public surface and docs.** Final `core.ts`, delete `lib.ts`, folder layout, README,
   CHANGELOG (Breaking section), `openspec/config.yaml`, CLAUDE.md, `package.json` exports,
   version 1.0.0.

Each PR: `bun test` and `bun run typecheck` green; `bun run smoke:pack` in PR 4.

## Open questions

None at the time of writing. Anything discovered during planning goes here or into the
implementation plan.
