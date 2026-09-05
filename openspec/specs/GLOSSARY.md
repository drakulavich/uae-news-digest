# Glossary

Canonical terms for the uae-news-digest spec corpus. Specs use these terms
verbatim; if you need a new term, add it here first.

| Term | Definition |
|---|---|
| **uae-news-digest** | This project: a Bun-native CLI + programmatic API that builds a daily UAE news Digest from Google News RSS, published as `@drakulavich/uae-news-digest`. |
| **Google News RSS** | The upstream feed the Pipeline fetches and parses (`src/rss.ts`, `parseRss`). |
| **Item** | One news entry — `RssItem` as parsed (`src/rss.ts`), `DigestItem` after scoring/selection (`src/digest.ts`). |
| **Digest** | The ranked, deduplicated, limited set of Items produced for a run, rendered as text or `--json` (`src/digest.ts`, `src/render.ts`). |
| **Pipeline** | The end-to-end orchestration: fetch → normalize → score → dedup → Signal filter → limit → render (`src/pipeline.ts`, `runDigest`). |
| **Scoring** | Ranking Items by importance and computing title similarity for dedup (`src/scoring.ts`, `src/importance.ts`). |
| **Title similarity** | The measure used to deduplicate near-identical headlines from different sources (`src/scoring.ts`). |
| **Signal filter** | The step that surfaces important UAE news and drops PR / promotional noise (`src/importance.ts`; #41). |
| **Config** | The JSON file (`--config`, `./digest.config.json`, or XDG) that defines locale, display, topics, and heuristics; `src/config/schema.ts`, loaded by `src/config/load.ts`; built-in default `src/config/default.json`. |
| **Match terms** | Per-topic `match` / `matchMode` in the config (`src/digest.ts`, `matchTerms`). |
| **Seen-item state** | The state file (`--state-file`, default `DEFAULT_STATE_FILE`) recording already-shown Items so they are not repeated; bypassed by `--dry-run` (`src/state.ts`). |
| **DeepL translation** | Optional translation of the Digest via DeepL when `--target-lang` is set and `DEEPL_AUTH_KEY` is present (`src/translate.ts`, `translateDeepL`). |
| **Output mode** | How the Digest is emitted: human text by default (`src/render.ts`), machine-readable JSON with `--json` (`src/json.ts`). |
| **manifest** | The command that prints the tool manifest as JSON for agents (`src/index.ts`, `manifest`). |
| **healthcheck** | The command that smoke-checks feed reachability and readiness, with `--rss-url` for deterministic testing (`src/index.ts`, `healthcheck`). |
| **Agent filter prompt** | The text printed by `--prompt` describing how an LLM agent should filter the Digest (`src/index.ts`). |
| **Core API** | The programmatic interface re-exported from `@drakulavich/uae-news-digest/core` (`src/core.ts`) — `runDigest`, `renderText`, `toJson`, `loadConfig`, and other helpers. |
