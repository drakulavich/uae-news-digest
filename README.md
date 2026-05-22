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
  <img src="https://github.com/drakulavich/uae-news-digest/raw/main/assets/demo.gif" alt="uae-news-digest demo: manifest, healthcheck, text digest, and JSON output" width="720">
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
