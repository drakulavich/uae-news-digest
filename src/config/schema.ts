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

export const DEFAULT_SIMILARITY_THRESHOLD = 0.45;

/**
 * A dedupe token: compared by exact equality against title words, which are
 * lower-cased and stripped of everything but ASCII letters and digits. Anything
 * else (spaces, punctuation, "*") could never match, so it is rejected up front;
 * case is normalised in the transform below.
 */
const DedupeToken = z
  .string()
  .trim()
  .min(1, 'dedupe tokens must be non-empty strings')
  .regex(/^[A-Za-z0-9]+$/, 'dedupe tokens are single words: ASCII letters and digits only');

export const DedupeSchema = z
  .strictObject({
    similarityThreshold: z.number().min(0, 'similarityThreshold must be within 0..1').max(1, 'similarityThreshold must be within 0..1').default(DEFAULT_SIMILARITY_THRESHOLD),
    synonyms: z.record(DedupeToken, DedupeToken).default({}),
    stopWords: z.array(DedupeToken).default([]),
  })
  .transform((d) => ({
    ...d,
    synonyms: Object.fromEntries(Object.entries(d.synonyms).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])),
    stopWords: d.stopWords.map((w) => w.toLowerCase()),
  }));

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
