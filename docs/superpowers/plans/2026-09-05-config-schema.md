# Config Schema + Heuristics in Config (PR 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written topics validator with a `zod` schema that also carries every scoring / dedupe / importance / emoji / skip heuristic, ship the current UAE knowledge as a built-in `default.json`, and make every pipeline module read its heuristics from a config slice instead of module-level constants.

**Architecture:** A new `src/config/` folder owns the schema (`schema.ts`), the loader and built-in default (`load.ts`, `default.json`). A tiny `src/terms.ts` provides one Unicode-aware term matcher used by every list (markers, skip, boosts, emoji, `--match`). Heuristics are threaded top-down first (CLI passes `DEFAULT_CONFIG`, signatures gain a `heuristics` parameter, behaviour unchanged), then each module is switched to read its slice. Region mode and topics mode both keep working in this PR; the CLI, the JSON envelope, and the text output do not change shape. Old `src/topics.ts` is deleted at the end.

**Tech Stack:** Bun 1.3.x, TypeScript strict, `zod` 4.x (new runtime dependency), `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-05-unified-config-refactor-design.md` — sections 1 (Config schema) and "Staging → PR 1".

## Global Constraints

- Bun only: `Bun.file`, `Bun.write`, `Bun.$`; TypeScript is executed directly, no build step.
- `main` is protected: work on a branch in a worktree, open a PR, CI must pass.
- Run `bun test` and `bun run typecheck` before every push.
- Errors are human-readable: what failed, why, what to do. Never swallow errors.
- `console.log` for results, `console.error` for progress/errors.
- Relative imports (`./config/schema`, not `src/config/schema`).
- This PR keeps CLI output byte-identical for region mode (the golden fixture `test/fixtures/cli-default-output.txt` must still pass unchanged).
- Accepted behaviour deltas in this PR (record them in CHANGELOG):
  - All term lists match as whole words with optional `s`/`es` plural (`*` suffix = prefix match). Previously scoring/emoji/skip used raw substring or unbounded regex, so e.g. "rain" matched "Ukraine".
  - A topics config without heuristic sections now gets neutral heuristics (no boosts, no Important block, `•` emoji, no skip list). Previously UAE heuristics applied to every config.
  - `locale` is required in the config file (it used to default to UAE).
  - Russian emoji terms are dropped from the built-in list (titles are never translated before emoji lookup, so they were dead data).

---

## File map

| File | Responsibility | Action |
|---|---|---|
| `src/terms.ts` | `escapeRegExp`, `termRegExp`, `matchesTerm`, `findTerms`, `displayTerm` | Create |
| `src/config/schema.ts` | `zod` schema, `parseConfig`, inferred types | Create |
| `src/config/default.json` | Built-in UAE config (today's lists and weights) | Create |
| `src/config/load.ts` | `DEFAULT_CONFIG`, `loadConfig`, `resolveConfigPath` | Create |
| `src/scoring.ts` | `scoreItem(title, source, scoring)`, `titleSimilarity(a, b, dedupe)` | Modify |
| `src/importance.ts` | `scoreImportance(title, importance)`, `importanceThreshold` | Modify |
| `src/digest.ts` | `BuildDigestOptions.heuristics`, skip list and threshold from config | Modify |
| `src/render.ts` | `emojiFor(title, rules)`, render functions take `heuristics` | Modify |
| `src/pipeline.ts` | `RunDigestOptions.heuristics`; topical run reads `opts.config` | Modify |
| `src/index.ts` | Imports from `./config/load`, passes `DEFAULT_CONFIG` / user config | Modify |
| `src/lib.ts`, `src/core.ts` | Export new config API, drop removed symbols | Modify |
| `src/topics.ts` | Superseded by `src/config/*` | Delete |
| `tsconfig.json` | `resolveJsonModule: true` | Modify |
| `test/unit/terms.test.ts` | Matcher behaviour | Create |
| `test/unit/config-schema.test.ts` | Schema acceptance/rejection | Create |
| `test/unit/config-load.test.ts` | File loading + discovery (ported from `topics.test.ts`) | Create |
| `test/unit/default-config.test.ts` | Built-in config validates and carries expected sections | Create |
| `test/unit/topics.test.ts` | Ported to `config-load.test.ts` | Delete |
| `test/unit/{scoring,importance,render}.test.ts`, `test/integration/*.test.ts`, `test/cli.test.ts` | Pass config slices | Modify |

---

### Task 0: Worktree, dependency, baseline

**Files:**
- Modify: `package.json` (dependency added by `bun add`), `bun.lock`, `tsconfig.json`

- [ ] **Step 1: Create the worktree and branch**

```bash
cd /Users/anton/Personal/repos/uae-news-digest
git fetch origin
git worktree add ../uae-news-digest-config-schema -b refactor/config-schema origin/main
cd ../uae-news-digest-config-schema
bun install --frozen-lockfile
```

- [ ] **Step 2: Confirm the baseline is green**

Run: `bun test && bun run typecheck`
Expected: all tests pass, typecheck clean. If not, stop — the baseline is broken and must be fixed on `main` first.

- [ ] **Step 3: Add zod and enable JSON imports**

```bash
bun add zod@^4.5.4
```

Edit `tsconfig.json` so `compilerOptions` contains `"resolveJsonModule": true`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Verify and commit**

Run: `bun run typecheck && bun test`
Expected: still green.

```bash
git add package.json bun.lock tsconfig.json
git commit -m "chore: add zod and enable JSON module imports"
```

---

### Task 1: Unicode-aware term matcher

**Files:**
- Create: `src/terms.ts`
- Modify: `src/importance.ts` (remove `escapeRegExp`, import from `./terms`), `src/digest.ts:3` (import `escapeRegExp` from `./terms`), `src/lib.ts:8` (export `escapeRegExp` from `./terms`)
- Test: `test/unit/terms.test.ts`

**Interfaces:**
- Produces:
  - `escapeRegExp(s: string): string`
  - `termRegExp(term: string): RegExp` — cached, flags `iu`
  - `matchesTerm(haystack: string, term: string): boolean`
  - `findTerms(haystack: string, terms: readonly string[]): string[]` — returns the matching terms as written (with `*`)
  - `displayTerm(term: string): string` — strips a trailing `*`

Matching rules (the spec, section 1): a term matches as a whole word with optional `s`/`es` plural; a trailing `*` means prefix (stem) match; case-insensitive; boundaries are Unicode-aware so Cyrillic terms work.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/terms.test.ts
import { describe, expect, test } from 'bun:test';
import { displayTerm, escapeRegExp, findTerms, matchesTerm, termRegExp } from '../../src/terms';

describe('matchesTerm', () => {
  test('matches whole words case-insensitively', () => {
    expect(matchesTerm('Dubai rents jump', 'rent')).toBe(true);
    expect(matchesTerm('DUBAI RENT jumps', 'rent')).toBe(true);
  });

  test('accepts s and es plurals', () => {
    expect(matchesTerm('new visa fees announced', 'fee')).toBe(true);
    expect(matchesTerm('two taxes raised', 'tax')).toBe(true);
  });

  test('does not match inside another word', () => {
    expect(matchesTerm('Council reviews current procedures', 'rent')).toBe(false);
    expect(matchesTerm('Dubai taxi drivers', 'tax')).toBe(false);
    expect(matchesTerm('Dubai lawyer profiled', 'law')).toBe(false);
    expect(matchesTerm('Ukraine talks resume', 'rain')).toBe(false);
  });

  test('trailing * matches a prefix (stem)', () => {
    expect(matchesTerm('Residents evacuated after fire', 'evacuat*')).toBe(true);
    expect(matchesTerm('Evacuation ordered', 'evacuat*')).toBe(true);
    expect(matchesTerm('Terrorism charges filed', 'terror*')).toBe(true);
    expect(matchesTerm('reevacuate now', 'evacuat*')).toBe(false); // still needs a left boundary
  });

  test('multi-word and punctuated terms are matched literally', () => {
    expect(matchesTerm('Source: AP News', 'ap news')).toBe(true);
    expect(matchesTerm('via ft.com today', 'ft.com')).toBe(true);
    expect(matchesTerm('via ftXcom today', 'ft.com')).toBe(false);
    expect(matchesTerm("Dubai unveils world's tallest tower", "world's tallest")).toBe(true);
  });

  test('is Unicode-aware', () => {
    expect(matchesTerm('нестабильная погода', 'погода')).toBe(true);
    expect(matchesTerm('непогода', 'погода')).toBe(false);
  });
});

describe('findTerms', () => {
  test('returns matching terms as written, in list order', () => {
    expect(findTerms('Evacuation after missile strike', ['missile', 'evacuat*', 'flood'])).toEqual(['missile', 'evacuat*']);
  });
});

describe('displayTerm', () => {
  test('strips one trailing *', () => {
    expect(displayTerm('evacuat*')).toBe('evacuat');
    expect(displayTerm('missile')).toBe('missile');
  });
});

describe('termRegExp', () => {
  test('is cached per term', () => {
    expect(termRegExp('rent')).toBe(termRegExp('rent'));
  });
});

describe('escapeRegExp', () => {
  test('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/unit/terms.test.ts`
Expected: FAIL — `Cannot find module '../../src/terms'`.

- [ ] **Step 3: Implement `src/terms.ts`**

```ts
// src/terms.ts
// One matcher for every configurable word list (importance markers, skip list,
// title boosts, emoji rules, --match). Terms are plain strings, never regexes.

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NOT_WORD_CHAR_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_WORD_CHAR_AFTER = '(?![\\p{L}\\p{N}])';

const cache = new Map<string, RegExp>();

/**
 * "rent"      → whole word + optional s/es plural: rent, rents (not current, rental)
 * "evacuat*"  → prefix (stem): evacuate, evacuation (still needs a left word boundary)
 * Case-insensitive, Unicode-aware boundaries so non-Latin terms work.
 */
export function termRegExp(term: string): RegExp {
  const cached = cache.get(term);
  if (cached) return cached;
  const stem = term.endsWith('*');
  const body = escapeRegExp(stem ? term.slice(0, -1) : term);
  const source = stem
    ? `${NOT_WORD_CHAR_BEFORE}${body}`
    : `${NOT_WORD_CHAR_BEFORE}${body}(?:e?s)?${NOT_WORD_CHAR_AFTER}`;
  const re = new RegExp(source, 'iu');
  cache.set(term, re);
  return re;
}

export function matchesTerm(haystack: string, term: string): boolean {
  return termRegExp(term).test(haystack);
}

/** Terms from `terms` that occur in `haystack`, in list order, as written (with `*`). */
export function findTerms(haystack: string, terms: readonly string[]): string[] {
  return terms.filter((t) => matchesTerm(haystack, t));
}

/** Marker as shown to users: "evacuat*" → "evacuat". */
export function displayTerm(term: string): string {
  return term.endsWith('*') ? term.slice(0, -1) : term;
}
```

- [ ] **Step 4: Move `escapeRegExp` out of `importance.ts`**

In `src/importance.ts` delete the `escapeRegExp` function and add at the top:

```ts
import { escapeRegExp } from './terms';
```

In `src/digest.ts` change line 3 from
`import { scoreImportance, escapeRegExp, type ImportanceTier } from './importance';`
to

```ts
import { scoreImportance, type ImportanceTier } from './importance';
import { escapeRegExp } from './terms';
```

In `src/lib.ts` change line 8 from
`export { scoreImportance, IMPORTANCE_THRESHOLD, FILTER_PROMPT, escapeRegExp } from './importance';`
to

```ts
export { scoreImportance, IMPORTANCE_THRESHOLD, FILTER_PROMPT } from './importance';
export { escapeRegExp } from './terms';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: all green, including the new `terms.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/terms.ts src/importance.ts src/digest.ts src/lib.ts test/unit/terms.test.ts
git commit -m "feat(terms): add Unicode-aware term matcher, move escapeRegExp"
```

---

### Task 2: Config schema with zod

**Files:**
- Create: `src/config/schema.ts`
- Test: `test/unit/config-schema.test.ts`

**Interfaces:**
- Produces:
  - `DigestConfigSchema` (zod schema), `parseConfig(raw: unknown, source: string): DigestConfig`
  - Types: `DigestConfig`, `Topic`, `Locale`, `Display`, `MatchMode`, `ScoringConfig`, `DedupeConfig`, `ImportanceConfig`, `EmojiRule`, `Heuristics`
  - `Heuristics = Pick<DigestConfig, 'skip' | 'scoring' | 'dedupe' | 'importance' | 'emoji'>` — the slice pipeline modules consume.
- Error text: `Invalid config at <source>:\n✖ <message>\n  → at <json.path>` (one pair of lines per issue, produced by `z.prettifyError`).

Output type facts later tasks rely on: `Topic.limit: number` (default 5), `Topic.locale: Locale` (inherited from top level), `Topic.matchMode: MatchMode | undefined` (`'all'` when `match` given and mode omitted, `undefined` when no `match`), `DigestConfig.display: Display` (default `{ flag: '🌐', name: 'News', timezone: 'UTC' }`), `ScoringConfig.sourceTiers` / `titleBoosts` default `[]`, `DedupeConfig.similarityThreshold` default `0.45`, `synonyms` default `{}`, `stopWords` default `[]`, `ImportanceConfig.threshold` default `2`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/config-schema.test.ts
import { describe, expect, test } from 'bun:test';
import { parseConfig } from '../../src/config/schema';

const minimal = {
  locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
  topics: [{ slug: 'a', name: 'A', query: 'q' }],
};

describe('parseConfig — structure', () => {
  test('accepts a minimal config and applies defaults', () => {
    const cfg = parseConfig(minimal, 'test');
    expect(cfg.display).toEqual({ flag: '🌐', name: 'News', timezone: 'UTC' });
    expect(cfg.topics[0]).toMatchObject({ slug: 'a', limit: 5, locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' } });
    expect(cfg.topics[0]!.matchMode).toBeUndefined();
    expect(cfg.skip).toBeUndefined();
    expect(cfg.scoring).toBeUndefined();
    expect(cfg.importance).toBeUndefined();
    expect(cfg.emoji).toBeUndefined();
  });

  test('requires locale', () => {
    expect(() => parseConfig({ topics: minimal.topics }, 'test')).toThrow(/locale/);
  });

  test('per-topic locale overrides the top-level one', () => {
    const cfg = parseConfig({
      ...minimal,
      topics: [{ slug: 'de', name: 'DE', query: 'x', locale: { hl: 'de', gl: 'DE', ceid: 'DE:de' } }],
    }, 'test');
    expect(cfg.topics[0]!.locale).toEqual({ hl: 'de', gl: 'DE', ceid: 'DE:de' });
  });

  test('rejects an empty topics array', () => {
    expect(() => parseConfig({ ...minimal, topics: [] }, 'test')).toThrow(/at least one topic/i);
  });

  test('rejects a topic missing slug, with the JSON path', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ name: 'X', query: 'q' }] }, 'test')).toThrow(/topics\[0\]\.slug/);
  });

  test('rejects a topic missing query', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A' }] }, 'test')).toThrow(/query/);
  });

  test('rejects duplicate slugs', () => {
    expect(() => parseConfig({
      ...minimal,
      topics: [{ slug: 'x', name: 'X', query: 'a' }, { slug: 'x', name: 'Y', query: 'b' }],
    }, 'test')).toThrow(/duplicate.*slug.*x/i);
  });

  test('rejects a non-positive limit', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', limit: 0 }] }, 'test')).toThrow(/limit/);
  });

  test('rejects unknown keys (typos)', () => {
    expect(() => parseConfig({ ...minimal, topics: [{ slug: 'a', name: 'A', query: 'q', matchmode: 'any' }] }, 'test')).toThrow(/matchmode/);
    expect(() => parseConfig({ ...minimal, scorring: {} }, 'test')).toThrow(/scorring/);
  });

  test('trims whitespace from string fields', () => {
    const cfg = parseConfig({ ...minimal, topics: [{ slug: '  economy ', name: ' Экономика  ', query: '  UAE economy  ', emoji: ' 💰 ' }] }, 'test');
    expect(cfg.topics[0]).toMatchObject({ slug: 'economy', name: 'Экономика', query: 'UAE economy', emoji: '💰' });
  });

  test('includes the source in the error message', () => {
    expect(() => parseConfig({}, '/tmp/x.json')).toThrow(/Invalid config at \/tmp\/x\.json/);
  });
});

describe('parseConfig — match / matchMode', () => {
  const withMatch = (extra: Record<string, unknown>) =>
    parseConfig({ ...minimal, topics: [{ slug: 's', name: 'S', query: 'q', ...extra }] }, 'test').topics[0]!;

  test('parses match and matchMode', () => {
    const t = withMatch({ match: ['school', 'fees'], matchMode: 'any' });
    expect(t.match).toEqual(['school', 'fees']);
    expect(t.matchMode).toBe('any');
  });

  test('defaults matchMode to "all" when match is present', () => {
    expect(withMatch({ match: ['school'] }).matchMode).toBe('all');
  });

  test('accepts a positive-integer matchMode', () => {
    expect(withMatch({ match: ['a', 'b', 'c'], matchMode: 2 }).matchMode).toBe(2);
  });

  test('rejects an invalid matchMode', () => {
    expect(() => withMatch({ match: ['a'], matchMode: 'sometimes' })).toThrow(/matchMode/);
  });

  test('rejects a non-array or empty match', () => {
    expect(() => withMatch({ match: 'school' })).toThrow(/match/);
    expect(() => withMatch({ match: [] })).toThrow(/match/);
    expect(() => withMatch({ match: ['ok', 5] })).toThrow(/match\[1\]/);
  });

  test('rejects matchMode without match', () => {
    expect(() => withMatch({ matchMode: 'any' })).toThrow(/matchMode requires/);
  });
});

describe('parseConfig — heuristics', () => {
  test('parses every heuristic section and applies nested defaults', () => {
    const cfg = parseConfig({
      ...minimal,
      display: { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' },
      skip: ['opinion', 'horse'],
      scoring: {
        sourceTiers: [{ weight: 5, sources: ['reuters'] }],
        titleBoosts: [{ weight: 2, terms: ['Dubai'] }],
      },
      dedupe: { synonyms: { drones: 'uav' } },
      importance: {
        breaking: { weight: 4, markers: ['missile', 'evacuat*'] },
        fluff: { penalty: 3, markers: ['award'] },
      },
      emoji: [{ emoji: '🌧️', terms: ['rain'] }],
      agentPrompt: 'Keep what matters.',
    }, 'test');

    expect(cfg.display.name).toBe('UAE');
    expect(cfg.skip).toEqual(['opinion', 'horse']);
    expect(cfg.scoring!.sourceTiers[0]).toEqual({ weight: 5, sources: ['reuters'] });
    expect(cfg.dedupe).toEqual({ similarityThreshold: 0.45, synonyms: { drones: 'uav' }, stopWords: [] });
    expect(cfg.importance!.threshold).toBe(2);
    expect(cfg.importance!.impact).toBeUndefined();
    expect(cfg.importance!.breaking!.markers).toContain('evacuat*');
    expect(cfg.emoji![0]!.emoji).toBe('🌧️');
    expect(cfg.agentPrompt).toBe('Keep what matters.');
  });

  test('rejects a marker with * anywhere but the end', () => {
    expect(() => parseConfig({ ...minimal, importance: { breaking: { weight: 1, markers: ['ev*acuat'] } } }, 'test')).toThrow(/markers\[0\]/);
    expect(() => parseConfig({ ...minimal, skip: ['**'] }, 'test')).toThrow(/skip\[0\]/);
  });

  test('rejects negative weights and out-of-range thresholds', () => {
    expect(() => parseConfig({ ...minimal, scoring: { sourceTiers: [{ weight: -1, sources: ['x'] }] } }, 'test')).toThrow(/weight/);
    expect(() => parseConfig({ ...minimal, dedupe: { similarityThreshold: 1.5 } }, 'test')).toThrow(/similarityThreshold/);
  });

  test('rejects an empty term list', () => {
    expect(() => parseConfig({ ...minimal, emoji: [{ emoji: '🌧️', terms: [] }] }, 'test')).toThrow(/terms/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/unit/config-schema.test.ts`
Expected: FAIL — `Cannot find module '../../src/config/schema'`.

- [ ] **Step 3: Implement `src/config/schema.ts`**

```ts
// src/config/schema.ts
import { z } from 'zod';

const nonEmpty = (what: string) => z.string().trim().min(1, `${what} must be a non-empty string`);

/** A plain word or phrase; a single trailing "*" means prefix (stem) match. Never a regex. */
const TermSchema = z
  .string()
  .trim()
  .min(1, 'term must be a non-empty string')
  .regex(/^[^*]+\*?$/, 'a term may contain "*" only as its last character');

const TermList = z.array(TermSchema).min(1, 'terms must be a non-empty array of strings');

export const LocaleSchema = z.strictObject({
  hl: nonEmpty('hl'),
  gl: nonEmpty('gl'),
  ceid: nonEmpty('ceid'),
});

export const DisplaySchema = z.strictObject({
  flag: nonEmpty('flag'),
  name: nonEmpty('name'),
  timezone: nonEmpty('timezone'),
});

export const MatchModeSchema = z.union(
  [z.literal('all'), z.literal('any'), z.number().int().positive()],
  { error: 'matchMode must be "all", "any", or a positive integer' },
);

const TopicSchema = z
  .strictObject({
    slug: nonEmpty('slug'),
    name: nonEmpty('name'),
    emoji: nonEmpty('emoji').optional(),
    query: nonEmpty('query'),
    match: z.array(TermSchema).min(1, 'match must be a non-empty array of strings').optional(),
    matchMode: MatchModeSchema.optional(),
    limit: z.number().int().positive('limit must be a positive integer').default(5),
    locale: LocaleSchema.optional(),
  })
  .superRefine((t, ctx) => {
    if (t.matchMode !== undefined && t.match === undefined) {
      ctx.addIssue({ code: 'custom', path: ['matchMode'], message: 'matchMode requires a "match" array to be set' });
    }
  });

const Weight = z.number().nonnegative('weight must be >= 0');

export const ScoringSchema = z.strictObject({
  /** Evaluated in order; the first tier whose list matches the source wins. */
  sourceTiers: z.array(z.strictObject({ weight: Weight, sources: TermList })).default([]),
  /** Additive; each boost applies once if any of its terms matches the title. */
  titleBoosts: z.array(z.strictObject({ weight: Weight, terms: TermList })).default([]),
});

export const DedupeSchema = z.strictObject({
  similarityThreshold: z.number().min(0, 'similarityThreshold must be within 0..1').max(1, 'similarityThreshold must be within 0..1').default(0.45),
  synonyms: z.record(z.string(), z.string()).default({}),
  stopWords: z.array(TermSchema).default([]),
});

const MarkerGroup = z.strictObject({ weight: Weight, markers: TermList });
const PenaltyGroup = z.strictObject({ penalty: z.number().nonnegative('penalty must be >= 0'), markers: TermList });

export const ImportanceSchema = z.strictObject({
  threshold: z.number().default(2),
  breaking: MarkerGroup.optional(),
  impact: MarkerGroup.optional(),
  fluff: PenaltyGroup.optional(),
});

export const EmojiRuleSchema = z.strictObject({ emoji: nonEmpty('emoji'), terms: TermList });

export const DigestConfigSchema = z
  .strictObject({
    locale: LocaleSchema,
    display: DisplaySchema.default({ flag: '🌐', name: 'News', timezone: 'UTC' }),
    topics: z.array(TopicSchema).min(1, 'at least one topic is required'),
    skip: z.array(TermSchema).optional(),
    scoring: ScoringSchema.optional(),
    dedupe: DedupeSchema.optional(),
    importance: ImportanceSchema.optional(),
    emoji: z.array(EmojiRuleSchema).optional(),
    agentPrompt: nonEmpty('agentPrompt').optional(),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.topics.forEach((t, i) => {
      if (seen.has(t.slug)) {
        ctx.addIssue({ code: 'custom', path: ['topics', i, 'slug'], message: `duplicate topic slug "${t.slug}"` });
      }
      seen.add(t.slug);
    });
  })
  .transform((cfg) => ({
    ...cfg,
    topics: cfg.topics.map((t) => ({
      ...t,
      matchMode: t.match ? (t.matchMode ?? 'all') : undefined,
      locale: t.locale ?? cfg.locale,
    })),
  }));

export type DigestConfig = z.output<typeof DigestConfigSchema>;
export type Topic = DigestConfig['topics'][number];
export type Locale = z.output<typeof LocaleSchema>;
export type Display = z.output<typeof DisplaySchema>;
export type MatchMode = z.output<typeof MatchModeSchema>;
export type ScoringConfig = z.output<typeof ScoringSchema>;
export type DedupeConfig = z.output<typeof DedupeSchema>;
export type ImportanceConfig = z.output<typeof ImportanceSchema>;
export type EmojiRule = z.output<typeof EmojiRuleSchema>;

/** The slice the pipeline consumes. Every field optional: absent = neutral behaviour. */
export type Heuristics = Pick<DigestConfig, 'skip' | 'scoring' | 'dedupe' | 'importance' | 'emoji'>;

/**
 * Validate a parsed JSON value. `source` names where it came from (a file path,
 * "built-in default", "test") and is echoed in the error so the user knows what to fix.
 */
export function parseConfig(raw: unknown, source: string): DigestConfig {
  const result = DigestConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config at ${source}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test test/unit/config-schema.test.ts && bun run typecheck`
Expected: PASS. If a regex on a path fails, print the thrown message once (`console.log((e as Error).message)`) and adjust the *test regex*, not the schema, as long as the path and field name appear.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/unit/config-schema.test.ts
git commit -m "feat(config): zod schema for topics and heuristics"
```

---

### Task 3: Built-in default config and loader

**Files:**
- Create: `src/config/default.json`, `src/config/load.ts`
- Test: `test/unit/default-config.test.ts`, `test/unit/config-load.test.ts`

**Interfaces:**
- Consumes: `parseConfig`, `DigestConfig` from `./schema`.
- Produces:
  - `DEFAULT_CONFIG: DigestConfig` — parsed at import; throws if `default.json` is invalid.
  - `loadConfig(path: string): Promise<DigestConfig>` — errors: `Config not found: <path>`, `Failed to parse config at <path>: <json error>`, or the `parseConfig` error.
  - `resolveConfigPath(opts: { explicit?: string; cwd: string; env: Record<string, string | undefined> }): Promise<string | null>` — same discovery order as today's `resolveTopicsConfigPath`; errors `Config not found: <explicit>` and `resolveConfigPath: cwd is required`.

`default.json` reproduces today's constants exactly (values copied from `src/digest.ts`, `src/scoring.ts`, `src/importance.ts`, `src/render.ts`), with three edits: stems get a `*`, the `_skip` synonym trick becomes plain stop words, and Russian emoji terms are dropped.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/default-config.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '../../src/config/load';
import { parseConfig } from '../../src/config/schema';
import defaultJson from '../../src/config/default.json';

describe('built-in default config', () => {
  test('validates against the schema', () => {
    expect(() => parseConfig(defaultJson, 'default.json')).not.toThrow();
  });

  test('describes the UAE region with one topic', () => {
    expect(DEFAULT_CONFIG.display).toEqual({ flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' });
    expect(DEFAULT_CONFIG.locale).toEqual({ hl: 'en', gl: 'AE', ceid: 'AE:en' });
    expect(DEFAULT_CONFIG.topics).toHaveLength(1);
    expect(DEFAULT_CONFIG.topics[0]!.query).toBe('UAE OR "Abu Dhabi" OR Dubai');
    expect(DEFAULT_CONFIG.topics[0]!.limit).toBe(6);
  });

  test('carries every heuristic section', () => {
    expect(DEFAULT_CONFIG.skip).toContain('opinion');
    expect(DEFAULT_CONFIG.scoring!.sourceTiers.map((t) => t.weight)).toEqual([5, 3, 2]);
    expect(DEFAULT_CONFIG.scoring!.titleBoosts).toHaveLength(2);
    expect(DEFAULT_CONFIG.dedupe!.similarityThreshold).toBe(0.45);
    expect(DEFAULT_CONFIG.dedupe!.synonyms.drones).toBe('uav');
    expect(DEFAULT_CONFIG.dedupe!.stopWords).toContain('says');
    expect(DEFAULT_CONFIG.importance!.threshold).toBe(2);
    expect(DEFAULT_CONFIG.importance!.breaking!.markers).toContain('evacuat*');
    expect(DEFAULT_CONFIG.importance!.fluff!.markers).toContain('inaugurat*');
    expect(DEFAULT_CONFIG.emoji![0]).toEqual({ emoji: '🌧️', terms: ['rain', 'weather'] });
    expect(DEFAULT_CONFIG.agentPrompt).toMatch(/^You are a news filter for an expat family in the UAE/);
  });
});
```

```ts
// test/unit/config-load.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveConfigPath } from '../../src/config/load';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'config-load-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const valid = {
  locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
  topics: [{ slug: 'a', name: 'A', query: 'q' }],
};

function write(name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
}

describe('loadConfig', () => {
  test('loads a valid file', async () => {
    const cfg = await loadConfig(write('ok.json', valid));
    expect(cfg.topics[0]).toMatchObject({ slug: 'a', limit: 5 });
  });

  test('rejects malformed JSON with the file path in the message', async () => {
    await expect(loadConfig(write('broken.json', '{ not json'))).rejects.toThrow(/Failed to parse config at .*broken\.json/);
  });

  test('rejects a schema violation with the file path in the message', async () => {
    await expect(loadConfig(write('bad.json', { topics: [] }))).rejects.toThrow(/Invalid config at .*bad\.json/);
  });

  test('rejects a missing file with a helpful message', async () => {
    await expect(loadConfig('/nope/missing.json')).rejects.toThrow(/Config not found: \/nope\/missing\.json/);
  });
});

describe('resolveConfigPath', () => {
  test('returns the explicit path when it exists', async () => {
    const path = write('explicit.json', valid);
    expect(await resolveConfigPath({ explicit: path, cwd: dir, env: {} })).toBe(path);
  });

  test('throws when the explicit path is missing or empty', async () => {
    await expect(resolveConfigPath({ explicit: '/nope.json', cwd: dir, env: {} })).rejects.toThrow(/Config not found: \/nope\.json/);
    await expect(resolveConfigPath({ explicit: '', cwd: dir, env: {} })).rejects.toThrow(/Config not found/);
  });

  test('finds digest.config.json in cwd', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-'));
    try {
      const path = join(cwd, 'digest.config.json');
      writeFileSync(path, JSON.stringify(valid));
      expect(await resolveConfigPath({ cwd, env: {} })).toBe(path);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('falls back to $XDG_CONFIG_HOME/uae-news-digest/topics.json', async () => {
    const xdg = mkdtempSync(join(tmpdir(), 'xdg-'));
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-empty-'));
    try {
      mkdirSync(join(xdg, 'uae-news-digest'), { recursive: true });
      const path = join(xdg, 'uae-news-digest', 'topics.json');
      writeFileSync(path, JSON.stringify(valid));
      expect(await resolveConfigPath({ cwd, env: { XDG_CONFIG_HOME: xdg } })).toBe(path);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('falls back to $HOME/.config when XDG_CONFIG_HOME is unset', async () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-empty-'));
    try {
      mkdirSync(join(home, '.config', 'uae-news-digest'), { recursive: true });
      const path = join(home, '.config', 'uae-news-digest', 'topics.json');
      writeFileSync(path, JSON.stringify(valid));
      expect(await resolveConfigPath({ cwd, env: { HOME: home } })).toBe(path);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('returns null when nothing is found', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-none-'));
    try {
      expect(await resolveConfigPath({ cwd, env: { HOME: cwd } })).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('throws when cwd is empty', async () => {
    await expect(resolveConfigPath({ cwd: '', env: {} })).rejects.toThrow(/cwd is required/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/unit/default-config.test.ts test/unit/config-load.test.ts`
Expected: FAIL — cannot find `../../src/config/load` / `default.json`.

- [ ] **Step 3: Create `src/config/default.json`**

```json
{
  "locale": { "hl": "en", "gl": "AE", "ceid": "AE:en" },
  "display": { "flag": "🇦🇪", "name": "UAE", "timezone": "Asia/Dubai" },
  "topics": [
    {
      "slug": "uae",
      "name": "UAE",
      "emoji": "📰",
      "query": "UAE OR \"Abu Dhabi\" OR Dubai",
      "limit": 6
    }
  ],
  "skip": [
    "opinion", "daily mail", "travel and tour world", "tradingview", "cycling", "horse",
    "football", "msn", "substack", "influencer", "hotel room", "fitness journey", "baskin-robbins"
  ],
  "scoring": {
    "sourceTiers": [
      { "weight": 5, "sources": [
        "reuters", "ap news", "associated press", "bbc", "new york times", "nytimes",
        "washington post", "the economist", "financial times", "ft.com", "bloomberg",
        "wall street journal", "wsj", "the guardian"
      ] },
      { "weight": 3, "sources": [
        "al jazeera", "deutsche welle", "dw.com", "france 24", "france24", "cnbc", "cnn", "anadolu"
      ] },
      { "weight": 2, "sources": ["gulf news", "khaleej times", "the national", "zawya"] }
    ],
    "titleBoosts": [
      { "weight": 2, "terms": ["UAE", "Dubai", "Abu Dhabi", "Sharjah", "Ras al-Khaimah", "Fujairah"] },
      { "weight": 2, "terms": [
        "weather", "rain", "missile", "drone", "airspace", "defence", "defense", "property",
        "market", "flight", "shipping", "Hezbollah", "Iran", "airport", "Hormuz"
      ] }
    ]
  },
  "dedupe": {
    "similarityThreshold": 0.45,
    "synonyms": {
      "drone": "uav", "drones": "uav", "uavs": "uav", "uav": "uav",
      "intercept": "engage", "intercepted": "engage", "intercepts": "engage",
      "engage": "engage", "engaged": "engage", "engages": "engage",
      "missile": "missile", "missiles": "missile", "ballistic": "missile",
      "defence": "defense", "defences": "defense", "defenses": "defense", "defense": "defense",
      "iranian": "iran", "iran": "iran",
      "airport": "airport", "airspace": "airport", "flights": "flight", "flight": "flight",
      "property": "realestate", "housing": "realestate", "realestate": "realestate",
      "rain": "weather", "weather": "weather", "flooding": "weather", "flood": "weather",
      "shipping": "shipping", "hormuz": "shipping",
      "school": "education", "schools": "education", "education": "education"
    },
    "stopWords": [
      "the", "a", "an", "in", "on", "at", "of", "to", "for", "and", "or", "is", "are", "was",
      "were", "has", "have", "had", "it", "its", "by", "from", "with", "as", "after", "that",
      "this", "new", "amid", "says", "said", "report", "reports"
    ]
  },
  "importance": {
    "threshold": 2,
    "breaking": { "weight": 4, "markers": [
      "breaking", "urgent", "evacuat*", "killed", "attack", "missile", "drone", "airspace",
      "airport closed", "closure", "banned", "alert", "warning", "storm", "flood", "recall"
    ] },
    "impact": { "weight": 2, "markers": [
      "rent", "fees", "tax", "fuel", "fine", "salary", "subsidy",
      "visa", "residency", "law", "permit", "licence", "school", "insurance",
      "flight", "road closed", "outage", "metro"
    ] },
    "fluff": { "penalty": 3, "markers": [
      "unveils", "launches", "celebrates", "award", "vision", "milestone",
      "world's first", "world's tallest", "world's largest", "ranked",
      "inaugurat*", "honoured", "festival"
    ] }
  },
  "emoji": [
    { "emoji": "🌧️", "terms": ["rain", "weather"] },
    { "emoji": "📉", "terms": ["property", "market"] },
    { "emoji": "✈️", "terms": ["flight", "airspace", "airport"] },
    { "emoji": "🛡️", "terms": ["missile", "drone", "defence", "defense", "air attack"] },
    { "emoji": "⛴️", "terms": ["shipping", "hormuz"] },
    { "emoji": "🚨", "terms": ["hezbollah", "terror*"] },
    { "emoji": "🎓", "terms": ["school", "education"] },
    { "emoji": "🛢️", "terms": ["oil", "gas"] },
    { "emoji": "🛂", "terms": ["visa"] }
  ],
  "agentPrompt": "You are a news filter for an expat family in the UAE. Keep only what materially affects safety, money, rules/visas, or logistics. Drop PR, launches, awards, rankings, and 'world's first/tallest/largest'."
}
```

- [ ] **Step 4: Implement `src/config/load.ts`**

```ts
// src/config/load.ts
import { join } from 'node:path';
import defaultJson from './default.json';
import { parseConfig, type DigestConfig } from './schema';

/** The UAE config the CLI uses when no config file is found. Validated at import time. */
export const DEFAULT_CONFIG: DigestConfig = parseConfig(defaultJson, 'built-in default config');

export async function loadConfig(path: string): Promise<DigestConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Config not found: ${path}`);
  }

  let raw: unknown;
  try {
    raw = await file.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config at ${path}: ${msg}`);
  }

  return parseConfig(raw, path);
}

export type ResolveConfigOptions = {
  explicit?: string;
  cwd: string;
  env: Record<string, string | undefined>;
};

/**
 * Discovery order (first hit wins):
 *   1. `explicit` (the --config flag) — must exist, otherwise an error
 *   2. <cwd>/digest.config.json
 *   3. $XDG_CONFIG_HOME/uae-news-digest/topics.json, or ~/.config/uae-news-digest/topics.json
 * Returns null when nothing is found; callers fall back to DEFAULT_CONFIG.
 */
export async function resolveConfigPath(opts: ResolveConfigOptions): Promise<string | null> {
  if (opts.explicit !== undefined) {
    if (opts.explicit === '' || !(await Bun.file(opts.explicit).exists())) {
      throw new Error(`Config not found: ${opts.explicit}`);
    }
    return opts.explicit;
  }

  if (!opts.cwd) {
    throw new Error('resolveConfigPath: cwd is required');
  }

  const cwdCandidate = join(opts.cwd, 'digest.config.json');
  if (await Bun.file(cwdCandidate).exists()) return cwdCandidate;

  const xdg = opts.env.XDG_CONFIG_HOME ?? (opts.env.HOME ? join(opts.env.HOME, '.config') : null);
  if (xdg) {
    const xdgCandidate = join(xdg, 'uae-news-digest', 'topics.json');
    if (await Bun.file(xdgCandidate).exists()) return xdgCandidate;
  }

  return null;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bun test test/unit/default-config.test.ts test/unit/config-load.test.ts && bun run typecheck`
Expected: PASS. If `tsc` complains about the JSON import, confirm `resolveJsonModule` landed in `tsconfig.json` (Task 0).

- [ ] **Step 6: Commit**

```bash
git add src/config/default.json src/config/load.ts test/unit/default-config.test.ts test/unit/config-load.test.ts
git commit -m "feat(config): built-in UAE default config and loader"
```

---

### Task 4: Thread `heuristics` through the pipeline (no behaviour change)

Add a required `heuristics: Heuristics` parameter to the digest builder, the pipeline runners, and the render functions. Modules keep using their constants for now; this task only plumbs the value from the CLI down. The CLI passes `DEFAULT_CONFIG` in both modes, so output is unchanged.

**Files:**
- Modify: `src/digest.ts` (`BuildDigestOptions`), `src/pipeline.ts` (`RunDigestOptions`, `RunTopicalDigestOptions`, calls), `src/render.ts` (`renderDigest`, `renderTopicalDigest` signatures), `src/index.ts` (pass `DEFAULT_CONFIG`)
- Modify tests: `test/integration/digest.test.ts`, `test/integration/pipeline.test.ts`, `test/integration/topical-digest.test.ts`, `test/unit/render.test.ts`

**Interfaces:**
- Consumes: `Heuristics`, `DEFAULT_CONFIG`.
- Produces:
  - `BuildDigestOptions.heuristics: Heuristics` (required)
  - `RunDigestOptions.heuristics: Heuristics`, `RunTopicalDigestOptions.heuristics: Heuristics` (required)
  - `renderDigest(items, translations, now, region, heuristics)` and `renderTopicalDigest(sections, translations, now, locale, heuristics)` — `heuristics: Pick<Heuristics, 'importance' | 'emoji'>` as the last, required parameter.

- [ ] **Step 1: Update `src/digest.ts`**

```ts
import type { Heuristics, MatchMode } from './config/schema';
```
Delete the local `export type MatchMode = 'all' | 'any' | number;` and re-export the schema one so `lib.ts`/`core.ts` keep compiling:
```ts
export type { MatchMode } from './config/schema';
```
Add to `BuildDigestOptions`:
```ts
export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  skipRe?: RegExp;
  match?: string[];
  matchMode?: MatchMode;
  heuristics: Heuristics;
};
```

- [ ] **Step 2: Update `src/render.ts` signatures**

```ts
import type { Heuristics } from './config/schema';

export type RenderHeuristics = Pick<Heuristics, 'importance' | 'emoji'>;

export function renderDigest(
  items: DigestItem[],
  translations: Map<string, string> | undefined,
  now: Date,
  region: string,
  heuristics: RenderHeuristics,
): string {
```
and
```ts
export function renderTopicalDigest(
  sections: TopicSection[],
  translations: Map<string, string> | undefined,
  now: Date,
  locale: LocaleContext,
  heuristics: RenderHeuristics,
): string {
```
Remove the default values for `now`, `region`, and `locale` (callers must now pass everything). `DEFAULT_LOCALE_CONTEXT` stays until Task 9 if still referenced; delete it if `tsc` reports it unused — it is not, so delete it now.

- [ ] **Step 3: Update `src/pipeline.ts`**

Add `heuristics: Heuristics;` to both `RunDigestOptions` and `RunTopicalDigestOptions` (import the type from `./config/schema`). Pass it through:

```ts
// runDigest
const { items: digest, droppedByMatch } = buildDigestWithStats(items, {
  seenKeys: options.seenKeys,
  hours: options.hours,
  limit: options.limit,
  now: options.now,
  match: options.match,
  matchMode: options.matchMode,
  heuristics: options.heuristics,
});
// ...
output: renderDigest(digest, translations, options.now ?? new Date(), options.region ?? 'uae', options.heuristics),
```

```ts
// runTopicalDigest
const { items, droppedByMatch } = buildDigestWithStats(parseRss(result.value), {
  seenKeys: seen,
  hours: opts.hours,
  limit: opts.limitOverride ?? topic.limit,
  now,
  match: topic.match,
  matchMode: topic.matchMode,
  heuristics: opts.heuristics,
});
// ...
output: renderTopicalDigest(sections, translations, now, localeContextFor(opts.config.locale.gl), opts.heuristics),
```

- [ ] **Step 4: Update `src/index.ts`**

Add `import { DEFAULT_CONFIG } from './config/load';`. In `runInTopicsMode` add `heuristics: DEFAULT_CONFIG,` to the `runTopicalDigest({...})` call. In the main action add `heuristics: DEFAULT_CONFIG,` to the `runDigest({...})` call.

- [ ] **Step 5: Update tests to pass heuristics**

In `test/integration/digest.test.ts`: add `import { DEFAULT_CONFIG } from '../../src/config/load';` and add `heuristics: DEFAULT_CONFIG,` to every `buildDigest(...)` / `buildDigestWithStats(...)` options object (search for `seenKeys:` inside the file — each occurrence is one call).

In `test/integration/pipeline.test.ts`: same import; add `heuristics: DEFAULT_CONFIG,` to every `runDigest({...})` call.

In `test/integration/topical-digest.test.ts`: same import; add `heuristics: DEFAULT_CONFIG,` to every `runTopicalDigest({...})` call.

In `test/unit/render.test.ts`: same import; every `renderDigest(x, translations, now)` becomes `renderDigest(x, translations, now, 'uae', DEFAULT_CONFIG)`; `renderDigest([])` becomes `renderDigest([], undefined, now, 'uae', DEFAULT_CONFIG)`; `renderDigest(..., now, 'us')` gets `, DEFAULT_CONFIG` appended; every `renderTopicalDigest(sections, translations, now)` becomes `renderTopicalDigest(sections, translations, now, { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' }, DEFAULT_CONFIG)`; the call that already passes a locale gets `, DEFAULT_CONFIG` appended.

- [ ] **Step 6: Run everything**

Run: `bun run typecheck && bun test`
Expected: green, golden fixture untouched.

- [ ] **Step 7: Commit**

```bash
git add src test
git commit -m "refactor: thread heuristics from CLI to digest and render (no behaviour change)"
```

---

### Task 5: Scoring and similarity read their config slices

**Files:**
- Modify: `src/scoring.ts`, `src/digest.ts:88,109` (call sites)
- Test: `test/unit/scoring.test.ts`

**Interfaces:**
- Produces:
  - `scoreItem(title: string, source: string, scoring: ScoringConfig | undefined): number` — `undefined` → `0`.
  - `titleSimilarity(a: string, b: string, dedupe: DedupeConfig | undefined): number` — `undefined` → no synonyms, no stop words.
- Removed exports: `TIER_1_RE`, `TIER_2_RE`, `TIER_3_RE`.

- [ ] **Step 1: Rewrite `test/unit/scoring.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { scoreItem, titleSimilarity } from '../../src/scoring';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { DedupeConfig, ScoringConfig } from '../../src/config/schema';

const scoring = DEFAULT_CONFIG.scoring!;

describe('scoreItem with the default config', () => {
  test('tier 1 international sources get +5', () => {
    for (const s of ['Reuters', 'BBC', 'AP News', 'The New York Times', 'The Washington Post', 'The Economist', 'Financial Times', 'Bloomberg', 'Wall Street Journal', 'The Guardian']) {
      expect(scoreItem('Generic headline', s, scoring)).toBe(5);
    }
  });

  test('tier 2 regional sources get +3', () => {
    for (const s of ['Al Jazeera', 'Deutsche Welle', 'France 24', 'CNBC', 'CNN', 'Anadolu Agency']) {
      expect(scoreItem('Generic headline', s, scoring)).toBe(3);
    }
  });

  test('tier 3 local sources get +2', () => {
    for (const s of ['Gulf News', 'Khaleej Times', 'The National', 'Zawya']) {
      expect(scoreItem('Generic headline', s, scoring)).toBe(2);
    }
  });

  test('unknown source gets 0', () => {
    expect(scoreItem('Generic headline about nothing', 'Unknown Blog', scoring)).toBe(0);
  });

  test('UAE mention and priority keyword each add +2, once per boost', () => {
    expect(scoreItem('Dubai sees growth', 'Unknown Blog', scoring)).toBe(2);
    expect(scoreItem('Abu Dhabi airport news', 'Unknown Blog', scoring)).toBe(4);
    expect(scoreItem('Rain expected tomorrow', 'Unknown', scoring)).toBe(2);
    expect(scoreItem('Dubai airport closed due to rain', 'Reuters', scoring)).toBe(9);
    expect(scoreItem('Dubai airport closed due to rain', 'Gulf News', scoring)).toBe(6);
  });

  test('boost terms match whole words only', () => {
    expect(scoreItem('Ukraine talks resume', 'Unknown', scoring)).toBe(0); // "rain" must not fire
  });
});

describe('scoreItem with custom or absent config', () => {
  test('first matching tier wins, tiers are evaluated in order', () => {
    const custom: ScoringConfig = {
      sourceTiers: [{ weight: 9, sources: ['gazette'] }, { weight: 1, sources: ['gazette', 'herald'] }],
      titleBoosts: [],
    };
    expect(scoreItem('x', 'Daily Gazette', custom)).toBe(9);
    expect(scoreItem('x', 'Herald', custom)).toBe(1);
  });

  test('returns 0 when scoring is not configured', () => {
    expect(scoreItem('Dubai airport closed due to rain', 'Reuters', undefined)).toBe(0);
  });
});

describe('titleSimilarity', () => {
  const dedupe = DEFAULT_CONFIG.dedupe!;

  test('is 1 for identical titles and 0 for disjoint ones', () => {
    expect(titleSimilarity('Dubai rents rise', 'Dubai rents rise', dedupe)).toBe(1);
    expect(titleSimilarity('Dubai rents rise', 'Oil output falls', dedupe)).toBe(0);
  });

  test('synonyms and stop words from the config bring paraphrases together', () => {
    const a = 'UAE says it intercepted 5 Iranian missiles, 17 drones';
    const b = 'UAE air defences engage 5 ballistic missiles, 17 UAVs on March 24';
    expect(titleSimilarity(a, b, dedupe)).toBeGreaterThanOrEqual(0.45);
    expect(titleSimilarity(a, b, undefined)).toBeLessThan(0.45);
  });

  test('a custom dedupe config is honoured', () => {
    const custom: DedupeConfig = { similarityThreshold: 0.5, synonyms: { auto: 'car', automobile: 'car' }, stopWords: ['the'] };
    expect(titleSimilarity('the auto market', 'the automobile market', custom)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/unit/scoring.test.ts`
Expected: FAIL — type errors / wrong values because `scoreItem` still ignores the third argument.

- [ ] **Step 3: Rewrite `src/scoring.ts`**

```ts
// src/scoring.ts
import { matchesTerm } from './terms';
import type { DedupeConfig, ScoringConfig } from './config/schema';

/** Source-tier weight (first matching tier wins) plus one additive weight per matching title boost. */
export function scoreItem(title: string, source: string, scoring: ScoringConfig | undefined): number {
  if (!scoring) return 0;
  let score = 0;
  const tier = scoring.sourceTiers.find((t) => t.sources.some((s) => matchesTerm(source, s)));
  if (tier) score += tier.weight;
  for (const boost of scoring.titleBoosts) {
    if (boost.terms.some((t) => matchesTerm(title, t))) score += boost.weight;
  }
  return score;
}

function extractWords(title: string, dedupe: DedupeConfig | undefined): string[] {
  const synonyms = dedupe?.synonyms ?? {};
  const stop = new Set(dedupe?.stopWords ?? []);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map((w) => synonyms[w] ?? w)
    .filter((w) => w.length > 1 && !stop.has(w));
}

/** Jaccard similarity over synonym-normalised, stop-word-filtered title words. */
export function titleSimilarity(a: string, b: string, dedupe: DedupeConfig | undefined): number {
  const wa = new Set(extractWords(a, dedupe));
  const wb = new Set(extractWords(b, dedupe));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}
```

- [ ] **Step 4: Update the two call sites in `src/digest.ts`**

```ts
score: scoreItem(title, source, heuristics.scoring),
```
and
```ts
if (titleSimilarity(title, existingItem.title, heuristics.dedupe) >= FUZZY_SIMILARITY_THRESHOLD) {
```
where `heuristics` is destructured from `options` at the top of `buildDigestWithStats`:
```ts
const { seenKeys, hours, limit, now = new Date(), skipRe = DEFAULT_SKIP_RE, match, matchMode = 'all', heuristics } = options;
```

- [ ] **Step 5: Run everything**

Run: `bun run typecheck && bun test`
Expected: green. If the golden fixture or a digest test changes because of whole-word matching, inspect the title: the plan accepts the delta only when the old match was a substring false positive (e.g. "rain" in "Ukraine"). Anything else is a bug in `terms.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/scoring.ts src/digest.ts test/unit/scoring.test.ts
git commit -m "refactor(scoring): read source tiers, boosts, synonyms from config"
```

---

### Task 6: Importance reads its slice; `FILTER_PROMPT` and `IMPORTANCE_THRESHOLD` retire

**Files:**
- Modify: `src/importance.ts`, `src/digest.ts:86`, `src/render.ts` (threshold), `src/index.ts` (`--prompt`), `src/lib.ts`, `src/core.ts`
- Test: `test/unit/importance.test.ts`, `test/unit/render.test.ts` (threshold references)

**Interfaces:**
- Produces:
  - `scoreImportance(title: string, importance: ImportanceConfig | undefined): ImportanceResult` — `undefined` → `{ importance: 0, signals: [], tier: 'neutral' }`. Signals are `displayTerm`-ed (no `*`).
  - `importanceThreshold(importance: ImportanceConfig | undefined): number` — `undefined` → `Number.POSITIVE_INFINITY` (nothing is ever "Important").
- Removed exports: `IMPORTANCE_THRESHOLD`, `FILTER_PROMPT`, `BREAKING_MARKERS`, `IMPACT_MARKERS`, `FLUFF_MARKERS`.

- [ ] **Step 1: Rewrite `test/unit/importance.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { importanceThreshold, scoreImportance } from '../../src/importance';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { ImportanceConfig } from '../../src/config/schema';

const importance = DEFAULT_CONFIG.importance!;
const threshold = importanceThreshold(importance);

describe('scoreImportance with the default config', () => {
  test('breaking-safety headline is tier "breaking" and above threshold', () => {
    const r = scoreImportance('UAE intercepts ballistic missile over Abu Dhabi airspace', importance);
    expect(r.tier).toBe('breaking');
    expect(r.importance).toBeGreaterThanOrEqual(threshold);
    expect(r.signals).toEqual(expect.arrayContaining(['missile', 'airspace']));
  });

  test('stem markers match inflections and are reported without the *', () => {
    const r = scoreImportance('Residents evacuated after gas leak', importance);
    expect(r.tier).toBe('breaking');
    expect(r.signals).toContain('evacuat');
    expect(r.signals.join()).not.toContain('*');
  });

  test('money/rules headline is tier "impact" and above threshold', () => {
    const r = scoreImportance('Dubai rents jump and new visa fees announced', importance);
    expect(r.tier).toBe('impact');
    expect(r.importance).toBeGreaterThanOrEqual(threshold);
    expect(r.signals).toEqual(expect.arrayContaining(['rent', 'visa', 'fees']));
  });

  test('PR puff headline is tier "fluff", negative, below threshold', () => {
    const r = scoreImportance("Dubai unveils world's tallest tower at glittering festival", importance);
    expect(r.tier).toBe('fluff');
    expect(r.importance).toBeLessThan(0);
  });

  test('plain headline is tier "neutral" with no signals', () => {
    const r = scoreImportance('Local council holds routine monthly meeting', importance);
    expect(r.tier).toBe('neutral');
    expect(r.importance).toBeLessThan(threshold);
    expect(r.signals).toHaveLength(0);
  });

  test('breaking outranks fluff when both are present', () => {
    expect(scoreImportance('Airport closed after attack; ribbon-cutting ceremony cancelled', importance).tier).toBe('breaking');
  });

  test('whole-word matching avoids false positives', () => {
    expect(scoreImportance('Council reviews current routine procedures', importance).signals).not.toContain('rent');
    expect(scoreImportance('Dubai taxi drivers complete training programme', importance).signals).not.toContain('tax');
    expect(scoreImportance('Dubai lawyer profiled in weekend feature', importance).signals).not.toContain('law');
  });
});

describe('scoreImportance with custom or absent config', () => {
  test('uses the configured weights and penalty', () => {
    const custom: ImportanceConfig = {
      threshold: 5,
      breaking: { weight: 10, markers: ['quake'] },
      fluff: { penalty: 1, markers: ['gala'] },
    };
    const r = scoreImportance('Quake shakes city gala', custom);
    expect(r.importance).toBe(9);
    expect(r.tier).toBe('breaking');
    expect(importanceThreshold(custom)).toBe(5);
  });

  test('is neutral when importance is not configured', () => {
    expect(scoreImportance('UAE intercepts missile', undefined)).toEqual({ importance: 0, signals: [], tier: 'neutral' });
    expect(importanceThreshold(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/unit/importance.test.ts`
Expected: FAIL — `importanceThreshold` is not exported.

- [ ] **Step 3: Rewrite `src/importance.ts`**

```ts
// src/importance.ts
import { displayTerm, findTerms } from './terms';
import type { ImportanceConfig } from './config/schema';

export type ImportanceTier = 'breaking' | 'impact' | 'neutral' | 'fluff';

export type ImportanceResult = {
  importance: number;
  signals: string[];
  tier: ImportanceTier;
};

/** Items at or above this score are promoted to the 🚨 Important block. No config → never. */
export function importanceThreshold(importance: ImportanceConfig | undefined): number {
  return importance?.threshold ?? Number.POSITIVE_INFINITY;
}

export function scoreImportance(title: string, importance: ImportanceConfig | undefined): ImportanceResult {
  if (!importance) return { importance: 0, signals: [], tier: 'neutral' };

  const breaking = findTerms(title, importance.breaking?.markers ?? []);
  const impact = findTerms(title, importance.impact?.markers ?? []);
  const fluff = findTerms(title, importance.fluff?.markers ?? []);

  const score =
    breaking.length * (importance.breaking?.weight ?? 0) +
    impact.length * (importance.impact?.weight ?? 0) -
    fluff.length * (importance.fluff?.penalty ?? 0);

  let tier: ImportanceTier;
  if (breaking.length > 0) tier = 'breaking';
  else if (score < 0) tier = 'fluff';
  else if (impact.length > 0) tier = 'impact';
  else tier = 'neutral';

  return { importance: score, signals: [...breaking, ...impact, ...fluff].map(displayTerm), tier };
}
```

- [ ] **Step 4: Update call sites**

`src/digest.ts`: `const imp = scoreImportance(title, heuristics.importance);`

`src/render.ts`: replace `import { IMPORTANCE_THRESHOLD } from './importance';` with `import { importanceThreshold } from './importance';`. In `renderDigest` and `renderTopicalDigest` compute `const threshold = importanceThreshold(heuristics.importance);` at the top and replace every `i.importance >= IMPORTANCE_THRESHOLD` with `i.importance >= threshold`.

`src/index.ts`: remove `import { FILTER_PROMPT } from './importance';`. Replace the `--prompt` branch body:

```ts
if (options.prompt) {
  const prompt = DEFAULT_CONFIG.agentPrompt;
  if (!prompt) throw new Error('The built-in config has no agentPrompt; nothing to print.');
  process.stdout.write(prompt + '\n');
  return;
}
```

`src/lib.ts` and `src/core.ts`: change the importance export line to
```ts
export { scoreImportance, importanceThreshold } from './importance';
```

`test/unit/render.test.ts`: replace `import { IMPORTANCE_THRESHOLD } from '../../src/importance';` with `import { importanceThreshold } from '../../src/importance';` and add `const IMPORTANCE_THRESHOLD = importanceThreshold(DEFAULT_CONFIG.importance);` after the imports (keeps the existing assertions readable).

- [ ] **Step 5: Run everything**

Run: `bun run typecheck && bun test`
Expected: green. `cli.test.ts` has a `--prompt` test that checks the prompt text; it must still pass because `default.json` carries the same string.

- [ ] **Step 6: Commit**

```bash
git add src test
git commit -m "refactor(importance): read markers, weights, threshold from config"
```

---

### Task 7: Digest builder reads skip list, threshold, and match terms from config

**Files:**
- Modify: `src/digest.ts`
- Test: `test/integration/digest.test.ts`

**Interfaces:**
- `BuildDigestOptions` loses `skipRe`; `heuristics.skip` (string list) replaces it. `heuristics.dedupe.similarityThreshold` replaces `FUZZY_SIMILARITY_THRESHOLD` (fallback `0.45` when `dedupe` is absent).
- `matchTerms(title, match, mode)` keeps its signature but uses `matchesTerm` from `./terms`.
- Removed: `DEFAULT_SKIP_RE`, `FUZZY_SIMILARITY_THRESHOLD`, the `escapeRegExp` import.

- [ ] **Step 1: Add failing tests to `test/integration/digest.test.ts`**

Append inside the existing `describe('buildDigest', ...)` block (or a new `describe`):

```ts
import { parseConfig } from '../../src/config/schema';
```
(add to the imports at the top), then:

```ts
describe('buildDigest heuristics come from the config', () => {
  const now = new Date('2026-03-22T08:00:00Z');
  const base = { seenKeys: new Set<string>(), hours: 36, limit: 6, now };
  const items: RssItem[] = [
    { title: 'UAE football roundup', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'MSN' },
    { title: 'Dubai flight status updates after rain', pubDate: 'Sun, 22 Mar 2026 06:45:00 GMT', source: 'Khaleej Times' },
  ];

  test('skip list drops matching titles and sources', () => {
    const cfg = parseConfig({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A', query: 'q' }], skip: ['football'] }, 'test');
    const digest = buildDigest(items, { ...base, heuristics: cfg });
    expect(digest.map((d) => d.title)).toEqual(['Dubai flight status updates after rain']);
  });

  test('no skip list keeps everything, and neutral heuristics score 0', () => {
    const cfg = parseConfig({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A', query: 'q' }] }, 'test');
    const digest = buildDigest(items, { ...base, heuristics: cfg });
    expect(digest).toHaveLength(2);
    expect(digest.every((d) => d.score === 0 && d.importance === 0 && d.tier === 'neutral')).toBe(true);
  });

  test('similarity threshold from config controls fuzzy dedupe', () => {
    const pair: RssItem[] = [
      { title: 'UAE says it intercepted 5 Iranian missiles, 17 drones', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'UAE air defences engage 5 ballistic missiles, 17 UAVs on March 24', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'Gulf News' },
    ];
    const strict = parseConfig({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A', query: 'q' }], dedupe: { ...DEFAULT_CONFIG.dedupe, similarityThreshold: 0.99 } }, 'test');
    expect(buildDigest(pair, { ...base, heuristics: DEFAULT_CONFIG })).toHaveLength(1);
    expect(buildDigest(pair, { ...base, heuristics: strict })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/integration/digest.test.ts`
Expected: the "skip list" and "no skip list" tests FAIL (the built-in regex still drops "football"/"MSN" regardless of config).

- [ ] **Step 3: Rewrite the top of `src/digest.ts` and the filter loop**

Replace the imports and constants:

```ts
import { normalizeTitle, normalizeSource, makeKey } from './normalize';
import { scoreItem, titleSimilarity } from './scoring';
import { scoreImportance, type ImportanceTier } from './importance';
import { matchesTerm } from './terms';
import type { Heuristics, MatchMode } from './config/schema';
import type { RssItem } from './rss';

export type { MatchMode } from './config/schema';

const DEFAULT_SIMILARITY_THRESHOLD = 0.45;
```

`matchTerms` body:

```ts
const matchedTerms = match.filter((t) => matchesTerm(title, t));
```

`BuildDigestOptions` without `skipRe`:

```ts
export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  match?: string[];
  matchMode?: MatchMode;
  heuristics: Heuristics;
};
```

Inside `buildDigestWithStats`:

```ts
const { seenKeys, hours, limit, now = new Date(), match, matchMode = 'all', heuristics } = options;
const skip = heuristics.skip ?? [];
const similarityThreshold = heuristics.dedupe?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
// ...
if (!title) continue;
if (skip.some((t) => matchesTerm(title, t) || matchesTerm(source, t))) continue;
// ...
if (titleSimilarity(title, existingItem.title, heuristics.dedupe) >= similarityThreshold) {
```

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/digest.ts test/integration/digest.test.ts
git commit -m "refactor(digest): skip list, similarity threshold, match terms from config"
```

---

### Task 8: Emoji rules from config

**Files:**
- Modify: `src/render.ts`
- Test: `test/unit/render.test.ts`

**Interfaces:**
- `emojiFor(title: string, rules: readonly EmojiRule[] | undefined): string` — first rule with a matching term wins; `undefined`/no match → `'•'`.

- [ ] **Step 1: Rewrite the `emojiFor` block in `test/unit/render.test.ts`**

```ts
describe('emojiFor with the default rules', () => {
  const rules = DEFAULT_CONFIG.emoji;
  test.each([
    ['Heavy rain expected', '🌧️'],
    ['Unstable weather conditions', '🌧️'],
    ['Property prices surge', '📉'],
    ['Dubai market overview', '📉'],
    ['Airport reopens after delays', '✈️'],
    ['Airspace closed for safety', '✈️'],
    ['Missile intercepted', '🛡️'],
    ['Drone attack reported', '🛡️'],
    ['Hormuz strait tensions', '⛴️'],
    ['Hezbollah funding traced', '🚨'],
    ['Terrorism charges filed', '🚨'],
    ['Schools reopen after break', '🎓'],
    ['Oil prices drop sharply', '🛢️'],
    ['Something completely unrelated', '•'],
  ])('%s → %s', (title, emoji) => {
    expect(emojiFor(title, rules)).toBe(emoji);
  });

  test('first matching rule wins', () => {
    // "rain" (rule 1) beats "airport" (rule 3)
    expect(emojiFor('Dubai airport reopens after rain', rules)).toBe('🌧️');
  });
});

describe('emojiFor with custom or absent rules', () => {
  test('Unicode terms work', () => {
    expect(emojiFor('нестабильная погода обрушивается', [{ emoji: '🌧️', terms: ['погода'] }])).toBe('🌧️');
  });
  test('returns the bullet when no rules are configured', () => {
    expect(emojiFor('Heavy rain expected', undefined)).toBe('•');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test test/unit/render.test.ts`
Expected: FAIL — `emojiFor` ignores the second argument / type error.

- [ ] **Step 3: Rewrite `emojiFor` and its call site in `src/render.ts`**

```ts
import { matchesTerm } from './terms';
import type { EmojiRule, Heuristics } from './config/schema';

/** First rule whose term appears in the title wins; no rules or no match → "•". */
export function emojiFor(title: string, rules: readonly EmojiRule[] | undefined): string {
  const rule = rules?.find((r) => r.terms.some((t) => matchesTerm(title, t)));
  return rule?.emoji ?? '•';
}
```

`formatItemLine` gains an `emoji: readonly EmojiRule[] | undefined` parameter after `showSignals`, and uses `emojiFor(item.title, emoji)`; both render functions pass `heuristics.emoji`.

```ts
function formatItemLine(item: DigestItem, translations: Map<string, string> | undefined, now: Date, indent: string, showSignals: boolean, emoji: readonly EmojiRule[] | undefined): string {
  const title = translations?.get(item.title) ?? item.title;
  const hoursAgo = Math.round((now.getTime() - item.publishedAt.getTime()) / 3_600_000);
  const marker = showSignals && item.signals.length > 0 ? ` [${item.signals.join(', ')}]` : '';
  return `${indent}${emojiFor(item.title, emoji)} ${title} (${item.source}, ${hoursAgo}h ago)${marker}`;
}
```

Update every `formatItemLine(...)` call: `formatItemLine(item, translations, now, '  ', true, heuristics.emoji)` and `formatItemLine(item, translations, now, '', false, heuristics.emoji)` / `formatItemLine(item, translations, now, '  ', false, heuristics.emoji)`.

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun test`
Expected: green; golden fixture still `🌧️ Dubai airport reopens after rain` and `📉 Abu Dhabi market overview`.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/unit/render.test.ts
git commit -m "refactor(render): emoji rules from config"
```

---

### Task 9: Replace `topics.ts` with `config/load`, user configs carry their own heuristics

**Files:**
- Modify: `src/index.ts`, `src/pipeline.ts`, `src/render.ts` (type import), `src/lib.ts`, `src/core.ts`
- Delete: `src/topics.ts`, `test/unit/topics.test.ts`
- Modify tests: `test/integration/topical-digest.test.ts`, `test/cli.test.ts`

**Interfaces:**
- `RunTopicalDigestOptions.config: DigestConfig`; the `heuristics` field added in Task 4 is removed again — the topical runner uses `opts.config` as the heuristics source.
- `TopicFetcher = (topic: Topic) => Promise<string>`.
- CLI: `--topics-config` value is passed as `explicit` to `resolveConfigPath`; a found config is loaded with `loadConfig`; region mode keeps passing `DEFAULT_CONFIG`.
- Barrels export: `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `DigestConfigSchema` and types `DigestConfig`, `Topic`, `Locale`, `Display`, `MatchMode`, `Heuristics`, `ScoringConfig`, `DedupeConfig`, `ImportanceConfig`, `EmojiRule`, `ResolveConfigOptions`. They stop exporting `loadTopicsConfig`, `resolveTopicsConfigPath`, `TopicConfig`, `TopicsConfig`, `ResolveTopicsConfigOptions`.

- [ ] **Step 1: Update `test/integration/topical-digest.test.ts`**

Replace the type import and the `topic()` helper with config built through the schema:

```ts
import { parseConfig } from '../../src/config/schema';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { DigestConfig } from '../../src/config/schema';

const LOCALE = { hl: 'en', gl: 'AE', ceid: 'AE:en' };

/** Build a validated config from partial topics; heuristics default to the built-in UAE set so existing assertions hold. */
function config(topics: Record<string, unknown>[], extra: Record<string, unknown> = {}): DigestConfig {
  const { locale: _l, display: _d, topics: _t, ...heuristics } = DEFAULT_CONFIG;
  return parseConfig({ locale: LOCALE, topics, ...heuristics, ...extra }, 'test');
}
```

Then convert every inline `config: { locale: ..., topics: [topic({...}), ...] }` into `config: config([{ slug: 'economy', name: 'Economy', emoji: '💰', limit: 2 , query: 'q' }, ...])` (the `topic()` helper defaulted `query: 'q'` and `limit: 5`; the schema defaults `limit` but `query` is required, so add `query: 'q'` where missing). Remove every `heuristics: DEFAULT_CONFIG,` line added in Task 4. Add one new test:

```ts
test('a config without heuristic sections produces neutral items', async () => {
  const result = await runTopicalDigest({
    config: parseConfig({ locale: LOCALE, topics: [{ slug: 'a', name: 'A', query: 'q' }] }, 'test'),
    seenKeys: new Set(),
    hours: 36,
    fetchTopicRss: async () => rssXml([{ title: 'Missile intercepted over Abu Dhabi airspace', source: 'Reuters', pubDate: NOW.toUTCString() }]),
    now: NOW,
  });
  expect(result.sections[0]!.items[0]).toMatchObject({ score: 0, importance: 0, tier: 'neutral', signals: [] });
  expect(result.output).not.toContain('🚨 Important');
  expect(result.output).toContain('• Missile intercepted');
});
```

- [ ] **Step 2: Update `test/cli.test.ts` topics-mode configs**

In `writeTopicsCwd()` and the `--topics-config` test, add `locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },` to each written config object (locale is now required). Nothing else in these tests asserts on heuristics.

- [ ] **Step 3: Run to verify failure**

Run: `bun test test/integration/topical-digest.test.ts test/cli.test.ts`
Expected: topical tests FAIL on type/shape (`heuristics` still required, `TopicConfig` import missing); CLI topics tests FAIL because the CLI still uses the old loader which does not know `locale`-less rejection... (they may pass — that is fine; the goal of this step is to see the suite state before the switch).

- [ ] **Step 4: Update `src/pipeline.ts`**

```ts
import type { DigestConfig, Heuristics, Topic } from './config/schema';
```
Remove the `./topics` import. `TopicSection.topic: Topic`. `TopicFetcher = (topic: Topic) => Promise<string>`. `RunTopicalDigestOptions`:

```ts
export type RunTopicalDigestOptions = {
  config: DigestConfig;
  seenKeys: Set<string>;
  hours: number;
  limitOverride?: number;
  fetchTopicRss: TopicFetcher;
  now?: Date;
  deeplAuthKey?: string;
  targetLang?: string;
};
```

Inside `runTopicalDigest`: `heuristics: opts.config,` in the `buildDigestWithStats` call and `renderTopicalDigest(sections, translations, now, localeContextFor(opts.config.locale.gl), opts.config)`.

`RunDigestOptions.heuristics: Heuristics` stays (region mode has no config).

- [ ] **Step 5: Update `src/render.ts` type import**

Replace `import type { TopicSection } from './pipeline';` — keep it; it now resolves to `Topic` from the schema through `pipeline.ts`. No other change.

- [ ] **Step 6: Update `src/index.ts`**

Imports:

```ts
import { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from './config/load';
import type { DigestConfig, Topic } from './config/schema';
```
Remove `import { loadTopicsConfig, resolveTopicsConfigPath } from './topics';` and `import type { TopicConfig, TopicsConfig } from './topics';`.

`TopicsRunArgs.config: DigestConfig`. `makeFetcher` parameter type `topic: Topic`. In the main action:

```ts
let topicsConfig: DigestConfig | null = null;
let topicsConfigPath: string | null = null;
if (options.topics !== false) {
  topicsConfigPath = await resolveConfigPath({
    explicit: options.topicsConfig,
    cwd: process.cwd(),
    env: process.env as Record<string, string | undefined>,
  });
  if (topicsConfigPath) {
    topicsConfig = await loadConfig(topicsConfigPath);
  }
}
```

In `runInTopicsMode`, delete the `heuristics: DEFAULT_CONFIG,` line from the `runTopicalDigest({...})` call (the runner now reads `config`).

- [ ] **Step 7: Update barrels**

`src/core.ts` — replace the last two lines with:

```ts
export { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from './config/load';
export type { ResolveConfigOptions } from './config/load';
export { DigestConfigSchema, parseConfig } from './config/schema';
export type { DigestConfig, Topic, Locale, Display, MatchMode, Heuristics, ScoringConfig, DedupeConfig, ImportanceConfig, EmojiRule } from './config/schema';
```
and remove `MatchMode` from the `./digest` type export line (it now comes from the schema).

`src/lib.ts` — same replacement for its last two lines and the same `MatchMode` removal.

- [ ] **Step 8: Delete the superseded files**

```bash
git rm src/topics.ts test/unit/topics.test.ts
```

- [ ] **Step 9: Run everything**

Run: `bun run typecheck && bun test && bun run smoke:pack`
Expected: green. `grep -rn "topics'" src test` returns nothing.

- [ ] **Step 10: Commit**

```bash
git add src test
git commit -m "refactor(config): replace topics.ts with zod-backed config loader; user configs own their heuristics"
```

---

### Task 10: Changelog, docs touch-ups, PR

**Files:**
- Modify: `CHANGELOG.md`, `README.md` (topics config section), `CLAUDE.md` (export count sentence)

- [ ] **Step 1: CHANGELOG `[Unreleased]`**

```markdown
## [Unreleased]

### Added
- Config schema (validated with `zod`) now carries every heuristic: `skip`, `scoring` (source tiers, title boosts), `dedupe` (similarity threshold, synonyms, stop words), `importance` (markers, weights, threshold), `emoji` rules, `display`, and `agentPrompt`. A built-in UAE config (`src/config/default.json`) reproduces the previous hard-coded behaviour.
- Programmatic API: `loadConfig`, `resolveConfigPath`, `parseConfig`, `DEFAULT_CONFIG`, `DigestConfigSchema`, and the `DigestConfig` / `Topic` / `Heuristics` types.

### Changed
- **Breaking (config):** `locale` is required in a topics config; unknown keys are rejected.
- **Breaking (behaviour):** a topics config without heuristic sections now runs with neutral heuristics (no source/keyword boosts, no 🚨 Important block, `•` emoji, no skip list). Copy the sections you want from `src/config/default.json`.
- **Breaking (API):** `loadTopicsConfig` → `loadConfig`, `resolveTopicsConfigPath` → `resolveConfigPath`, `TopicConfig` → `Topic`, `TopicsConfig` → `DigestConfig`; `scoreItem`, `titleSimilarity`, `scoreImportance`, `emojiFor`, `buildDigest*`, `runDigest`, `runTopicalDigest`, `renderDigest`, `renderTopicalDigest` take a config slice. Removed: `IMPORTANCE_THRESHOLD`, `FILTER_PROMPT`, `BREAKING_MARKERS`, `IMPACT_MARKERS`, `FLUFF_MARKERS`, `TIER_*_RE`, `escapeRegExp` (moved to `terms`).
- Term lists match whole words (with `s`/`es` plural) and support a trailing `*` for stem matching; previously scoring, emoji and skip matched raw substrings (e.g. "rain" fired on "Ukraine").
```

- [ ] **Step 2: README topics-config section**

In the topics config example add `"locale": { "hl": "en", "gl": "AE", "ceid": "AE:en" },` as the first key, and add one paragraph after the example:

```markdown
Heuristics (skip list, source tiers, keyword boosts, dedupe synonyms, importance markers, emoji rules, the `--prompt` text) also live in this file. A config without those sections runs neutral. Start from the built-in UAE set in [`src/config/default.json`](src/config/default.json).
```

- [ ] **Step 3: CLAUDE.md**

Change `18 exports including \`parseRss\`, \`buildDigest\`, \`runDigest\`, \`renderDigest\`` to `exports \`parseRss\`, \`buildDigest\`, \`runDigest\`, \`renderDigest\`, \`loadConfig\`, \`DEFAULT_CONFIG\` among others` and add one line under Project Overview:

```
Heuristics (skip, scoring, dedupe, importance, emoji) come from the config — never hard-code region knowledge in `src/*.ts`; the built-in UAE set lives in `src/config/default.json`.
```

- [ ] **Step 4: Final verification and push**

Run: `bun run typecheck && bun test && bun run smoke:pack`
Expected: all green.

```bash
git add CHANGELOG.md README.md CLAUDE.md
git commit -m "docs: config-driven heuristics, breaking notes for the schema change"
git push -u origin refactor/config-schema
gh pr create --title "refactor: zod config schema, heuristics in config, built-in UAE default (1/4)" --body-file - <<'EOF'
## Summary
PR 1 of 4 for the unified-config refactor (spec: docs/superpowers/specs/2026-09-05-unified-config-refactor-design.md).

- `zod` schema for the config; every heuristic (skip, scoring, dedupe, importance, emoji, agentPrompt, display) is configurable.
- Built-in UAE config `src/config/default.json` reproduces today's lists and weights; used when no config file is found and by region mode.
- Pipeline modules take config slices; no module-level UAE constants remain.
- One Unicode-aware term matcher (`src/terms.ts`) for every list.
- `src/topics.ts` replaced by `src/config/{schema,load}.ts`.

## Behaviour deltas
See CHANGELOG `[Unreleased]`: required `locale`, neutral heuristics for configs without sections, whole-word term matching.

## Verification
`bun test`, `bun run typecheck`, `bun run smoke:pack` green locally on macOS.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

---

## Self-review

**Spec coverage (section 1 + PR 1 staging):** schema fields and defaults → Task 2; no regexes in config / `*` stems → Tasks 1–2; built-in default validated by a test → Task 3; discovery order unchanged, flag rename deferred to PR 2 (spec staging puts flag changes in PR 2) → Task 3/9; not-in-config run parameters untouched → all tasks; modules take slices → Tasks 5–8; region mode still works from `DEFAULT_CONFIG` → Tasks 4, 9; renderer Russian strings → deliberately left to PR 2 (render is rewritten there). `display` is parsed and defaulted but not yet rendered — PR 2 uses it.

**Placeholders:** none; every code step carries the code.

**Type consistency:** `Heuristics` defined in Task 2, consumed in Tasks 4–9 with that exact name. `RenderHeuristics` defined in Task 4 and used in Task 8. `importanceThreshold` introduced in Task 6 and used in render in the same task. `DigestConfig`/`Topic` names used identically in Tasks 3, 4, 9. `MatchMode` moves to the schema in Task 4 and is re-exported from `digest.ts` so barrels compile until Task 9 removes the duplicate export.
