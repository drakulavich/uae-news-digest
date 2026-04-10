# English Default & Direct Binary Execution

## Problem

1. `bun link` installs a binary pointing to `dist/index.js`, which requires a build step. Bun runs TypeScript natively, so there's no reason for a build.
2. The tool defaults to Russian keyword fallback translation when DeepL is unavailable. The default should be English (the source language).

## Design

### Binary: point to source directly

- Change `package.json` `bin` to `./src/index.ts`
- Remove the `build` script (no longer needed)
- Remove `"files": ["dist"]` (no dist to publish)

### Translation: opt-in only

**Before:** Default behavior translates to Russian via keyword fallback. `--no-translate` disables it. `--target-lang` defaults to `RU`.

**After:** Default behavior shows English. Translation only happens when `--target-lang <code>` is explicitly passed AND `DEEPL_AUTH_KEY` is set.

#### Changes to `src/lib.ts`

- **Delete** the entire `REPLACEMENTS` array (~160 lines, lines 294-456)
- **Delete** the `translateTitleRu` function (lines 458-467)
- **Simplify `renderDigest`**: remove the `translateTitleRu` fallback branch. When no DeepL translation exists for a title, use the original English title.
- **Simplify `runDigest`**:
  - Remove `translate` option from `RunDigestOptions` (no longer needed; presence of `targetLang` + `deeplAuthKey` controls translation)
  - Only call `translateDeepL` when both `targetLang` and `deeplAuthKey` are provided
  - When DeepL fails (returns null), fall back to English (not Russian keywords)
  - Pass `targetLang` to `renderDigest` only when translations exist

#### Changes to `src/index.ts`

- Remove `--no-translate` option
- Remove `--target-lang` default value (`'RU'`). Make it no-default: only set when user passes it.
- Update help text: remove reference to "keyword fallback (RU)"
- Simplify main action: remove `translate` variable, derive translation intent from `options.targetLang` presence
- When `--target-lang` is passed but `DEEPL_AUTH_KEY` is missing, print error and exit

#### Changes to `src/core.ts`

- Remove `translateTitleRu` from exports

#### Changes to `test/lib.test.ts`

- **Delete** the entire `translateTitleRu` describe block
- **Update** `renderDigest` tests: remove Russian fallback expectations, add English fallback tests
- **Update** `runDigest` tests: "falls back to keyword translation" becomes "falls back to English", "skips DeepL when translate=false" becomes test for no targetLang
- Remove `translateTitleRu` from imports
- Update emojiFor Russian test (keep it - emojiFor should still work with any language)

#### Changes to `package.json`

- `"bin"`: `"./src/index.ts"`
- Remove `"build"` script
- Remove `"files": ["dist"]`

## Files Changed

1. `package.json` — bin, scripts, files
2. `src/lib.ts` — delete REPLACEMENTS + translateTitleRu, simplify renderDigest + runDigest
3. `src/index.ts` — remove --no-translate, --target-lang default, simplify action
4. `src/core.ts` — remove translateTitleRu export
5. `test/lib.test.ts` — update tests for new behavior
