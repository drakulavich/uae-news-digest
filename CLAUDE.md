# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UAE News Digest is a daily UAE news digest CLI tool that fetches from Google News RSS with optional DeepL translation. Built on Bun runtime.

Two interfaces: a CLI (`uae-news-digest`) and a programmatic API (`@drakulavich/uae-news-digest/core`).

## Critical Development Rules

### BUN-ONLY RUNTIME

- This project runs on Bun, not Node.js. Use Bun-native APIs (`Bun.spawn`, `Bun.write`, `Bun.file`, `Bun.$`)
- TypeScript is executed directly by Bun — no build step
- The `bin` entry points directly at `src/index.ts`

### BRANCH PROTECTION

- `main` branch is protected — never push directly to main
- All changes must go through pull requests
- CI must pass before merging

### GIT WORKTREES FOR BIG CHANGES

- Use `git worktree add` for multi-file features or refactors
- Keeps main checkout clean while iterating on a feature branch

### VERIFY BEFORE PUSHING

- Run `bun test` locally before every push
- Do NOT push broken code — fix locally first

### ERROR HANDLING

- Always write proper error handling with human-readable messages
- Include context: what failed, why, and what to do about it
- Never swallow errors silently

## Build Commands

```bash
bun install                    # Install dependencies
bun test                       # Run all tests
bun run dev                    # Run CLI in development
bun link                       # Link binary globally
```

## Project Structure

```
uae-news-digest/
├── src/
│   ├── index.ts              # CLI entry point (Commander-based)
│   ├── lib.ts                # Core logic: RSS parsing, scoring, dedup, translation, rendering
│   └── core.ts               # Public API re-exports
├── test/
│   └── lib.test.ts           # Unit tests
├── .github/
│   └── workflows/            # CI
└── package.json
```

## Architecture Overview

```
RSS feed (Google News)
  → [lib.ts] parseRss → RssItem[]
  → [lib.ts] buildDigest → scored, deduped DigestItem[]
  → [lib.ts] translateDeepL (optional, when --target-lang set + DEEPL_AUTH_KEY)
  → [lib.ts] renderDigest → formatted text output
```

### Translation

- Default output is English (no translation)
- Translation is opt-in: pass `--target-lang <code>` with `DEEPL_AUTH_KEY` env var
- Uses DeepL Free API for translation

### Public API (`./core` export)

```typescript
import { parseRss, buildDigest, runDigest, renderDigest } from "@drakulavich/uae-news-digest/core";
```

## Code Style

- **TypeScript**: Strict mode
- **No build step**: Bun runs `.ts` directly
- **Imports**: Use relative paths (`./lib`, not `src/lib`)
- **Progress/errors**: `console.error()` — **Success output**: `console.log()`
