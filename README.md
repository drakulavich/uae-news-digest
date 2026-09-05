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
- **Bring your own feed.** Use UAE by default, switch regions, or pass any RSS URL.
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
uae-news-digest                                      # fetch + print UAE news
uae-news-digest --hours 12 --limit 10                # tighter briefing window
uae-news-digest --json                               # stable envelope for automation
uae-news-digest --region de                          # Germany preset
uae-news-digest --rss-url http://localhost/feed.xml  # any RSS feed
uae-news-digest healthcheck                          # JSON liveness probe
DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE  # optional DeepL translation
```

| Flag | Default | Description |
|------|---------|-------------|
| `--region <code>` | `uae` | News region preset (`uae`, `us`, `uk`, `de`) |
| `--hours <n>` | `36` | Lookback window in hours |
| `--limit <n>` | `6` | Max items in digest |
| `--target-lang <code>` | | DeepL target language (e.g. `DE`, `FR`, `JA`). Requires `DEEPL_AUTH_KEY` |
| `--rss-url <url>` | | Custom RSS URL (overrides `--region`) |
| `--state-file <path>` | `./seen_titles.txt` | Seen-items state file |
| `--timeout-ms <n>` | `15000` | RSS fetch timeout |
| `--topics-config <path>` | | Path to topics config JSON (overrides auto-detect) |
| `--no-topics` | | Force legacy region mode even if a topics config is present |
| `--dry-run` | `false` | Preview without updating state |
| `--json` | `false` | Output as JSON (agent-friendly envelope) |

## What You Get

```
🇦🇪 UAE Latest News Digest

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

**Example output (topics mode):**

```
🇦🇪 UAE digest — 2025-11-14

🚨 Important
  🛡️ UAE intercepts Iranian missile barrage (The National, 1h ago) [missile, airspace] — UAE Security
  ✈️ Dubai airport closes Terminal 2 for maintenance (Gulf News, 3h ago) [flight] — Travel

💰 UAE economy
  📉 OPEC+ weighs output cut for Q1 (Reuters, 4h ago)
  ...
```

In **region mode** the Important block has the same layout but without the ` — Topic Name` suffix.

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

When articles are dropped for failing the keyword filter, a warning reports how many were dropped (visible in non-JSON mode on stderr). The CLI equivalents for region mode are `--match <terms...>` and `--match-mode <mode>`.

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

For per-topic digests (e.g. economy, real estate, regional politics) instead of one undifferentiated regional feed, create a `digest.config.json` file:

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

Heuristics (skip list, source tiers, keyword boosts, dedupe synonyms, importance markers, emoji rules) also live in this file. A config without those sections runs neutral. Start from the built-in UAE set in [`src/config/default.json`](src/config/default.json).

The CLI looks for the config in this order:

1. `--topics-config <path>` (explicit override)
2. `./digest.config.json` (current working directory)
3. `$XDG_CONFIG_HOME/uae-news-digest/topics.json` (falls back to `~/.config/uae-news-digest/topics.json`)

When a config is found, the CLI fetches each topic in parallel and renders one section per topic. Cross-topic dedup is "first topic in config wins" — reorder the array to set priority. To force the legacy region mode while a config is present, pass `--no-topics`.

`--target-lang` translates all section titles in a single DeepL batch. `--limit`, when explicitly set, overrides every topic's per-topic limit for the run.

The example `query` strings above are starting points, not optimal — iterate them against real Google News output.

### Topics-mode JSON output

```json
{
  "tool": "uae-news-digest",
  "version": "...",
  "mode": "topics",
  "query": { "hours": 36, "targetLang": null },
  "topics": [
    { "slug": "economy", "name": "UAE economy", "count": 5 },
    { "slug": "realty",  "name": "Real estate", "count": 4 },
    { "slug": "chocolate", "name": "Dubai chocolate", "count": 1 }
  ],
  "count": 10,
  "warnings": [],
  "items": [
    { "topic": "economy", "title": "...", "source": "...", "score": 0, "publishedAt": "...", "hoursAgo": 4 }
  ]
}
```

Items are emitted as a flat list in section order; each carries its `topic` slug so consumers can group. Legacy region mode emits the same envelope with `mode: "region"` and without the `topics` array.

## Programmatic API

```typescript
import { parseRss, buildDigest, runDigest, renderDigest } from "@drakulavich/uae-news-digest/core";
```

Use the core API when you already have RSS XML and want the same filtering, scoring, deduplication, translation fallback, and rendering logic without spawning the CLI.

## How It Works

```
uae-news-digest --region us --hours 12 --limit 10
  │
  ├── Region ────── resolve RSS URL from preset (or --rss-url override)
  │
  ├── Fetch RSS ─── Google News RSS feed
  │
  ├── Filter ────── skip: opinion, tabloids, sports, travel
  │
  ├── Score ─────── +3 preferred source, +2 UAE mention, +2 priority topic
  │
  ├── Deduplicate ─ exact key match + Jaccard fuzzy (threshold 0.45)
  │
  ├── Translate ─── DeepL API (optional, when --target-lang set)
  │
  └── Render ────── region flag + emoji + title + source + hours ago
```

State file (`seen_titles.txt`) tracks seen articles so scheduled runs do not repeat the same briefing forever.

`healthcheck` uses the default live Google News RSS feed. For deterministic smoke tests, pass `healthcheck --rss-url <url>`.

## Requirements

- [Bun](https://bun.sh) >= 1.3 (CI pins 1.3.14).
- CI validates Linux and macOS. Windows is not a supported target yet.

## License

Made with 💛🩵 Published under MIT License.
