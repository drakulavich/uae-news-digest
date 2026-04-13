# Source Tier Scoring

## Problem

`scoreItem` gives all preferred sources a flat +3 regardless of quality. This lumps international wire services (Reuters, AP, BBC) together with local outlets (Gulf News, Khaleej Times). International sources with higher editorial standards and broader coverage should outrank local ones.

## Design

### Three tiers

Replace `DEFAULT_PREFER_RE` with three tier regexes in `src/scoring.ts`:

**Tier 1 — International wire / global press (+4):**
Reuters, AP News, BBC, New York Times, Washington Post, The Economist, Financial Times, Bloomberg, Wall Street Journal, The Guardian

**Tier 2 — Regional / pan-regional (+3):**
Al Jazeera, Deutsche Welle (DW), France24, CNBC, CNN, Anadolu

**Tier 3 — Local outlets (+2):**
Gulf News, Khaleej Times, The National, Zawya

### Scoring logic

Tiers are mutually exclusive — a source matches at most one tier (checked in order, Tier 1 first). No stacking. Title bonuses (UAE mention, priority topic) remain unchanged.

```typescript
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

### Regex definitions

```typescript
const TIER_1_RE = /(reuters|\bap news\b|associated press|bbc|new york times|nytimes|washington post|the economist|financial times|\bft\.com\b|bloomberg|wall street journal|\bwsj\b|the guardian)/i;
const TIER_2_RE = /(al jazeera|deutsche welle|\bdw\.com\b|france 24|france24|cnbc|cnn|anadolu)/i;
const TIER_3_RE = /(gulf news|khaleej times|the national|zawya)/i;
```

### Remove `preferRe` parameter

`scoreItem` previously accepted an optional `preferRe` regex override. It was unused externally (only `buildDigest` passed it through from `BuildDigestOptions`). Since scoring is now tier-based, the single-regex override no longer makes sense. Remove `preferRe` from:
- `scoreItem` signature
- `BuildDigestOptions` type
- `buildDigest` destructuring and the `scoreItem` call

Exports `TIER_1_RE`, `TIER_2_RE`, `TIER_3_RE` from `scoring.ts` for tests to verify source→tier mapping.

### Max score comparison

| Combination | Before | After |
|-------------|--------|-------|
| Reuters + UAE + priority | 3+2+2 = 7 | 4+2+2 = 8 |
| Al Jazeera + UAE + priority | 3+2+2 = 7 (if in old list) | 3+2+2 = 8 |
| Gulf News + UAE + priority | 3+2+2 = 7 | 2+2+2 = 6 |

Sorting impact: international sources on UAE-related breaking news rank higher than local UAE outlets on the same topic. This matches the user's intent.

## Tests

Update `test/lib.test.ts` `scoreItem` describe block:

- **Tier 1 sources get +4** — Reuters, BBC, NYT, AP News
- **Tier 2 sources get +3** — Al Jazeera, DW, CNN
- **Tier 3 sources get +2** — Gulf News, Khaleej Times
- **Unknown sources get +0** — unchanged
- **Tier 1 + UAE + priority stacks to 8** — was 7
- **Tiers are mutually exclusive** — a source in Tier 1 does not also get Tier 2/3 bonus

Update existing tests:
- `preferred source gets +3` → `tier 1 source gets +4` (update Reuters expectation from 3 to 4, AP News from 3 to 4)
- `preferred source + UAE + priority stacks` → update expected value from 7 to 8

## Files Changed

| File | What |
|------|------|
| `src/scoring.ts` | Add `TIER_1_RE`, `TIER_2_RE`, `TIER_3_RE`; rewrite `scoreItem`; remove `preferRe` parameter; remove `DEFAULT_PREFER_RE` export |
| `src/digest.ts` | Remove `preferRe` import and field from `BuildDigestOptions`, remove from destructuring, update `scoreItem` call |
| `test/lib.test.ts` | Update `scoreItem` tests for new tier values |
