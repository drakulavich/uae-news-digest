# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Config schema (validated with `zod`) now carries every heuristic: `skip`, `scoring` (source tiers, title boosts), `dedupe` (similarity threshold, synonyms, stop words), `importance` (markers, weights, threshold), `emoji` rules, `display` (`display` is parsed but not yet rendered; the topical header still derives from `locale.gl` until the next release), and `agentPrompt`. A built-in UAE config (`src/config/default.json`) reproduces the previous hard-coded behaviour.
- Programmatic API: `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `DigestConfigSchema`, and the `DigestConfig` / `Topic` / `Heuristics` types.
- `topics[].feedUrl`: fetch an explicit RSS URL instead of a Google News search (used by tests and the packed-package smoke; replaces `--rss-url`).

### Changed
- **Breaking (config):** `locale` is required in a topics config; unknown keys are rejected.
- **Breaking (behaviour):** a topics config without heuristic sections now runs with neutral heuristics (no source/keyword boosts, no 🚨 Important block, `•` emoji, no skip list). Copy the sections you want from `src/config/default.json`.
- **Breaking (API):** `loadTopicsConfig` → `loadConfig`, `resolveTopicsConfigPath` → `resolveConfigPath`, `TopicConfig` → `Topic`, `TopicsConfig` → `DigestConfig`; `scoreItem`, `titleSimilarity`, `scoreImportance`, `emojiFor`, `buildDigest*` take a config slice, and `runTopicalDigest` reads heuristics from its `config`. Removed: `IMPORTANCE_THRESHOLD`, `FILTER_PROMPT`, `BREAKING_MARKERS`, `IMPACT_MARKERS`, `FLUFF_MARKERS`, `TIER_*_RE`. `escapeRegExp` moved from `importance` to `terms` (still re-exported from `lib`).
- Term lists match whole words (with `s`/`es` plural) and support a trailing `*` for stem matching; previously scoring, emoji and skip matched raw substrings (e.g. "rain" fired on "Ukraine").
- `dedupe.synonyms` keys/values and `dedupe.stopWords` are lower-cased at load and must be single ASCII words (letters and digits), since they are compared against normalised title tokens; anything else is rejected with the offending path.
- `--match` terms go through the same matcher as config lists, so a trailing `*` in a `--match` term is now a stem wildcard rather than a literal.
- **Breaking (CLI):** region mode is gone. `--region`, `--rss-url` (main command), `--match`, `--match-mode`, `--no-topics`, and `--topics-config` are removed; `--config <path>` names the config file. Without a config the built-in UAE config runs (one topic). `--limit` has no default and, when given, caps every topic. `healthcheck --rss-url` stays.
- **Breaking (output):** one text format for every run — `{flag} {name} digest — {date}`, optional `🚨 Important` block, one section per topic (a single-topic config still prints its heading); `(no new items)` / `(all items are in 🚨 Important)` replace the Russian placeholders. One JSON format: `mode` removed, `googleUrl` → `url`, new `generatedAt` and `translatedTitle`, `query.limit` is `null` unless `--limit` was passed, `topics` always present.
- **Breaking (API):** `runDigest(options)` now takes `{ config, seenKeys, hours, limitOverride?, now, fetchText, translate?, targetLang? }` and returns `{ sections, warnings, nextSeenKeys, fetchedTopics }`; rendering is `renderText(result, config, now)` and `toJson(result, meta)`. Removed: `runTopicalDigest`, `renderDigest`, `renderTopicalDigest`, `mergeSeenKeys`, `buildRssUrl`, `REGION_PRESETS`, `localeContextFor`, and the `RegionPreset`/`RssLocale`/`LocaleContext` types. `translateDeepL` throws on failure instead of returning `null`. `DigestItem.link` → `url`; `matchedTerms` is always an array; `translatedTitle` added.
- Partial failures stay warnings; the CLI exits 1 only when no topic could be fetched. The "feed returned no items — check the query" warning fires only when the feed itself was empty, not when every item was already seen.
- `display` from the config now drives the text header (flag, name, timezone).

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
