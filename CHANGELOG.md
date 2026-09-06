# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-06

**Breaking release.** One config file (`digest.config.json`, built-in UAE default) drives topics and every heuristic; region mode and its flags are gone; there is one text and one JSON output format; the `/core` API is reduced to a documented set. Migration: run `uae-news-digest config print-default > digest.config.json`, edit, `uae-news-digest config validate`; replace `--region`/`--rss-url`/`--match*`/`--topics-config` with `--config`; in code, replace `buildDigest*`/`runTopicalDigest`/`renderDigest*` with `runDigest` + `renderText`/`toJson`.

### Added
- Config schema (validated with `zod`) now carries every heuristic: `skip`, `scoring` (source tiers, title boosts), `dedupe` (similarity threshold, synonyms, stop words), `importance` (markers, weights, threshold), `emoji` rules, `display`, and `agentPrompt`. A built-in UAE config (`src/config/default.json`) reproduces the previous hard-coded behaviour.
- Programmatic API: `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `DigestConfigSchema`, and the `DigestConfig` / `Topic` / `Heuristics` types.
- `topics[].feedUrl`: fetch an explicit RSS URL instead of a Google News search (used by tests and the packed-package smoke; replaces the main command's `--rss-url`; `healthcheck --rss-url` stays).
- `config print-default` prints the built-in config as JSON; `config validate [path]` runs a file (or the auto-detected config) through the schema and prints `ok` or every issue with its JSON path (exit 1).
- `manifest` now lists the subcommands and derives the default command's flags from the CLI definition instead of a hand-kept list.

### Changed
- `healthcheck` without `--rss-url` probes the first topic of the resolved config (`--config`, `./digest.config.json`, XDG, or the built-in default), not only the built-in one.
- `--prompt` prints `agentPrompt` from the resolved config; a config without one exits 1 naming the missing key.
- `--limit` must be a positive integer (`--limit 2.5` is a usage error).
- The state file's directory is created on write (`writeSeenKeys`), so the CLI no longer shells out to `mkdir`.
- CLI internals moved to `src/cli/*` (`program.ts`, `run.ts`, `commands.ts`, `adapters.ts`, `errors.ts`); `src/index.ts` is a three-line bin calling `main(argv)`. Failures are typed `CliError`s (`usage` / `config` / `network` / `timeout`) classified where they occur; every command returns its exit code through one path — no `process.exit` inside commands.
- **Breaking (config):** `locale` is required in a topics config; unknown keys are rejected.
- **Breaking (behaviour):** a topics config without heuristic sections now runs with neutral heuristics (no source/keyword boosts, no 🚨 Important block, `•` emoji, no skip list). Copy the sections you want from `src/config/default.json`.
- **Breaking (API):** `loadTopicsConfig` → `loadConfig`, `resolveTopicsConfigPath` → `resolveConfigPath`, `TopicConfig` → `Topic`, `TopicsConfig` → `DigestConfig`; `scoreItem`, `titleSimilarity`, `scoreImportance`, `emojiFor`, `buildDigest*` take a config slice, and `runTopicalDigest` reads heuristics from its `config`. Removed: `IMPORTANCE_THRESHOLD`, `FILTER_PROMPT`, `BREAKING_MARKERS`, `IMPACT_MARKERS`, `FLUFF_MARKERS`, `TIER_*_RE`. `escapeRegExp` moved from `importance` to `terms` (still re-exported from `lib`).
- Term lists match whole words (with `s`/`es` plural) and support a trailing `*` for stem matching; previously scoring, emoji and skip matched raw substrings (e.g. "rain" fired on "Ukraine").
- `dedupe.synonyms` keys/values and `dedupe.stopWords` are lower-cased at load and must be single ASCII words (letters and digits), since they are compared against normalised title tokens; anything else is rejected with the offending path.
- Per-topic `match` terms go through the same matcher as the other config lists, so a trailing `*` is a stem wildcard rather than a literal.
- **Breaking (CLI):** region mode is gone. `--region`, `--rss-url` (main command), `--match`, `--match-mode`, `--no-topics`, and `--topics-config` are removed; `--config <path>` names the config file. Without a config the built-in UAE config runs (one topic). `--limit` has no default and, when given, caps every topic. `healthcheck --rss-url` stays.
- **Breaking (output):** one text format for every run — `{flag} {name} digest — {date}`, optional `🚨 Important` block, one section per topic (a single-topic config still prints its heading); `(no new items)` / `(all items are in 🚨 Important)` replace the Russian placeholders. One JSON format: `mode` removed, `googleUrl` → `url`, new `generatedAt` and `translatedTitle`, `query.limit` is `null` unless `--limit` was passed, `topics` always present.
- **Breaking (API):** `runDigest(options)` now takes `{ config, seenKeys, hours, limitOverride?, now, fetchText, translate?, targetLang? }` and returns `{ sections, warnings, nextSeenKeys, fetchedTopics }`; rendering is `renderText(result, config, now)` and `toJson(result, meta)`. Removed: `runTopicalDigest`, `renderDigest`, `renderTopicalDigest`, `mergeSeenKeys`, `buildRssUrl`, `REGION_PRESETS`, `localeContextFor`, and the `RegionPreset`/`RssLocale`/`LocaleContext` types. `translateDeepL` throws on failure instead of returning `null`. `DigestItem.link` → `url`; `matchedTerms` is always an array; `translatedTitle` added.
- Partial failures stay warnings; the CLI exits 1 only when no topic could be fetched. The "feed returned no items — check the query" warning fires only when the feed itself was empty, not when every item was already seen. A response that is not an RSS document (an HTML error page, an Atom feed) is a failed topic (`could not parse RSS`), not an empty feed — so an outage across every topic exits 1.
- `display` from the config now drives the text header (flag, name, timezone).
- **Breaking (API):** `@drakulavich/uae-news-digest/core` now exports exactly `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `runDigest`, `renderText`, `toJson`, `parseRss`, `readSeenKeys`, `writeSeenKeys`, `DEFAULT_STATE_FILE`, `translateDeepL`, `DEEPL_API_URL` and the types `DigestConfig`, `Topic`, `ResolveConfigOptions`, `RunOptions`, `DigestResult`, `TopicSection`, `FetchText`, `Translate`, `DigestItem`, `DigestJson`, `DigestJsonItem`, `JsonMeta`, `ImportanceTier`, `RssItem`. Removed from the public surface: `buildDigest`, `buildDigestWithStats`, `matchTerms`, `parsePubDate`, `buildFeedUrl`, `emojiFor`, `hoursAgo`, `scoreItem`, `titleSimilarity`, `scoreImportance`, `importanceThreshold`, `normalizeTitle`, `normalizeSource`, `makeKey`, `DigestConfigSchema`, the `Heuristics`/`DeepLTranslation`/`DeepLResponse` types. `src/lib.ts` is deleted.
- Source layout: pipeline modules live under `src/pipeline/` (`run`, `select`, `scoring`, `similarity`, `importance`, `normalize`, `rss`, `url`, `terms`), renderers under `src/output/` (`text`, `json`, `emoji`, `time`); `buildDigestWithStats` is now the internal `selectItems(rssItems, topic, ctx)`.
- `healthcheck` honours `--timeout-ms` (default 15000) and reports failures with the same messages as the digest run.
- CI runs on every pull request, not only those targeting `main`.

### Fixed
- Two different non-Latin titles (for example under the ASCII word extraction, which reduces them to no words) no longer collapse into one item, while a verbatim repeat of the same wordless title still dedupes.
- `translateDeepL` reports a non-JSON 200 body as `DeepL returned a non-JSON response` instead of a raw parse error.
- Fetch failures whose rejection value is `null`/`undefined` are classified as network errors instead of crashing the classifier.

### Chores
- `bunfig.toml` preloads the test fetch guard so plain `bun test` is safe.

## [0.2.0] - 2026-07-22

### Added
- Signal filter: `--json` items now carry `importance`, `tier` (`breaking` | `impact` | `neutral` | `fluff`), and `signals`, so downstream consumers can rank and drop noise without re-deriving scores.
- `--prompt` flag prints a ready-made agent filter instruction. Piping `uae-news-digest --json` into an LLM with that prompt drops PR/noise reproducibly from the metadata — no API key or custom prompt engineering.
- `googleUrl` field on every `--json` item — the Google News article link, so consumers can deep-link to the original story.

### Changed
- `--help` is now self-sufficient for agents: a full usage guide covering region vs topics mode detection, the complete `--json` envelope and item schema, state/dedup rules, the agent-filter workflow, env vars, subcommands (`manifest` / `healthcheck`), and exit codes. The documented agent-filter pipe now includes `--dry-run` so ad-hoc filter passes don't mark articles as seen.

### Chores
- OpenSpec baseline (config + principles + glossary).
- Dependency and CI action bumps: `commander`, `fast-xml-parser`, `actions/checkout`, `actions/setup-node`.

## [0.1.1] - 2026-05-23

### Added
- `--version` / `-V` flag prints the installed version and exits.

### Changed
- Tier-1 source bonus bumped from +4 to +5 in `scoreItem`, so Reuters/BBC/AP/NYT/Bloomberg/FT/WSJ/Guardian/Economist/Washington Post outrank tier-3 stories even when the latter pile UAE + priority bonuses on top.
- `manifest` subcommand now reports the full current flag surface, including `--topics-config`, `--no-topics`, and `--timeout-ms`.

## [0.1.0] - 2026-05-22

### Added
- Topics mode: a JSON config file (`digest.config.json` in cwd, or `$XDG_CONFIG_HOME/uae-news-digest/topics.json`) drives a per-topic digest, fetched in parallel and rendered as labelled sections in one run.
- `--topics-config <path>` flag explicitly selects a config file.
- `--no-topics` flag forces the legacy region mode even when a topics config is present.
- `mode` field in JSON output (`"topics"` or `"region"`) plus a `topics` array and per-item `topic` slug when in topics mode.
- `buildRssUrl` accepts an object form (`{q, hl, gl, ceid}`) for ad-hoc locales used by topics.
- `localeContextFor(gl)` derives flag, name, and IANA timezone from a country code; `renderTopicalDigest` uses it for DST-safe per-locale date labels.
- New public API exports: `loadTopicsConfig`, `resolveTopicsConfigPath`, `runTopicalDigest`, `renderTopicalDigest`, plus types `TopicConfig`, `TopicsConfig`, `TopicSection`, `LocaleContext`, `RssLocale`.

### Changed
- Cross-topic dedup is "first topic in config wins" — reorder the config to set priority.
- DeepL translation in topics mode batches every title across every section into a single request and de-duplicates identical titles before sending.

### Removed
- `ru` region preset (and its `Europe/Moscow` timezone entry) is no longer bundled. `RU` remains valid as a DeepL `--target-lang` value.

## [0.0.4] - 2026-05-22

### Added
- Release workflow for tagged GitHub and npm publishes.
- Codex and agent repository guidance.
- Deterministic healthcheck RSS URL support for smoke tests.
- Expanded packed package smoke coverage for the binary and public core export.
- Hermetic test network guard and richer CLI request diagnostics.
- CLI text golden fixture for the default digest contract.

### Changed
- CI and release tests now use the guarded test script.

## [0.0.3] - 2026-05-22

### Added
- CI now type-checks, tests, and package-smoke-tests on Linux and macOS.
- Package metadata is read from `package.json` for the CLI manifest.
- Packed package smoke coverage verifies the binary and public core export.

### Fixed
- Seen-item state writes are atomic.
- Items with missing or malformed publication dates are skipped.
- DeepL fallback warnings are reported in text and JSON output.
