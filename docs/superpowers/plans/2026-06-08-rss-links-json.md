# RSS Links in JSON Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Google News RSS item links through the digest pipeline and expose `googleUrl` plus reserved `originalUrl` fields in JSON output.

**Architecture:** `parseRss()` reads item `<link>` values into `RssItem`; `buildDigest()` copies URL metadata into `DigestItem`; the CLI JSON mapper emits URL fields only when `googleUrl` exists. Text rendering, state keys, deduplication, and redirect resolution remain unchanged.

**Tech Stack:** Bun runtime, TypeScript, `fast-xml-parser`, `bun:test`, Commander CLI.

---

## File Structure

- Modify `src/rss.ts`: add URL fields to `RssItem` and parse RSS item `<link>`.
- Modify `src/digest.ts`: add URL fields to `DigestItem` and copy them from source items.
- Modify `src/index.ts`: include `googleUrl` and `originalUrl` in JSON item output when available.
- Modify `test/unit/rss.test.ts`: assert link parsing.
- Modify `test/integration/digest.test.ts`: assert URL carry-through.
- Modify `test/cli.test.ts`: feed linked RSS fixtures and assert JSON URL fields.

### Task 1: Parse RSS Links

**Files:**
- Modify: `src/rss.ts`
- Test: `test/unit/rss.test.ts`

- [ ] **Step 1: Write the failing RSS parser test**

Update `test/unit/rss.test.ts` first test XML to include `<link>` and expect URL fields:

```ts
test('extracts items, source text, and link', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title>Dubai market rises</title><link>https://news.google.com/rss/articles/example</link><pubDate>Sun, 22 Mar 2026 04:00:00 GMT</pubDate><source url="https://example.com">Reuters</source></item></channel></rss>`;
  const items = parseRss(xml);
  expect(items).toHaveLength(1);
  expect(items[0]).toEqual({
    title: 'Dubai market rises',
    googleUrl: 'https://news.google.com/rss/articles/example',
    originalUrl: null,
    pubDate: 'Sun, 22 Mar 2026 04:00:00 GMT',
    source: 'Reuters',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/unit/rss.test.ts`

Expected: FAIL because `parseRss()` does not include `googleUrl` or `originalUrl`.

- [ ] **Step 3: Implement RSS link parsing**

Update `src/rss.ts`:

```ts
export type RssItem = {
  title: string;
  pubDate?: string;
  source?: string;
  googleUrl?: string;
  originalUrl?: string | null;
};
```

Inside the `items.map()` callback, read the item link once and spread URL fields only when present:

```ts
return items.map((item: any) => {
  const googleUrl = item.link ? String(item.link) : undefined;

  return {
    title: normalizeWhitespace(String(item.title ?? '')),
    ...(googleUrl ? { googleUrl, originalUrl: null } : {}),
    pubDate: item.pubDate ? String(item.pubDate) : undefined,
    source: typeof item.source === 'string'
      ? item.source
      : item.source?.['#text']
        ? String(item.source['#text'])
        : undefined,
  };
});
```

- [ ] **Step 4: Run parser tests**

Run: `bun test test/unit/rss.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rss.ts test/unit/rss.test.ts
git commit -m "feat: preserve RSS item links"
```

### Task 2: Carry Links Through Digest Items

**Files:**
- Modify: `src/digest.ts`
- Test: `test/integration/digest.test.ts`

- [ ] **Step 1: Write the failing digest carry-through test**

Add this test to `test/integration/digest.test.ts`:

```ts
test('preserves URL metadata on selected digest items', () => {
  const now = new Date('2026-03-22T08:00:00Z');
  const items: RssItem[] = [
    {
      title: 'Dubai airport reopens after rain',
      pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT',
      source: 'Reuters',
      googleUrl: 'https://news.google.com/rss/articles/dubai-airport',
      originalUrl: null,
    },
  ];

  const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });

  expect(digest).toHaveLength(1);
  expect(digest[0]?.googleUrl).toBe('https://news.google.com/rss/articles/dubai-airport');
  expect(digest[0]?.originalUrl).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/integration/digest.test.ts`

Expected: FAIL because `DigestItem` does not include URL fields.

- [ ] **Step 3: Implement digest URL carry-through**

Update `DigestItem` in `src/digest.ts`:

```ts
export type DigestItem = {
  score: number;
  publishedAt: Date;
  title: string;
  source: string;
  key: string;
  googleUrl?: string;
  originalUrl?: string | null;
};
```

Add URL metadata to `digestItem` construction:

```ts
const digestItem: DigestItem = {
  score: scoreItem(title, source),
  publishedAt,
  title,
  source,
  key,
  ...(item.googleUrl ? { googleUrl: item.googleUrl, originalUrl: item.originalUrl ?? null } : {}),
};
```

- [ ] **Step 4: Run digest tests**

Run: `bun test test/integration/digest.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/digest.ts test/integration/digest.test.ts
git commit -m "feat: carry RSS links through digest"
```

### Task 3: Emit URL Fields in CLI JSON

**Files:**
- Modify: `src/index.ts`
- Test: `test/cli.test.ts`

- [ ] **Step 1: Write the failing CLI JSON test changes**

Update `RSS_XML` in `test/cli.test.ts` so both items have links:

```ts
const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>Dubai airport reopens after rain</title><link>https://news.google.com/rss/articles/dubai-airport</link><pubDate>${oneHourAgo}</pubDate><source url="https://example.com">Reuters</source></item>
  <item><title>Abu Dhabi market overview</title><link>https://news.google.com/rss/articles/abu-dhabi-market</link><pubDate>${twoHoursAgo}</pubDate><source url="https://example.com">Gulf News</source></item>
</channel></rss>`;
```

Update the `--json produces agent-friendly envelope` item key and object assertions:

```ts
expect(Object.keys(parsed.items[0]).sort()).toEqual(['googleUrl', 'hoursAgo', 'originalUrl', 'publishedAt', 'score', 'source', 'title']);
expect(parsed.items[0]).toEqual({
  title: 'Dubai airport reopens after rain',
  source: 'Reuters',
  score: 8,
  publishedAt: new Date(oneHourAgo).toISOString(),
  hoursAgo: 1,
  googleUrl: 'https://news.google.com/rss/articles/dubai-airport',
  originalUrl: null,
});
expect(parsed.items[1]).toEqual({
  title: 'Abu Dhabi market overview',
  source: 'Gulf News',
  score: 6,
  publishedAt: new Date(twoHoursAgo).toISOString(),
  hoursAgo: 2,
  googleUrl: 'https://news.google.com/rss/articles/abu-dhabi-market',
  originalUrl: null,
});
```

- [ ] **Step 2: Run CLI test to verify it fails**

Run: `bun test test/cli.test.ts --timeout 30000`

Expected: FAIL because JSON item output omits URL fields.

- [ ] **Step 3: Implement JSON URL output**

In `src/index.ts`, update the JSON item mapper:

```ts
items: result.digest.map(d => ({
  title: d.title,
  source: d.source,
  score: d.score,
  publishedAt: d.publishedAt.toISOString(),
  hoursAgo: Math.round((now.getTime() - d.publishedAt.getTime()) / 3_600_000),
  ...(d.googleUrl ? { googleUrl: d.googleUrl, originalUrl: d.originalUrl ?? null } : {}),
})),
```

- [ ] **Step 4: Run CLI tests**

Run: `bun test test/cli.test.ts --timeout 30000`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/cli.test.ts
git commit -m "feat: expose RSS links in JSON output"
```

### Task 4: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run full test suite**

Run: `bun test`

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: TypeScript exits successfully.

- [ ] **Step 3: Inspect final diff**

Run: `git status --short`

Expected: clean worktree after task commits.

Run: `git log --oneline -4`

Expected: recent commits include:

```text
feat: expose RSS links in JSON output
feat: carry RSS links through digest
feat: preserve RSS item links
docs: design RSS links in JSON output
```
