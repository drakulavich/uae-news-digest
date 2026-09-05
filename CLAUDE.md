# CLAUDE.md

## Project Overview

UAE News Digest is a daily UAE news digest CLI: fetches Google News RSS, scores and dedupes items, optionally translates. Bun runtime, no build step — `bin` points straight at `src/index.ts`.

Heuristics (skip, scoring, dedupe, importance, emoji) come from the config — never hard-code region knowledge in `src/*.ts`; the built-in UAE set lives in `src/config/default.json`.

Two interfaces: the CLI (`uae-news-digest`) and a programmatic API (`@drakulavich/uae-news-digest/core` — exports `runDigest`, `renderText`, `toJson`, `loadConfig`, `DEFAULT_CONFIG` among others).

```
config (default.json or digest.config.json) → url.ts buildFeedUrl → fetch (CLI adapter)
  → rss.ts parseRss → digest.ts buildDigestWithStats (score, dedupe) → translate (optional)
  → render.ts renderText | json.ts toJson
```

## Critical Development Rules

### BUN-ONLY RUNTIME

Bun, not Node.js. Bun-native APIs only (`Bun.spawn`, `Bun.write`, `Bun.file`, `Bun.$`). Bun executes TypeScript directly — there is no build step to add.

### TRANSLATION IS OPT-IN

Default output is English with no translation. It only runs when `--target-lang <code>` is passed **and** `DEEPL_AUTH_KEY` is set (DeepL Free API). Never translate by default — it costs quota.

### BRANCH PROTECTION

`main` is protected: never push to it directly, every change goes through a PR, and CI must pass before merging. Use `git worktree add` for multi-file features so the main checkout stays clean.

### VERIFY BEFORE PUSHING

Run `bun test` and `bun run typecheck` locally before every push. Do NOT push broken code.

### ERROR HANDLING

Human-readable messages with context: what failed, why, what to do. Never swallow errors silently.

## Build Commands

```bash
bun install                    # Install dependencies
bun test                       # Run all tests
bun run typecheck              # TypeScript type checking
bun run build                  # Emit declaration/build output
bun run smoke:pack             # Smoke-test the packed npm package
bun run dev                    # Run CLI in development
```

## Code Style

- **TypeScript**: strict mode; relative imports (`./lib`, not `src/lib`).
- **Output**: `console.log()` for results, `console.error()` for progress and errors — stdout stays pipe-friendly.
