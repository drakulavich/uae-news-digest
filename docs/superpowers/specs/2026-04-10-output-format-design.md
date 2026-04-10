# Output Format Redesign

## Problem

The current `--format` flag defaults to JSON and the text mode lacks polish. The JSON shape mixes a pre-rendered `output` string with data, making it unfriendly for agents and automation. stdout/stderr separation is inconsistent.

## Design

### Flag Change

Replace `--format <format>` (values: `json`, `table`) with `--json` boolean flag.

- **Text (default):** `uae-news-digest` — human-readable digest to stdout
- **JSON:** `uae-news-digest --json` — structured envelope to stdout

### Text Output

Written to stdout via `process.stdout.write`. No metadata footer. Each item shows hours since publication:

```
🇦🇪 UAE Latest News Digest

✈️ Dubai airport reopens after rain (Reuters, 2h ago)
📉 Abu Dhabi market overview (Gulf News, 5h ago)
```

Empty case:
```
🇦🇪 UAE Latest News Digest

• No significant news in the check window.
```

`hoursAgo` is a rounded integer: 0 for < 30min, otherwise `Math.round((now - publishedAt) / 3600000)`.

### JSON Output

Written to stdout via `process.stdout.write`. Pretty-printed with 2-space indent, trailing newline.

```json
{
  "tool": "uae-news-digest",
  "version": "0.1.0",
  "query": { "hours": 36, "limit": 6, "targetLang": null },
  "count": 3,
  "items": [
    {
      "title": "Dubai airport reopens after rain",
      "source": "Reuters",
      "score": 7,
      "publishedAt": "2026-04-10T07:00:00Z",
      "hoursAgo": 2
    }
  ]
}
```

- `tool` and `version`: identify the producer (matches manifest pattern)
- `query`: echo back the request parameters so agents can correlate
- `query.targetLang`: `null` when not set, string when set
- `count`: number of items (convenience for agents)
- `items`: array of digest items with `hoursAgo` computed at render time

### stdout/stderr Separation

| What | Where |
|------|-------|
| Digest text or JSON envelope | stdout |
| "Translating to DE via DeepL..." | stderr |
| Error messages | stderr |
| Dry-run notice ("dry run — state file not updated") | stderr |

All `console.log` calls for output become `process.stdout.write`. All diagnostics use `console.error`.

## Changes

### `src/lib.ts`

- Update `renderDigest` signature to accept `now?: Date` parameter
- Add "Xh ago" suffix to each item line in text output, computed from `item.publishedAt` relative to `now`
- Compute `hoursAgo` as: `Math.round((now.getTime() - item.publishedAt.getTime()) / 3_600_000)`

### `src/index.ts`

- Replace `.option('--format <format>', 'output format: json, table', 'json')` with `.option('--json', 'output as JSON', false)`
- Replace `fmt === 'json'` block with `options.json` check
- Build JSON envelope inline with `tool`, `version`, `query`, `count`, `items` (including `hoursAgo`)
- Use `process.stdout.write` for both text and JSON output
- Move dry-run notice to stderr
- Update manifest flags: replace `--format <json|table>` with `--json`

### `test/lib.test.ts`

- Update `renderDigest` tests to verify "Xh ago" suffix appears in output
- Pass `now` parameter to `renderDigest` in tests for deterministic output

### `README.md`

- Update usage examples: remove `--format table`, add `--json`
- Update flags table: replace `--format` row with `--json` row
- Update example output to show "Xh ago" suffix
