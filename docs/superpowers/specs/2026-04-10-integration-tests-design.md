# Integration Tests with Stubbed HTTP

## Problem

No integration tests exercise the CLI end-to-end. The existing unit tests cover lib.ts functions in isolation but don't test the actual CLI entry point (index.ts), argument parsing, stdout/stderr separation, exit codes, or the interaction between RSS fetching and output formatting.

All tests must run offline (no internet required).

## Design

### Test Server

A local `Bun.serve` HTTP server started in `beforeAll`, stopped in `afterAll`. Handles two routes:

- `GET /rss` — returns canned RSS XML with configurable items
- `POST /translate` — returns canned DeepL translation responses

The server URL is passed to the CLI via `--rss-url http://localhost:<port>/rss`. DeepL URL is overridden via `DEEPL_API_URL` env var.

### lib.ts Change

Replace the hardcoded `DEEPL_API_URL` constant:

```typescript
// Before
export const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

// After
export const DEEPL_API_URL = process.env.DEEPL_API_URL ?? 'https://api-free.deepl.com/v2/translate';
```

### Test Execution

Each test spawns `bun src/index.ts` as a subprocess via `Bun.spawn`, passing CLI flags and env vars. Captures stdout, stderr, and exit code.

Uses a temp directory for `--state-file` to avoid polluting the workspace. Cleaned up in `afterAll`.

### Test Cases

| # | Scenario | Flags | Stub behavior | Assert |
|---|----------|-------|---------------|--------|
| 1 | Default text output | `--rss-url <url> --state-file <tmp> --dry-run` | RSS with 2 items | stdout contains header, emoji, titles, "Xh ago", source; exit 0 |
| 2 | JSON output | `--json --rss-url <url> --state-file <tmp> --dry-run` | RSS with 2 items | stdout is valid JSON with `tool`, `version`, `query`, `count`, `items` array with `hoursAgo`; exit 0 |
| 3 | Dry run does not write state | `--dry-run --rss-url <url> --state-file <tmp>` | RSS with 2 items | stderr contains "dry run"; state file does not exist after run |
| 4 | Translation via DeepL | `--target-lang DE --rss-url <url> --state-file <tmp> --dry-run` + `DEEPL_AUTH_KEY=fake` + `DEEPL_API_URL=<url>` | RSS + DeepL returns translations | stdout contains translated titles; stderr contains "Translating to DE" |
| 5 | --target-lang without DEEPL_AUTH_KEY | `--target-lang DE --rss-url <url> --state-file <tmp>` (no DEEPL_AUTH_KEY) | n/a | stderr contains error about DEEPL_AUTH_KEY; exit 1 |
| 6 | RSS HTTP error | `--rss-url <url>/error --state-file <tmp>` | Server returns 500 | stderr contains "RSS fetch failed"; exit 1 |
| 7 | Empty RSS feed | `--rss-url <url>/empty --state-file <tmp> --dry-run` | RSS with 0 items | stdout contains "No significant news"; exit 0 |
| 8 | State file persistence | `--rss-url <url> --state-file <tmp>` (no --dry-run) | RSS with 2 items | state file exists after run with seen keys |

### Test Server Routes

- `GET /rss` — 2-item RSS feed (Dubai airport + Abu Dhabi market, recent timestamps)
- `GET /rss/empty` — valid RSS with empty channel
- `GET /rss/error` — returns HTTP 500
- `POST /translate` — returns DeepL-shaped response with German translations

### Files Changed

| File | Action | What |
|------|--------|------|
| `src/lib.ts` | Modify | Make `DEEPL_API_URL` overridable via env var |
| `test/cli.test.ts` | Create | Integration test file with test server and 8 test cases |
