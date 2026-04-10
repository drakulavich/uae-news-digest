# Configurable Region Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--region` flag that selects a Google News RSS region preset (default: `uae`), replacing the hardcoded RSS URL.

**Architecture:** Add `REGION_PRESETS` map and `buildRssUrl` function to lib.ts. Replace `DEFAULT_RSS_URL` with region-based URL resolution in the CLI. `--rss-url` overrides `--region` when explicitly passed.

**Tech Stack:** Bun, TypeScript, Commander

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib.ts` | Modify | Add `REGION_PRESETS`, `buildRssUrl`, remove `DEFAULT_RSS_URL` |
| `src/core.ts` | Modify | Replace `DEFAULT_RSS_URL` export with `REGION_PRESETS` and `buildRssUrl` |
| `src/index.ts` | Modify | Add `--region` flag, resolve URL from region, update manifest/help |
| `test/lib.test.ts` | Modify | Add `buildRssUrl` tests |
| `README.md` | Modify | Add `--region` flag docs |

---

### Task 1: Add REGION_PRESETS and buildRssUrl to lib.ts

**Files:**
- Modify: `src/lib.ts:3`
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Write tests for buildRssUrl**

In `test/lib.test.ts`, add `buildRssUrl` to the import list. Then add this test block after the `emojiFor` tests and before the `translateDeepL` tests:

```typescript
// ── buildRssUrl ───────────────────────────────────────────────

describe('buildRssUrl', () => {
  test('returns Google News RSS URL for known region', () => {
    const url = buildRssUrl('uae');
    expect(url).toContain('news.google.com/rss/search');
    expect(url).toContain('UAE');
    expect(url).toContain('gl=AE');
  });

  test('supports us region', () => {
    const url = buildRssUrl('us');
    expect(url).toContain('gl=US');
    expect(url).toContain('USA');
  });

  test('supports uk region', () => {
    const url = buildRssUrl('uk');
    expect(url).toContain('gl=GB');
  });

  test('supports de region', () => {
    const url = buildRssUrl('de');
    expect(url).toContain('gl=DE');
    expect(url).toContain('hl=de');
  });

  test('supports ru region', () => {
    const url = buildRssUrl('ru');
    expect(url).toContain('gl=RU');
    expect(url).toContain('hl=ru');
  });

  test('is case-insensitive', () => {
    const url = buildRssUrl('UAE');
    expect(url).toContain('gl=AE');
  });

  test('throws for unknown region with available options', () => {
    expect(() => buildRssUrl('xx')).toThrow('Unknown region "xx"');
    expect(() => buildRssUrl('xx')).toThrow('uae');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: FAIL — `buildRssUrl` is not exported from lib.ts

- [ ] **Step 3: Implement REGION_PRESETS and buildRssUrl**

In `src/lib.ts`, replace line 3:

```typescript
export const DEFAULT_RSS_URL = 'https://news.google.com/rss/search?q=UAE+OR+%22Abu+Dhabi%22+OR+Dubai&hl=en&gl=AE&ceid=AE:en';
```

with:

```typescript
export const REGION_PRESETS: Record<string, { q: string; hl: string; gl: string; ceid: string }> = {
  uae: { q: 'UAE OR "Abu Dhabi" OR Dubai', hl: 'en', gl: 'AE', ceid: 'AE:en' },
  us:  { q: 'USA OR "United States"', hl: 'en', gl: 'US', ceid: 'US:en' },
  uk:  { q: 'UK OR "United Kingdom" OR London', hl: 'en', gl: 'GB', ceid: 'GB:en' },
  de:  { q: 'Deutschland OR Berlin OR München', hl: 'de', gl: 'DE', ceid: 'DE:de' },
  ru:  { q: 'Россия OR Москва', hl: 'ru', gl: 'RU', ceid: 'RU:ru' },
};

export function buildRssUrl(region: string): string {
  const preset = REGION_PRESETS[region.toLowerCase()];
  if (!preset) {
    const available = Object.keys(REGION_PRESETS).join(', ');
    throw new Error(`Unknown region "${region}". Available: ${available}`);
  }
  const q = encodeURIComponent(preset.q);
  return `https://news.google.com/rss/search?q=${q}&hl=${preset.hl}&gl=${preset.gl}&ceid=${preset.ceid}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib.ts test/lib.test.ts
git commit -m "feat: add REGION_PRESETS and buildRssUrl function"
```

---

### Task 2: Update core.ts exports

**Files:**
- Modify: `src/core.ts`

- [ ] **Step 1: Replace DEFAULT_RSS_URL with new exports**

In `src/core.ts`, replace `DEFAULT_RSS_URL,` in the export list with:

```typescript
  REGION_PRESETS,
  buildRssUrl,
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/core.ts
git commit -m "refactor: export REGION_PRESETS and buildRssUrl from core"
```

---

### Task 3: Add --region flag to CLI

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update imports**

In `src/index.ts`, replace the import block:

```typescript
import {
  DEFAULT_RSS_URL,
  DEFAULT_STATE_FILE,
  readSeenKeys,
  runDigest,
  validatePositiveNumber,
  writeSeenKeys,
} from './lib';
```

with:

```typescript
import {
  buildRssUrl,
  DEFAULT_STATE_FILE,
  readSeenKeys,
  runDigest,
  validatePositiveNumber,
  writeSeenKeys,
} from './lib';
```

- [ ] **Step 2: Update CLI options**

Replace the `--rss-url` option line:

```typescript
  .option('--rss-url <url>', 'RSS URL to fetch', DEFAULT_RSS_URL)
```

with:

```typescript
  .option('--region <code>', 'news region preset (uae, us, uk, de, ru)', 'uae')
  .option('--rss-url <url>', 'RSS URL (overrides --region)')
```

- [ ] **Step 3: Update help text examples**

Replace the `.addHelpText` block:

```typescript
  .addHelpText('after', `
Example:
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --dry-run
  uae-news-digest --json
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE`);
```

with:

```typescript
  .addHelpText('after', `
Example:
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --region us
  uae-news-digest --json
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE`);
```

- [ ] **Step 4: Update manifest flags**

In the manifest command, replace the flags array:

```typescript
          flags: ['--hours <n>', '--limit <n>', '--state-file <path>', '--target-lang <code>', '--dry-run', '--json'],
```

with:

```typescript
          flags: ['--hours <n>', '--limit <n>', '--region <code>', '--rss-url <url>', '--state-file <path>', '--target-lang <code>', '--dry-run', '--json'],
```

- [ ] **Step 5: Resolve RSS URL from region in main action**

In the main `program.action` handler, add URL resolution after the validation block. Find the line:

```typescript
    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
```

and add before it:

```typescript
    const rssUrl = options.rssUrl ?? buildRssUrl(options.region);
```

Then replace `options.rssUrl` with `rssUrl` in the fetch call. Find:

```typescript
    const response = await fetch(options.rssUrl, {
```

and replace with:

```typescript
    const response = await fetch(rssUrl, {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: add --region flag for configurable news region"
```

---

### Task 4: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update usage examples and flags table**

In the Usage section code block, add a region example. Replace:

```bash
uae-news-digest                                    # fetch + print in English
```

with:

```bash
uae-news-digest                                    # fetch + print UAE news (default)
uae-news-digest --region us                         # US news
```

In the flags table, add `--region` row after `--limit` and update `--rss-url`:

```markdown
| `--region <code>` | `uae` | News region preset (`uae`, `us`, `uk`, `de`, `ru`) |
```

Remove the old `Set DEEPL_AUTH_KEY...` paragraph and replace with:

```markdown
Set `DEEPL_AUTH_KEY` env var and pass `--target-lang` for translation. Use `--rss-url` to override the region preset with a custom RSS URL.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add --region flag to README"
```
