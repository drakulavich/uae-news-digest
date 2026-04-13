# Source Tier Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat +3 preferred source score with three tiers (international +4, regional +3, local +2), so international wire services rank above local outlets.

**Architecture:** Three mutually exclusive tier regexes in `src/scoring.ts`. `scoreItem` checks tier 1 → 2 → 3 in order. Remove the unused `preferRe` parameter from the public API.

**Tech Stack:** TypeScript, Bun

---

## File Map

| File | Action | What |
|------|--------|------|
| `src/scoring.ts` | Modify | Replace `DEFAULT_PREFER_RE` with 3 tier regexes, rewrite `scoreItem`, drop `preferRe` param |
| `src/digest.ts` | Modify | Remove `preferRe` from `BuildDigestOptions`, stop passing to `scoreItem` |
| `src/lib.ts` | No change | Barrel — `scoreItem` still exported, no new exports needed |
| `test/lib.test.ts` | Modify | Update scoreItem tests to reflect new tier values |

---

### Task 1: Rewrite scoring.ts with tiered sources

**Files:**
- Modify: `src/scoring.ts`
- Modify: `test/lib.test.ts`

- [ ] **Step 1: Update scoreItem tests to expect tier values**

In `test/lib.test.ts`, replace the `describe('scoreItem', ...)` block (lines 167-189) with:

```typescript
describe('scoreItem', () => {
  test('tier 1 international sources get +4', () => {
    expect(scoreItem('Generic headline', 'Reuters')).toBe(4);
    expect(scoreItem('Generic headline', 'BBC')).toBe(4);
    expect(scoreItem('Generic headline', 'AP News')).toBe(4);
    expect(scoreItem('Generic headline', 'The New York Times')).toBe(4);
    expect(scoreItem('Generic headline', 'The Washington Post')).toBe(4);
    expect(scoreItem('Generic headline', 'The Economist')).toBe(4);
    expect(scoreItem('Generic headline', 'Financial Times')).toBe(4);
    expect(scoreItem('Generic headline', 'Bloomberg')).toBe(4);
    expect(scoreItem('Generic headline', 'Wall Street Journal')).toBe(4);
    expect(scoreItem('Generic headline', 'The Guardian')).toBe(4);
  });

  test('tier 2 regional sources get +3', () => {
    expect(scoreItem('Generic headline', 'Al Jazeera')).toBe(3);
    expect(scoreItem('Generic headline', 'Deutsche Welle')).toBe(3);
    expect(scoreItem('Generic headline', 'France 24')).toBe(3);
    expect(scoreItem('Generic headline', 'CNBC')).toBe(3);
    expect(scoreItem('Generic headline', 'CNN')).toBe(3);
    expect(scoreItem('Generic headline', 'Anadolu Agency')).toBe(3);
  });

  test('tier 3 local sources get +2', () => {
    expect(scoreItem('Generic headline', 'Gulf News')).toBe(2);
    expect(scoreItem('Generic headline', 'Khaleej Times')).toBe(2);
    expect(scoreItem('Generic headline', 'The National')).toBe(2);
    expect(scoreItem('Generic headline', 'Zawya')).toBe(2);
  });

  test('unknown source gets 0 (source-only)', () => {
    expect(scoreItem('Generic headline about nothing', 'Unknown Blog')).toBe(0);
  });

  test('UAE mention in title gets +2', () => {
    expect(scoreItem('Dubai sees growth', 'Unknown Blog')).toBe(2);
    expect(scoreItem('Abu Dhabi airport news', 'Unknown Blog')).toBe(4);
  });

  test('priority keyword gets +2', () => {
    expect(scoreItem('Rain expected tomorrow', 'Unknown')).toBe(2);
    expect(scoreItem('Missile launch detected', 'Unknown')).toBe(2);
  });

  test('tier 1 + UAE + priority stacks to 8', () => {
    expect(scoreItem('Dubai airport closed due to rain', 'Reuters')).toBe(8);
  });

  test('tier 3 + UAE + priority stacks to 6', () => {
    expect(scoreItem('Dubai airport closed due to rain', 'Gulf News')).toBe(6);
  });

  test('tiers are mutually exclusive (no double-counting)', () => {
    // Reuters matches only tier 1, not tier 2 or tier 3
    expect(scoreItem('Generic headline', 'Reuters')).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test test/lib.test.ts`
Expected: FAIL — current scoring returns 3 for Reuters/AP News, and several sources (BBC variants, Bloomberg, WSJ, etc.) are not matched.

- [ ] **Step 3: Rewrite src/scoring.ts**

Replace the entire contents of `src/scoring.ts` with:

```typescript
const TIER_1_RE = /(reuters|\bap news\b|associated press|bbc|new york times|nytimes|washington post|the economist|financial times|\bft\.com\b|bloomberg|wall street journal|\bwsj\b|the guardian)/i;
const TIER_2_RE = /(al jazeera|deutsche welle|\bdw\.com\b|france 24|france24|cnbc|cnn|anadolu)/i;
const TIER_3_RE = /(gulf news|khaleej times|the national|zawya)/i;

const UAE_RE = /(UAE|Dubai|Abu Dhabi|Sharjah|Ras al-Khaimah|Fujairah)/i;
const PRIORITY_RE = /(weather|rain|missile|drone|airspace|defence|defense|property|market|flight|shipping|Hezbollah|Iran|airport|Hormuz)/i;

const SYNONYMS: Record<string, string> = {
  drone: 'uav', drones: 'uav', uavs: 'uav', uav: 'uav',
  intercept: 'engage', intercepted: 'engage', intercepts: 'engage', engage: 'engage', engaged: 'engage', engages: 'engage',
  missile: 'missile', missiles: 'missile', ballistic: 'missile',
  defence: 'defense', defences: 'defense', defenses: 'defense', defense: 'defense',
  iranian: 'iran', iran: 'iran',
  airport: 'airport', airspace: 'airport', flights: 'flight', flight: 'flight',
  property: 'realestate', housing: 'realestate', realestate: 'realestate',
  rain: 'weather', weather: 'weather', flooding: 'weather', flood: 'weather',
  shipping: 'shipping', hormuz: 'shipping',
  school: 'education', schools: 'education', education: 'education',
  says: '_skip', said: '_skip', report: '_skip', reports: '_skip',
};

function extractWords(title: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'it', 'its', 'by', 'from', 'with', 'as', 'after', 'that', 'this', 'new', 'amid', '_skip']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map(w => SYNONYMS[w] ?? w)
    .filter(w => w.length > 1 && !stop.has(w));
}

export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(extractWords(a));
  const wb = new Set(extractWords(b));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}

export { TIER_1_RE, TIER_2_RE, TIER_3_RE };

export function scoreItem(title: string, source: string): number {
  let score = 0;
  if (TIER_1_RE.test(source)) score += 4;
  else if (TIER_2_RE.test(source)) score += 3;
  else if (TIER_3_RE.test(source)) score += 2;
  if (UAE_RE.test(title)) score += 2;
  if (PRIORITY_RE.test(title)) score += 2;
  return score;
}
```

Note: `DEFAULT_PREFER_RE` is removed. `scoreItem` no longer accepts a `preferRe` parameter.

- [ ] **Step 4: Update src/digest.ts**

In `src/digest.ts`, replace line 2:

```typescript
import { scoreItem, titleSimilarity, DEFAULT_PREFER_RE } from './scoring';
```

with:

```typescript
import { scoreItem, titleSimilarity } from './scoring';
```

Replace the `BuildDigestOptions` type (lines 16-23):

```typescript
export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  skipRe?: RegExp;
  preferRe?: RegExp;
};
```

with:

```typescript
export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  skipRe?: RegExp;
};
```

Replace line 32:

```typescript
  const { seenKeys, hours, limit, now = new Date(), skipRe = DEFAULT_SKIP_RE, preferRe = DEFAULT_PREFER_RE } = options;
```

with:

```typescript
  const { seenKeys, hours, limit, now = new Date(), skipRe = DEFAULT_SKIP_RE } = options;
```

Replace line 49:

```typescript
      score: scoreItem(title, source, preferRe),
```

with:

```typescript
      score: scoreItem(title, source),
```

- [ ] **Step 5: Run all tests**

Run: `cd /Users/anton.yakutovich/personal/repos/uae-news-digest && bun test`
Expected: All tests pass (67 existing + 3 new scoreItem tests = 70 total; the original 5 `scoreItem` tests are replaced by 9 new ones, so count is 67 - 5 + 9 = 71)

- [ ] **Step 6: Commit**

```bash
git add src/scoring.ts src/digest.ts test/lib.test.ts
git commit -m "feat: tier sources by international/regional/local for scoring"
```
