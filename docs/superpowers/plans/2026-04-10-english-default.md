# English Default & Direct Binary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CLI output English by default, make translation opt-in via `--target-lang`, and point the binary at TypeScript source so no build step is needed.

**Architecture:** Remove ~170 lines of Russian keyword fallback code. Simplify `renderDigest` and `runDigest` to show English when no DeepL translations are available. Change `package.json` bin to point directly at `src/index.ts`.

**Tech Stack:** Bun, TypeScript, Commander

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | bin, scripts, files fields |
| `src/lib.ts` | Modify | Delete REPLACEMENTS + translateTitleRu, simplify renderDigest + runDigest, remove `translate` from RunDigestOptions |
| `src/index.ts` | Modify | Remove --no-translate, make --target-lang no-default, simplify main action |
| `src/core.ts` | Modify | Remove translateTitleRu export |
| `test/lib.test.ts` | Modify | Update tests for new behavior |

---

### Task 1: Update package.json

**Files:**
- Modify: `package.json:10-16`

- [ ] **Step 1: Update bin, remove build script and files field**

Change `package.json`:

```json
"bin": {
  "uae-news-digest": "./src/index.ts"
},
"scripts": {
  "dev": "bun src/index.ts",
  "test": "bun test"
},
```

Remove the `"files": ["dist"]` line entirely.

- [ ] **Step 2: Verify package.json is valid**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun run --silent echo 'ok'`
Expected: no parse errors

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: point bin at src/index.ts, remove build step"
```

---

### Task 2: Delete Russian keyword fallback from lib.ts

**Files:**
- Modify: `src/lib.ts:292-467`

- [ ] **Step 1: Delete REPLACEMENTS array and translateTitleRu function**

Delete everything from line 292 (`// -- Keyword Fallback Translation`) through line 467 (end of `translateTitleRu` function). This removes:
- The `REPLACEMENTS` constant (lines 294-456)
- The `translateTitleRu` function (lines 458-467)

The section to delete starts with:
```
// ── Keyword Fallback Translation ───────────────────────────────
```
and ends with:
```
}
```
(closing brace of `translateTitleRu`)

- [ ] **Step 2: Verify lib.ts compiles**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun build --no-bundle src/lib.ts --outdir /dev/null 2>&1 || echo FAIL`

This will fail because `renderDigest` still references `translateTitleRu`. That's expected — we fix it in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/lib.ts
git commit -m "refactor: remove Russian keyword fallback translation"
```

---

### Task 3: Simplify renderDigest and runDigest

**Files:**
- Modify: `src/lib.ts` (renderDigest at ~line 477, runDigest at ~line 499, RunDigestOptions at ~line 38)

- [ ] **Step 1: Remove `translate` from RunDigestOptions**

Change the `RunDigestOptions` type. Remove the `translate?: boolean;` field:

```typescript
export type RunDigestOptions = {
  xml: string;
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  deeplAuthKey?: string;
  targetLang?: string;
  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;
};
```

- [ ] **Step 2: Simplify renderDigest**

Replace the `renderDigest` function. Remove `targetLang` parameter entirely. When no DeepL translation exists for a title, use the original English title:

```typescript
export function renderDigest(items: DigestItem[], translations?: Map<string, string>): string {
  if (items.length === 0) {
    return '🇦🇪 UAE Latest News Digest\n\n• No significant news in the check window.';
  }

  const lines = ['🇦🇪 UAE Latest News Digest', ''];
  for (const item of items) {
    const title = translations?.get(item.title) ?? item.title;
    lines.push(`${emojiFor(item.title)} ${title} (${item.source})`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 3: Simplify runDigest**

Replace the `runDigest` function. Only translate when both `targetLang` and `deeplAuthKey` are provided. Remove the `translate` check and the `?? 'RU'` defaults. When DeepL fails, fall back to English (translations stays undefined):

```typescript
export async function runDigest(options: RunDigestOptions): Promise<{ digest: DigestItem[]; output: string; nextSeenKeys: Set<string> }> {
  const items = parseRss(options.xml);
  const digest = buildDigest(items, {
    seenKeys: options.seenKeys,
    hours: options.hours,
    limit: options.limit,
    now: options.now,
  });

  let translations: Map<string, string> | undefined;

  if (options.targetLang && options.deeplAuthKey && digest.length > 0) {
    const titles = digest.map((d) => d.title);
    const translated = await translateDeepL(titles, options.deeplAuthKey, options.targetLang, options.fetchFn);
    if (translated) {
      translations = new Map();
      for (let i = 0; i < titles.length; i++) {
        translations.set(titles[i]!, translated[i]!);
      }
    }
  }

  return {
    digest,
    output: renderDigest(digest, translations),
    nextSeenKeys: mergeSeenKeys(options.seenKeys, digest),
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib.ts
git commit -m "refactor: simplify renderDigest and runDigest for English default"
```

---

### Task 4: Update CLI (index.ts)

**Files:**
- Modify: `src/index.ts:23-25,76-113`

- [ ] **Step 1: Remove --no-translate and update --target-lang**

Remove line 25 (the `--no-translate` option). Change `--target-lang` to have no default value (remove `'RU'`). Update the help text:

Replace:
```typescript
  .option('--target-lang <code>', 'DeepL target language code (e.g. RU, DE, FR)', 'RU')
  .option('--dry-run', 'print digest without updating state file', false)
  .option('--no-translate', 'skip DeepL, use keyword fallback (RU) or raw English')
```

With:
```typescript
  .option('--target-lang <code>', 'translate via DeepL (requires DEEPL_AUTH_KEY)')
  .option('--dry-run', 'print digest without updating state file', false)
```

- [ ] **Step 2: Update example help text**

Replace:
```typescript
  .addHelpText('after', `
Example:
  uae-news-digest --hours 12 --limit 10 --target-lang DE
  uae-news-digest --dry-run --format table
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang FR`);
```

With:
```typescript
  .addHelpText('after', `
Example:
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --dry-run --format table
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE`);
```

- [ ] **Step 3: Simplify main action translation logic**

In the `program.action` handler, replace the translation setup block. Remove `targetLang` variable (use `options.targetLang` directly). Remove `translate` variable. Add error when `--target-lang` is passed without `DEEPL_AUTH_KEY`:

Replace:
```typescript
    const targetLang: string = options.targetLang ?? 'RU';

    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
```

With:
```typescript
    const deeplAuthKey = process.env.DEEPL_AUTH_KEY;
    if (options.targetLang && !deeplAuthKey) {
      console.error('--target-lang requires DEEPL_AUTH_KEY environment variable.');
      process.exit(1);
    }

    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
```

Then replace the block after `const xml = await response.text();`:

Replace:
```typescript
    const xml = await response.text();
    const deeplAuthKey = process.env.DEEPL_AUTH_KEY;
    const translate = options.translate !== false;

    if (translate && deeplAuthKey) {
      console.error(`Translating to ${targetLang} via DeepL...`);
    }

    const result = await runDigest({
      xml,
      seenKeys,
      hours,
      limit,
      translate,
      deeplAuthKey,
      targetLang,
    });
```

With:
```typescript
    const xml = await response.text();

    if (options.targetLang && deeplAuthKey) {
      console.error(`Translating to ${options.targetLang} via DeepL...`);
    }

    const result = await runDigest({
      xml,
      seenKeys,
      hours,
      limit,
      deeplAuthKey,
      targetLang: options.targetLang,
    });
```

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: make English default, translation opt-in via --target-lang"
```

---

### Task 5: Update core.ts exports

**Files:**
- Modify: `src/core.ts:16`

- [ ] **Step 1: Remove translateTitleRu from exports**

Remove `translateTitleRu,` from the export list in `src/core.ts` (line 16).

- [ ] **Step 2: Commit**

```bash
git add src/core.ts
git commit -m "refactor: remove translateTitleRu from core exports"
```

---

### Task 6: Update tests

**Files:**
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Remove translateTitleRu from imports**

Replace the import block:
```typescript
import {
  buildDigest,
  emojiFor,
  makeKey,
  parseRss,
  readSeenKeys,
  renderDigest,
  runDigest,
  scoreItem,
  titleSimilarity,
  translateDeepL,
  translateTitleRu,
  writeSeenKeys,
  type DeepLResponse,
  type DigestItem,
  type RssItem,
} from '../src/lib';
```

With:
```typescript
import {
  buildDigest,
  emojiFor,
  makeKey,
  parseRss,
  readSeenKeys,
  renderDigest,
  runDigest,
  scoreItem,
  titleSimilarity,
  translateDeepL,
  writeSeenKeys,
  type DeepLResponse,
  type DigestItem,
  type RssItem,
} from '../src/lib';
```

- [ ] **Step 2: Delete the translateTitleRu test block**

Delete the entire `describe('translateTitleRu', ...)` block (lines 237-274).

- [ ] **Step 3: Update renderDigest tests**

Replace the entire `describe('renderDigest', ...)` block with:

```typescript
describe('renderDigest', () => {
  const sampleItem: DigestItem = {
    score: 5,
    publishedAt: new Date('2026-03-22T07:00:00Z'),
    title: 'Dubai property sector shows early signs of weakness',
    source: 'Reuters',
    key: makeKey('Dubai property sector shows early signs of weakness', 'Reuters'),
  };

  test('prints English digest by default', () => {
    const output = renderDigest([sampleItem]);
    expect(output).toContain('🇦🇪 UAE Latest News Digest');
    expect(output).toContain('📉');
    expect(output).toContain('Dubai property sector shows early signs of weakness');
    expect(output).toContain('Reuters');
  });

  test('uses DeepL translations when provided', () => {
    const translations = new Map([
      ['Dubai property sector shows early signs of weakness', 'Сектор недвижимости Дубая демонстрирует первые признаки ослабления'],
    ]);
    const output = renderDigest([sampleItem], translations);
    expect(output).toContain('Сектор недвижимости Дубая демонстрирует первые признаки ослабления');
    expect(output).toContain('Reuters');
  });

  test('falls back to English for missing DeepL entries', () => {
    const translations = new Map<string, string>(); // empty map — no DeepL results
    const output = renderDigest([sampleItem], translations);
    expect(output).toContain('Dubai property sector shows early signs of weakness');
  });

  test('prints empty message for no items', () => {
    const output = renderDigest([]);
    expect(output).toContain('No significant news in the check window.');
  });
});
```

- [ ] **Step 4: Update runDigest tests**

Replace the entire `describe('runDigest', ...)` block with:

```typescript
describe('runDigest', () => {
  const rssXml = `<?xml version="1.0"?><rss><channel>
    <item><title>Dubai airport reopens after rain</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source url="https://example.com">Reuters</source></item>
    <item><title>Abu Dhabi market overview</title><pubDate>Sun, 22 Mar 2026 06:00:00 GMT</pubDate><source url="https://example.com">Gulf News</source></item>
  </channel></rss>`;

  test('uses DeepL when targetLang and key are provided', async () => {
    const mockFetch = mockDeepLFetch([
      'Аэропорт Дубая возобновил работу после дождя',
      'Обзор рынка Абу-Даби',
    ]);

    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      targetLang: 'RU',
      deeplAuthKey: 'fake-key',
      fetchFn: mockFetch,
    });

    expect(result.output).toContain('Аэропорт Дубая возобновил работу после дождя');
    expect(result.output).toContain('Обзор рынка Абу-Даби');
    expect(result.digest).toHaveLength(2);
  });

  test('falls back to English when DeepL fails', async () => {
    const mockFetch = mockDeepLFetchError();

    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      targetLang: 'RU',
      deeplAuthKey: 'fake-key',
      fetchFn: mockFetch,
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).not.toContain('Дубай');
    expect(result.digest).toHaveLength(2);
  });

  test('outputs English when no targetLang is set', async () => {
    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('Abu Dhabi market overview');
  });

  test('skips DeepL when no auth key', async () => {
    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      targetLang: 'RU',
      // No deeplAuthKey
    });

    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).not.toContain('Дубай');
  });
});
```

- [ ] **Step 5: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add test/lib.test.ts
git commit -m "test: update tests for English default behavior"
```

---

### Task 7: Re-link and verify binary

- [ ] **Step 1: Re-link the package**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun link`

- [ ] **Step 2: Verify the binary works**

Run: `uae-news-digest --help`
Expected: Help output with no `--no-translate` option, `--target-lang` has no default shown

- [ ] **Step 3: Run all tests one final time**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass
