<p align="center">
  <img src="https://raw.githubusercontent.com/drakulavich/uae-news-digest/main/docs/logo.png" alt="uae-news-digest logo" width="200" />
</p>

<h1 align="center">uae-news-digest</h1>

<p align="center">
  <a href="https://github.com/drakulavich/uae-news-digest/actions/workflows/ci.yml"><img src="https://github.com/drakulavich/uae-news-digest/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@drakulavich/uae-news-digest"><img src="https://img.shields.io/npm/v/@drakulavich/uae-news-digest" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
</p>

<p align="center"><b>Wake up to the UAE without opening ten news tabs.</b><br>
<code>uae-news-digest</code> turns Google News RSS into a ranked, deduplicated terminal briefing with clean JSON for scripts and agents.</p>

<p align="center">
  <img src="https://github.com/drakulavich/uae-news-digest/raw/main/assets/demo.gif" alt="uae-news-digest demo: healthcheck, text digest, and JSON output" width="720">
</p>

- **Signal first.** Preferred sources and UAE-specific keywords push important stories up.
- **No repeat sludge.** Exact keys plus fuzzy title matching collapse syndicated duplicates.
- **Human or machine.** Read the emoji digest in your terminal, or pipe stable JSON into agents, cron, Slack, or your own scripts.
- **Bring your own topics.** Use the built-in UAE set, or drop in a config file to define your own topics, queries, and feeds.
- **Translate only when you ask.** Optional DeepL support keeps the default path simple and dependency-light.

## Install

```bash
bun add -g @drakulavich/uae-news-digest
```

Or run from source:

```bash
git clone https://github.com/drakulavich/uae-news-digest.git
cd uae-news-digest
bun install
bun link
```

## Usage

```bash
uae-news-digest                                      # fetch + print the UAE digest
uae-news-digest --hours 12 --limit 10                # tighter briefing window
uae-news-digest --json                               # stable envelope for automation
uae-news-digest --config ./digest.config.json        # your own topics
uae-news-digest healthcheck                          # JSON liveness probe
uae-news-digest config print-default > digest.config.json  # start a config from the built-in set
uae-news-digest config validate                      # check the auto-detected config
DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE  # optional DeepL translation
```

| Flag | Default | Description |
|------|---------|-------------|
| `--config <path>` | | Path to a digest config JSON (overrides auto-detect; see [Topics Mode](#topics-mode)) |
| `--hours <n>` | `36` | Lookback window in hours |
| `--limit <n>` | | Max items per topic (overrides each topic's own limit); must be a positive integer |
| `--target-lang <code>` | | DeepL target language (e.g. `DE`, `FR`, `JA`). Requires `DEEPL_AUTH_KEY` |
| `--state-file <path>` | `./seen_titles.txt` | Seen-items state file |
| `--timeout-ms <n>` | `15000` | RSS fetch timeout |
| `--dry-run` | `false` | Preview without updating state |
| `--json` | `false` | Output as JSON (agent-friendly envelope) |

### Subcommands

| Command | Description |
|---------|-------------|
| `manifest` | Print a machine-readable tool descriptor as JSON |
| `healthcheck [--rss-url <url>]` | Smoke-test the first topic's feed (or `--rss-url`); prints `{ok, version, latencyMs}` |
| `config print-default` | Print the built-in config as JSON, ready to copy into `digest.config.json` |
| `config validate [path]` | Validate a config file (default: the auto-detected one); prints `ok` or every issue with its JSON path |

### Exit codes

`0` success (a topic may still have failed — see warnings). `1` a usage, config, network, or timeout error, or no topic could be fetched.

## What You Get

```
🇦🇪 UAE digest — 2026-09-05

📰 UAE
  🛡️ UAE intercepts 79 Iranian strike assets (The National, 2h ago)
  📉 Dubai property sales drop more than 30% (Anadolu Ajansı, 5h ago)
  ⛴️ Container ship incident at Khor Fakkan (Reuters, 3h ago)
  ✈️ Abu Dhabi airport reopens after rain (Khaleej Times, 1h ago)
  🌧️ Unstable weather hits some emirates (Gulf News, 4h ago)
  🛢️ Oil prices: OPEC+ mulls output increase (CNBC, 6h ago)
```

And when you need structured output:

```bash
uae-news-digest --json | jq '.items[].title'
```

## Signal filter

Every run automatically surfaces headlines that materially affect an expat family in the UAE across four areas:

- **Safety / threats** — missiles, drones, airspace closures, evacuation alerts, storms
- **Money / daily life** — rent, fees, fuel prices, salary, fines, subsidies
- **Rules / visas / documents** — visa changes, new laws, permit and licence updates
- **Logistics / infrastructure** — flight disruptions, road closures, metro outages

Items that score above the threshold are pulled into a `🚨 Important` block printed **at the top** of the digest, deduplicated from the regular listing below. Each important line shows a `[signals]` marker that explains why it surfaced. PR puff (launches, awards, "world's first/tallest/largest", festivals, and similar) is penalised and pushed down.

This is a heuristic — no API key required, always on.

**Example output:**

```
🇦🇪 UAE digest — 2025-11-14

🚨 Important
  🛡️ UAE intercepts Iranian missile barrage (The National, 1h ago) [missile, airspace] — UAE Security
  ✈️ Dubai airport closes Terminal 2 for maintenance (Gulf News, 3h ago) [flight] — Travel

💰 UAE economy
  📉 OPEC+ weighs output cut for Q1 (Reuters, 4h ago)
  ...
```

### Topic `match` / `matchMode`

Google News sometimes returns loosely-matched articles for a query. Add optional `match` and `matchMode` keys to any topic to require real keyword matches in the article title:

```jsonc
{
  "topics": [
    {
      "slug": "schools",
      "name": "Schools",
      "query": "school fees Dubai",
      "match": ["school", "fees"],
      "matchMode": "all"
    }
  ]
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `match` | `string[]` | — | Keywords that must appear in the article title. Omit to keep existing behaviour. |
| `matchMode` | `"all"` \| `"any"` \| `<N>` | `"all"` | `"all"` — every term must match; `"any"` — at least one; a positive integer `N` — at least N terms. |

When articles are dropped for failing the keyword filter, a warning reports how many were dropped (visible in non-JSON mode on stderr).

### Agent workflow (key-free smart pass)

`--json` enriches every item with `importance`, `tier` (`breaking` | `impact` | `neutral` | `fluff`), `signals`, and `matchedTerms`. Pipe that to an LLM with the ready-made filter criterion:

```bash
uae-news-digest --prompt                                    # print the filter criterion
uae-news-digest --json --dry-run | claude "$(uae-news-digest --prompt)"
```

`--dry-run` keeps the seen-items state file untouched, so an ad-hoc agent-filter pass doesn't mark those articles as seen and hide them from the next real digest. Drop it when this pipe _is_ the scheduled run.

The agent can drop noise reproducibly based solely on the structured metadata — no extra API key, no custom prompt engineering required.

`--prompt` output:

> You are a news filter for an expat family in the UAE. Keep only what materially affects safety, money, rules/visas, or logistics. Drop PR, launches, awards, rankings, and 'world's first/tallest/largest'.

## Topics Mode

Without a config, the built-in UAE config runs (one topic). For per-topic digests (e.g. economy, real estate, regional politics), create a `digest.config.json` file:

```json
{
  "locale": { "hl": "en", "gl": "AE", "ceid": "AE:en" },
  "topics": [
    {
      "slug": "economy",
      "name": "UAE economy",
      "emoji": "💰",
      "query": "(UAE OR Emirates) AND (economy OR GDP OR inflation OR ADNOC OR non-oil)",
      "limit": 5
    },
    {
      "slug": "realty",
      "name": "Real estate",
      "emoji": "🏠",
      "query": "(Dubai OR \"Abu Dhabi\") AND (\"real estate\" OR property OR Emaar OR Aldar)",
      "limit": 4
    },
    {
      "slug": "chocolate",
      "name": "Dubai chocolate",
      "emoji": "🍫",
      "query": "\"Dubai chocolate\" OR pistachio OR kunafa",
      "limit": 3
    }
  ]
}
```

Heuristics (skip list, source tiers, keyword boosts, dedupe synonyms, importance markers, emoji rules) also live in this file. A config without those sections runs neutral. Start from the built-in UAE set with `uae-news-digest config print-default > digest.config.json`, then edit it; run `uae-news-digest config validate` to check it against the schema before using it.

Each topic builds its Google News RSS URL from `query` and `locale`. Add `feedUrl` to a topic to fetch that exact RSS URL instead — useful for non-Google feeds or deterministic tests.

The CLI looks for the config in this order:

1. `--config <path>` (explicit override)
2. `./digest.config.json` (current working directory)
3. `$XDG_CONFIG_HOME/uae-news-digest/topics.json` (falls back to `~/.config/uae-news-digest/topics.json`)

Without a config the built-in UAE config runs. The CLI fetches each topic in parallel and renders one section per topic (a single-topic config still prints its heading). A story already selected by an earlier topic is not repeated in a later one (exact-key match; fuzzy near-duplicate detection runs within each topic), so the topic order in the config sets priority.

`--target-lang` translates all section titles in a single DeepL batch. `--limit`, when given, must be a positive integer and overrides every topic's per-topic limit for the run.

The example `query` strings above are starting points, not optimal — iterate them against real Google News output.

### JSON output

```json
{
  "tool": "uae-news-digest",
  "version": "...",
  "generatedAt": "2026-09-05T06:00:00.000Z",
  "query": { "hours": 36, "limit": null, "targetLang": null },
  "topics": [
    { "slug": "economy", "name": "UAE economy", "count": 5 },
    { "slug": "realty",  "name": "Real estate", "count": 4 },
    { "slug": "chocolate", "name": "Dubai chocolate", "count": 1 }
  ],
  "count": 10,
  "warnings": [],
  "items": [
    {
      "topic": "economy",
      "title": "...",
      "translatedTitle": null,
      "source": "...",
      "url": "...",
      "publishedAt": "...",
      "hoursAgo": 4,
      "score": 0,
      "importance": 0,
      "tier": "neutral",
      "signals": [],
      "matchedTerms": []
    }
  ]
}
```

Items are emitted as a flat list in section order; each carries its `topic` slug so consumers can group. `query.limit` is `null` unless `--limit` was passed.

## Programmatic API

```typescript
import { loadConfig, DEFAULT_CONFIG, runDigest, renderText, toJson } from "@drakulavich/uae-news-digest/core";

const config = await loadConfig("./digest.config.json").catch(() => DEFAULT_CONFIG);
const result = await runDigest({
  config,
  seenKeys: new Set(),
  hours: 36,
  now: new Date(),
  fetchText: (url) => fetch(url).then((r) => r.text()),
});
console.log(renderText(result, config, new Date()));
```

The `/core` entry point exports `runDigest`, `renderText`, `toJson`, `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `parseRss`, plus the Seen-item state helpers (`readSeenKeys`, `writeSeenKeys`, `DEFAULT_STATE_FILE`) and DeepL helpers (`translateDeepL`, `DEEPL_API_URL`) — the same filtering, scoring, deduplication, translation fallback, and rendering logic the CLI uses, without spawning a process.

## How It Works

```
uae-news-digest --hours 12 --limit 10
  │
  ├── Config ──────── topics (query + locale) → one Google News RSS URL each (or feedUrl)
  │
  ├── Fetch RSS ───── Google News RSS feed per topic
  │
  ├── Filter ──────── skip: opinion, tabloids, sports, travel
  │
  ├── Score ───────── +3 preferred source, +2 UAE mention, +2 priority topic
  │
  ├── Deduplicate ─── exact key match + Jaccard fuzzy (threshold 0.45)
  │
  ├── Translate ───── DeepL API (optional, when --target-lang set)
  │
  └── Render ──────── display flag/name header + per-item emoji + title + source + hours ago
```

State file (`seen_titles.txt`) tracks seen articles so scheduled runs do not repeat the same briefing forever.

`healthcheck` probes the first topic's feed from the resolved config (`--config`, `./digest.config.json`, XDG, or the built-in default), honouring `--timeout-ms` (default `15000`). For deterministic smoke tests against a fixed feed, pass `healthcheck --rss-url <url>`.

## Requirements

- [Bun](https://bun.sh) >= 1.3 (CI pins 1.3.14).
- CI validates Linux and macOS. Windows is not a supported target yet.

## License

Made with 💛🩵 Published under MIT License.
