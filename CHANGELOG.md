# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
