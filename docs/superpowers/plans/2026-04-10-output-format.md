# Output Format Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `--format <json|table>` with `--json` boolean flag, default to human-readable text output with "Xh ago" timestamps, and add an agent-friendly JSON envelope.

**Architecture:** Add `now` parameter to `renderDigest` for deterministic "Xh ago" computation. Replace CLI output formatting in `index.ts` to use `process.stdout.write` for data and `console.error` for diagnostics. Build JSON envelope inline in the CLI action.

**Tech Stack:** Bun, TypeScript, Commander

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib.ts` | Modify | Add `now` param to `renderDigest`, add "Xh ago" suffix |
| `src/index.ts` | Modify | Replace `--format` with `--json`, build JSON envelope, use `process.stdout.write` |
| `test/lib.test.ts` | Modify | Update `renderDigest` tests for "Xh ago" |
| `README.md` | Modify | Update flags, examples, sample output |

---

### Task 1: Add "Xh ago" to renderDigest

**Files:**
- Modify: `src/lib.ts:293-304`
- Modify: `test/lib.test.ts:307-343`

- [ ] **Step 1: Update renderDigest tests to expect "Xh ago" suffix**

In `test/lib.test.ts`, replace the `describe('renderDigest', ...)` block (lines 307-343) with:

```typescript
describe('renderDigest', () => {
  const now = new Date('2026-03-22T08:00:00Z');
  const sampleItem: DigestItem = {
    score: 5,
    publishedAt: new Date('2026-03-22T07:00:00Z'),
    title: 'Dubai property sector shows early signs of weakness',
    source: 'Reuters',
    key: makeKey('Dubai property sector shows early signs of weakness', 'Reuters'),
  };

  test('prints digest with hours ago suffix', () => {
    const output = renderDigest([sampleItem], undefined, now);
    expect(output).toContain('🇦🇪 UAE Latest News Digest');
    expect(output).toContain('📉');
    expect(output).toContain('Dubai property sector shows early signs of weakness');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('shows 0h ago for very recent items', () => {
    const recentItem: DigestItem = {
      ...sampleItem,
      publishedAt: new Date('2026-03-22T07:45:00Z'),
    };
    const output = renderDigest([recentItem], undefined, now);
    expect(output).toContain('Reuters, 0h ago');
  });

  test('uses DeepL translations when provided', () => {
    const translations = new Map([
      ['Dubai property sector shows early signs of weakness', 'Сектор недвижимости Дубая'],
    ]);
    const output = renderDigest([sampleItem], translations, now);
    expect(output).toContain('Сектор недвижимости Дубая');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('keeps original title when translations map has no entry', () => {
    const translations = new Map<string, string>();
    const output = renderDigest([sampleItem], translations, now);
    expect(output).toContain('Dubai property sector shows early signs of weakness');
  });

  test('prints empty message for no items', () => {
    const output = renderDigest([]);
    expect(output).toContain('No significant news in the check window.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: FAIL — `renderDigest` doesn't accept `now` parameter yet, and output doesn't contain "Xh ago"

- [ ] **Step 3: Update renderDigest to accept `now` and add "Xh ago"**

In `src/lib.ts`, replace the `renderDigest` function (lines 293-304) with:

```typescript
export function renderDigest(items: DigestItem[], translations?: Map<string, string>, now: Date = new Date()): string {
  if (items.length === 0) {
    return '🇦🇪 UAE Latest News Digest\n\n• No significant news in the check window.';
  }

  const lines = ['🇦🇪 UAE Latest News Digest', ''];
  for (const item of items) {
    const title = translations?.get(item.title) ?? item.title;
    const hoursAgo = Math.round((now.getTime() - item.publishedAt.getTime()) / 3_600_000);
    lines.push(`${emojiFor(item.title)} ${title} (${item.source}, ${hoursAgo}h ago)`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib.ts test/lib.test.ts
git commit -m "feat: add hours-ago suffix to renderDigest output"
```

---

### Task 2: Replace --format with --json in CLI

**Files:**
- Modify: `src/index.ts:18,29,48,77,117-129`

- [ ] **Step 1: Replace --format option with --json**

In `src/index.ts`, replace line 18:

```typescript
  .option('--format <format>', 'output format: json, table', 'json')
```

with:

```typescript
  .option('--json', 'output as JSON', false)
```

- [ ] **Step 2: Update help text examples**

In `src/index.ts`, replace the `.addHelpText` block (lines 26-30):

```typescript
  .addHelpText('after', `
Example:
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --dry-run --format table
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE`);
```

with:

```typescript
  .addHelpText('after', `
Example:
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --dry-run
  uae-news-digest --json
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE`);
```

- [ ] **Step 3: Update manifest flags**

In `src/index.ts`, replace the flags array in the manifest command (line 48):

```typescript
          flags: ['--hours <n>', '--limit <n>', '--state-file <path>', '--target-lang <code>', '--dry-run', '--format <json|table>'],
```

with:

```typescript
          flags: ['--hours <n>', '--limit <n>', '--state-file <path>', '--target-lang <code>', '--dry-run', '--json'],
```

- [ ] **Step 4: Replace output formatting in main action**

In `src/index.ts`, delete `const fmt = options.format ?? 'json';` (line 77).

Then replace the output block (lines 117-129):

```typescript
    if (fmt === 'json') {
      console.log(JSON.stringify({
        output: result.output,
        items: result.digest.length,
        digest: result.digest.map(d => ({ title: d.title, source: d.source, score: d.score, publishedAt: d.publishedAt.toISOString() })),
        dryRun: options.dryRun,
      }));
    } else {
      console.log(result.output);
      if (options.dryRun) {
        console.log('\n(dry run — state file not updated)');
      }
    }
```

with:

```typescript
    if (options.json) {
      const now = new Date();
      process.stdout.write(JSON.stringify({
        tool: 'uae-news-digest',
        version: '0.1.0',
        query: { hours, limit, targetLang: options.targetLang ?? null },
        count: result.digest.length,
        items: result.digest.map(d => ({
          title: d.title,
          source: d.source,
          score: d.score,
          publishedAt: d.publishedAt.toISOString(),
          hoursAgo: Math.round((now.getTime() - d.publishedAt.getTime()) / 3_600_000),
        })),
      }, null, 2) + '\n');
    } else {
      process.stdout.write(result.output + '\n');
    }

    if (options.dryRun) {
      console.error('(dry run — state file not updated)');
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: replace --format with --json flag, add agent-friendly JSON envelope"
```

---

### Task 3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README usage, flags table, and example output**

Replace the Usage section, flags table, Example Output section, and the pipeline diagram in `README.md`.

Usage section:

```markdown
## Usage

\`\`\`bash
uae-news-digest                                    # fetch + print in English
uae-news-digest --dry-run                           # preview without updating state
uae-news-digest --hours 12 --limit 10               # last 12h, max 10 items
uae-news-digest --json                              # output as JSON for agents/scripts
DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE  # translate to German via DeepL
\`\`\`
```

Flags table:

```markdown
| Flag | Default | Description |
|------|---------|-------------|
| `--hours <n>` | `36` | Lookback window in hours |
| `--limit <n>` | `6` | Max items in digest |
| `--target-lang <code>` | | DeepL target language (e.g. `DE`, `FR`, `JA`). Requires `DEEPL_AUTH_KEY` |
| `--state-file <path>` | `./seen_titles.txt` | Seen-items state file |
| `--timeout-ms <n>` | `15000` | RSS fetch timeout |
| `--dry-run` | `false` | Preview without updating state |
| `--json` | `false` | Output as JSON (agent-friendly envelope) |
```

Example Output section:

```markdown
## Example Output

\`\`\`
🇦🇪 UAE Latest News Digest

🛡️ UAE intercepts 79 Iranian strike assets (The National, 2h ago)
📉 Dubai property sales drop more than 30% (Anadolu Ajansı, 5h ago)
⛴️ Container ship incident at Khor Fakkan (Reuters, 3h ago)
✈️ Abu Dhabi airport reopens after rain (Khaleej Times, 1h ago)
🌧️ Unstable weather hits some emirates (Gulf News, 4h ago)
🛢️ Oil prices: OPEC+ mulls output increase (CNBC, 6h ago)
\`\`\`
```

Pipeline diagram — replace the Translate line:

```
  ├── Translate ─── DeepL API (optional, when --target-lang set)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for --json flag and hours-ago output"
```

---

### Task 4: Update runDigest tests for "Xh ago" in output

**Files:**
- Modify: `test/lib.test.ts:345-430`

- [ ] **Step 1: Update runDigest test assertions to expect "Xh ago"**

The `runDigest` tests check `result.output` which now includes "Xh ago" suffixes. Update the assertions that check for specific title content. In each test, the `now` is `2026-03-22T08:00:00Z` and items are published at `07:00` (1h ago) and `06:00` (2h ago).

In `test/lib.test.ts`, replace the `describe('runDigest', ...)` block (lines 345-430) with:

```typescript
describe('runDigest', () => {
  const rssXml = `<?xml version="1.0"?><rss><channel>
    <item><title>Dubai airport reopens after rain</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source url="https://example.com">Reuters</source></item>
    <item><title>Abu Dhabi market overview</title><pubDate>Sun, 22 Mar 2026 06:00:00 GMT</pubDate><source url="https://example.com">Gulf News</source></item>
  </channel></rss>`;

  test('uses DeepL when key and targetLang are provided', async () => {
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
      deeplAuthKey: 'fake-key',
      targetLang: 'RU',
      fetchFn: mockFetch,
    });

    expect(result.output).toContain('Аэропорт Дубая возобновил работу после дождя');
    expect(result.output).toContain('Обзор рынка Абу-Даби');
    expect(result.output).toContain('1h ago');
    expect(result.output).toContain('2h ago');
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
      deeplAuthKey: 'fake-key',
      targetLang: 'RU',
      fetchFn: mockFetch,
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('Reuters, 1h ago');
    expect(result.digest).toHaveLength(2);
  });

  test('skips DeepL when no targetLang', async () => {
    let deeplCalled = false;
    const mockFetch = (async (...args: any[]) => {
      deeplCalled = true;
      return mockDeepLFetch(['x', 'y'])(...args as [any]);
    }) as typeof globalThis.fetch;

    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      deeplAuthKey: 'fake-key',
      fetchFn: mockFetch,
    });

    expect(deeplCalled).toBe(false);
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('1h ago');
  });

  test('skips DeepL when no auth key', async () => {
    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('Reuters, 1h ago');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add test/lib.test.ts
git commit -m "test: update runDigest tests for hours-ago output"
```

---

### Task 5: Verify everything works end-to-end

- [ ] **Step 1: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass

- [ ] **Step 2: Verify --help output**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun src/index.ts --help`
Expected: Shows `--json` flag (not `--format`), no `--no-translate`

- [ ] **Step 3: Verify --json flag works**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun src/index.ts --json --dry-run 2>/dev/null | head -5`
Expected: JSON output starting with `{ "tool": "uae-news-digest"` and containing `"version"`, `"query"`, `"items"`
