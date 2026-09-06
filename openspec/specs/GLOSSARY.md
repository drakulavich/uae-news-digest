# Glossary

Canonical terms for the uae-news-digest spec corpus. Specs use these terms
verbatim; if you need a new term, add it here first.

| Term | Definition |
|---|---|
| **uae-news-digest** | This project: a Bun-native CLI + programmatic API that builds a daily UAE news Digest from Google News RSS, published as `@drakulavich/uae-news-digest`. |
| **Google News RSS** | The upstream feed the Pipeline fetches and parses (`src/pipeline/rss.ts`, `parseRss`). |
| **Item** | One news entry — `RssItem` as parsed (`src/pipeline/rss.ts`), `DigestItem` after scoring/selection (`src/pipeline/select.ts`). |
| **Digest** | The ranked, deduplicated, limited set of Items produced for a run, rendered as text or `--json` (`src/pipeline/select.ts`, `src/output/text.ts`). |
| **Pipeline** | The end-to-end orchestration: fetch → normalize → score → dedup → Signal filter → limit → render (`src/pipeline/run.ts`, `runDigest`). |
| **Scoring** | Ranking Items by importance and computing title similarity for dedup (`src/pipeline/scoring.ts`, `src/pipeline/importance.ts`). |
| **Title similarity** | The measure used to deduplicate near-identical headlines from different sources (`src/pipeline/similarity.ts`). |
| **Signal filter** | The step that surfaces important UAE news and drops PR / promotional noise (`src/pipeline/importance.ts`; #41). |
| **Config** | The JSON file (`--config`, `./digest.config.json`, or XDG) that defines locale, display, topics, and heuristics; `src/config/schema.ts`, loaded by `src/config/load.ts`; built-in default `src/config/default.json`. |
| **Match terms** | Per-topic `match` / `matchMode` in the config (`src/pipeline/select.ts`, `matchTerms`). |
| **Seen-item state** | The state file (`--state-file`, default `DEFAULT_STATE_FILE`) recording already-shown Items so they are not repeated; bypassed by `--dry-run` (`src/state.ts`). |
| **DeepL translation** | Optional translation of the Digest via DeepL when `--target-lang` is set and `DEEPL_AUTH_KEY` is present (`src/translate.ts`, `translateDeepL`). |
| **Output mode** | How the Digest is emitted: human text by default (`src/output/text.ts`), machine-readable JSON with `--json` (`src/output/json.ts`). |
| **manifest** | The command that prints the tool manifest as JSON for agents, derived from the CLI definition (`src/cli/program.ts`, `src/cli/commands.ts`, `manifest`). |
| **healthcheck** | The command that smoke-checks the first topic's feed from the resolved config, with `--rss-url` for deterministic testing (`src/cli/commands.ts`, `healthcheck`). |
| **Agent filter prompt** | The text printed by `--prompt`, read from the resolved config's `agentPrompt` (`src/cli/run.ts`, `runDefault`). |
| **CLI command** | A Commander action in `src/cli/program.ts`; returns an exit code via `onExit`, throws `CliError` for usage/config problems; `main(argv)` maps both to the process exit code. |
| **CliError** | A typed, user-facing CLI failure with a `kind` of `usage`, `config`, `network`, or `timeout`; fetch failures are classified at the source by `classifyFetchError` (`src/cli/errors.ts`). |
| **Core API** | The programmatic interface re-exported from `@drakulavich/uae-news-digest/core` (`src/core.ts`) — exactly `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `runDigest`, `renderText`, `toJson`, `parseRss`, `readSeenKeys`, `writeSeenKeys`, `DEFAULT_STATE_FILE`, `translateDeepL`, `DEEPL_API_URL`, and the types `DigestConfig`, `Topic`, `ResolveConfigOptions`, `RunOptions`, `DigestResult`, `TopicSection`, `FetchText`, `Translate`, `DigestItem`, `DigestJson`, `DigestJsonItem`, `JsonMeta`, `ImportanceTier`, `RssItem` — pinned by `test/unit/core-surface.test.ts`. |
