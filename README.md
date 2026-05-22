# 🇦🇪 uae-news-digest

[![CI](https://github.com/drakulavich/uae-news-digest/actions/workflows/ci.yml/badge.svg)](https://github.com/drakulavich/uae-news-digest/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@drakulavich/uae-news-digest)](https://www.npmjs.com/package/@drakulavich/uae-news-digest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)

Daily news digest from Google News RSS. Deterministic filtering, no ML. Supports multiple regions.

- **Multi-region** — UAE (default), US, UK, Germany, Russia — or any custom RSS URL
- **Source scoring** — Reuters, The National, Gulf News, Khaleej Times ranked higher
- **Fuzzy dedup** — Jaccard similarity with synonym normalization catches duplicate stories
- **DeepL translation** — optional, any language via DeepL API
- **Emoji categories** — 🌧️ weather, 🛡️ defense, 📉 property, ✈️ aviation, ⛴️ shipping, and more
- **Agent-friendly** — `--json` outputs a structured envelope for automation

## Install

```bash
bun install -g @drakulavich/uae-news-digest
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
uae-news-digest                                    # fetch + print UAE news (default)
uae-news-digest --region us                         # US news
uae-news-digest --region de                         # Germany news
uae-news-digest --dry-run                           # preview without updating state
uae-news-digest --hours 12 --limit 10               # last 12h, max 10 items
uae-news-digest --json                              # output as JSON for agents/scripts
uae-news-digest healthcheck                         # live Google News smoke check
DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE  # translate to German via DeepL
```

| Flag | Default | Description |
|------|---------|-------------|
| `--region <code>` | `uae` | News region preset (`uae`, `us`, `uk`, `de`, `ru`) |
| `--hours <n>` | `36` | Lookback window in hours |
| `--limit <n>` | `6` | Max items in digest |
| `--target-lang <code>` | | DeepL target language (e.g. `DE`, `FR`, `JA`). Requires `DEEPL_AUTH_KEY` |
| `--rss-url <url>` | | Custom RSS URL (overrides `--region`) |
| `--state-file <path>` | `./seen_titles.txt` | Seen-items state file |
| `--timeout-ms <n>` | `15000` | RSS fetch timeout |
| `--dry-run` | `false` | Preview without updating state |
| `--json` | `false` | Output as JSON (agent-friendly envelope) |

## Example Output

```
🇦🇪 UAE Latest News Digest

🛡️ UAE intercepts 79 Iranian strike assets (The National, 2h ago)
📉 Dubai property sales drop more than 30% (Anadolu Ajansı, 5h ago)
⛴️ Container ship incident at Khor Fakkan (Reuters, 3h ago)
✈️ Abu Dhabi airport reopens after rain (Khaleej Times, 1h ago)
🌧️ Unstable weather hits some emirates (Gulf News, 4h ago)
🛢️ Oil prices: OPEC+ mulls output increase (CNBC, 6h ago)
```

## Programmatic API

```typescript
import { parseRss, buildDigest, runDigest, renderDigest } from "@drakulavich/uae-news-digest/core";
```

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

State file (`seen_titles.txt`) tracks seen articles to avoid repeats across runs.

`healthcheck` uses the default live Google News RSS feed. For deterministic smoke tests, pass `healthcheck --rss-url <url>`.

## Requirements

- [Bun](https://bun.sh) >= 1.3 (CI pins 1.3.14).
- CI validates Linux and macOS. Windows is not a supported target yet.

## License

Made with 💛🩵 Published under MIT License.
