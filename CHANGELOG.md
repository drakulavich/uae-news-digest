# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
