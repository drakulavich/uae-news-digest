# 🇦🇪 uae-news-digest

[![CI](https://github.com/drakulavich/uae-news-digest/actions/workflows/ci.yml/badge.svg)](https://github.com/drakulavich/uae-news-digest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)

Daily UAE news digest from Google News RSS. Deterministic filtering, no ML.

- **Source scoring** — Reuters, The National, Gulf News, Khaleej Times ranked higher
- **Fuzzy dedup** — Jaccard similarity with synonym normalization catches duplicate stories
- **DeepL translation** — optional, any language via DeepL API
- **Emoji categories** — 🌧️ weather, 🛡️ defense, 📉 property, ✈️ aviation, ⛴️ shipping, and more

## Quick Start

```bash
git clone https://github.com/drakulavich/uae-news-digest.git
cd uae-news-digest
bun install
bun run dev -- --dry-run
```

## Usage

```bash
uae-news-digest                                    # fetch + print in English
uae-news-digest --dry-run                           # preview without updating state
uae-news-digest --hours 12 --limit 10               # last 12h, max 10 items
uae-news-digest --json                              # output as JSON for agents/scripts
DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE  # translate to German via DeepL
```

| Flag | Default | Description |
|------|---------|-------------|
| `--hours <n>` | `36` | Lookback window in hours |
| `--limit <n>` | `6` | Max items in digest |
| `--target-lang <code>` | | DeepL target language (e.g. `DE`, `FR`, `JA`). Requires `DEEPL_AUTH_KEY` |
| `--state-file <path>` | `./seen_titles.txt` | Seen-items state file |
| `--timeout-ms <n>` | `15000` | RSS fetch timeout |
| `--dry-run` | `false` | Preview without updating state |
| `--json` | `false` | Output as JSON (agent-friendly envelope) |

## Example Output

```
🛡️ UAE intercepts 79 Iranian strike assets (The National, 2h ago)
📉 Dubai property sales drop more than 30% (Anadolu Ajansı, 5h ago)
⛴️ Container ship incident at Khor Fakkan (Reuters, 3h ago)
✈️ Abu Dhabi airport reopens after rain (Khaleej Times, 1h ago)
🌧️ Unstable weather hits some emirates (Gulf News, 4h ago)
🛢️ Oil prices: OPEC+ mulls output increase (CNBC, 6h ago)
```

## How It Works

```
uae-news-digest --hours 12 --limit 10
  │
  ├── Fetch RSS ─── Google News (UAE + Dubai + Abu Dhabi)
  │
  ├── Filter ────── skip: opinion, tabloids, sports, travel
  │
  ├── Score ─────── +3 preferred source, +2 UAE mention, +2 priority topic
  │
  ├── Deduplicate ─ exact key match + Jaccard fuzzy (threshold 0.45)
  │
  ├── Translate ─── DeepL API (optional, when --target-lang set)
  │
  └── Render ────── emoji + title + source
```

State file (`seen_titles.txt`) tracks seen articles to avoid repeats across runs.

## Requirements

- [Bun](https://bun.sh) >= 1.3

## License

Made with 💛🩵 Published under MIT License.
