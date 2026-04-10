# 🇦🇪 uae-news-digest

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)

Daily UAE news digest from Google News RSS. Deterministic filtering, no ML.

- **Source scoring** — Reuters, The National, Gulf News, Khaleej Times ranked higher
- **Fuzzy dedup** — Jaccard similarity with synonym normalization catches duplicate stories
- **DeepL translation** — any language, with Russian keyword fallback when offline
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
uae-news-digest                                    # fetch + print (Russian keyword translation)
uae-news-digest --dry-run                           # preview without updating state
uae-news-digest --target-lang DE                    # translate to German via DeepL
uae-news-digest --hours 12 --limit 10               # last 12h, max 10 items
uae-news-digest --format table                      # human-readable output
uae-news-digest --no-translate                       # skip translation, English titles
```

| Flag | Default | Description |
|------|---------|-------------|
| `--hours <n>` | `36` | Lookback window in hours |
| `--limit <n>` | `6` | Max items in digest |
| `--target-lang <code>` | `RU` | DeepL target language (e.g. `DE`, `FR`, `JA`) |
| `--state-file <path>` | `./seen_titles.txt` | Seen-items state file |
| `--timeout-ms <n>` | `15000` | RSS fetch timeout |
| `--dry-run` | `false` | Preview without updating state |
| `--no-translate` | | Skip DeepL, use keyword fallback (RU) or English |
| `--format <fmt>` | `json` | Output: `json` or `table` |

Set `DEEPL_AUTH_KEY` env var for DeepL translation. Without it, Russian keyword fallback is used. For non-Russian languages without a key, titles stay in English.

## Example Output

```
🇦🇪 UAE Latest News Digest

🛡️ ОАЭ перехватили 79 ударных средств из Ирана (The National)
📉 Продажи недвижимости в Дубае упали более чем на 30% (Anadolu Ajansı)
⛴️ Инцидент с контейнеровозом в Хор-Факкане (Reuters)
✈️ Аэропорт Абу-Даби возобновил работу после дождя (Khaleej Times)
🌧️ Нестабильная погода обрушивается на некоторые эмираты (Gulf News)
🛢️ Цены на нефть: ОПЕК+ рассматривает увеличение добычи (CNBC)
```

## How It Works

```
uae-news-digest --hours 12 --limit 10 --target-lang DE
  │
  ├── Fetch RSS ─── Google News (UAE + Dubai + Abu Dhabi)
  │
  ├── Filter ────── skip: opinion, tabloids, sports, travel
  │
  ├── Score ─────── +3 preferred source, +2 UAE mention, +2 priority topic
  │
  ├── Deduplicate ─ exact key match + Jaccard fuzzy (threshold 0.45)
  │
  ├── Translate ─── DeepL API → keyword fallback (RU) → English passthrough
  │
  └── Render ────── emoji + translated title + source
```

State file (`seen_titles.txt`) tracks seen articles to avoid repeats across runs.

## Requirements

- [Bun](https://bun.sh) >= 1.3

## License

Made with 💛🩵 Published under MIT License.
