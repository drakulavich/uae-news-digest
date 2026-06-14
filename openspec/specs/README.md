# uae-news-digest — Baseline Specifications

This directory is the **baseline spec corpus**: it captures how uae-news-digest
*actually behaves today*, one capability per directory, so future work can be
proposed as OpenSpec change deltas against a trustworthy reference instead of
tribal knowledge.

> **Disclaimer (living document).** These specs describe the current release and
> are updated whenever behavior changes. If a spec and the code disagree, the code
> is the bug *or* the spec is stale — either way, open an issue; don't silently
> trust one side.

> **Status.** The corpus is being established. Capabilities are extracted into
> `specs/<name>/spec.md` as they are written; the table below lists the planned
> set and links each one once its spec lands. Until then, `README.md` and
> `CLAUDE.md` are the closest record.

## How to read these specs

Every spec follows the same shape:

- **Purpose** — what the capability does and for whom.
- **Non-Goals** — what it deliberately does *not* do (so nobody "fixes" that).
- **Requirements** — verifiable contracts (`SHALL`), each with at least one
  happy-path and one error/edge **Scenario** in Given/When/Then form.
- **Technical Notes** — constants, tables, and `file:line` traceability refs,
  kept out of the requirement text so contracts stay readable.
- **Open Issues** — known gaps, tracked by GitHub issue where one exists.

Terminology is canonical: every term of art (Digest, Pipeline, Signal filter,
Region preset, …) is defined once in [GLOSSARY.md](GLOSSARY.md) and used verbatim
everywhere else.

## Personas

Specs reference these named personas instead of a generic "user":

- **Layla, the morning reader** — runs `uae-news-digest` for a terminal briefing
  over coffee. Cares about a ranked, deduplicated, Signal-filtered Digest, optional
  DeepL translation, and not re-seeing yesterday's items (the Seen-item state).
- **Omar, the automation scripter** — pipes `uae-news-digest --json` into cron jobs,
  scripts, and agents. Cares about stable JSON output, documented exit codes, and
  `healthcheck` / `manifest`.
- **Sana, the agent author** — consumes the Digest via the programmatic API
  (`@drakulavich/uae-news-digest/core`). Cares about the typed Pipeline exports
  (`runDigest`, `buildDigest`, `DigestItem`) and the `--prompt` agent filter prompt.

## Capabilities

| Spec | Covers |
|---|---|
| digest | The default command: fetch → score → dedup → Signal filter → limit → render (text / `--json`) |
| sources | Region presets (`uae`/`us`/`uk`/`de`), `--rss-url`, topics config, `--match` / `--match-mode` |
| state | Seen-item state file, `--dry-run`, repeat suppression across runs |
| translation | Optional DeepL translation (`--target-lang`, `DEEPL_AUTH_KEY`) |
| agent-surface | `manifest`, `healthcheck`, `--prompt`, and the `/core` programmatic API |

*(Links are added as each `spec.md` is written; rows without a link are not yet
extracted — see Status above.)*

## Validation

```bash
openspec spec list                    # enumerate capabilities
openspec validate --specs --strict    # structural validation — must exit 0
```

These commands require the standalone **OpenSpec CLI** — a global developer tool
installed separately, not a uae-news-digest dependency. The specs themselves are
plain Markdown and reviewable without it.
