import { join } from 'node:path';
import type { RssLocale } from './region';
import type { MatchMode } from './digest';

const DEFAULT_LOCALE: Omit<RssLocale, 'q'> = { hl: 'en', gl: 'AE', ceid: 'AE:en' };
const DEFAULT_TOPIC_LIMIT = 5;

export type TopicConfig = {
  slug: string;
  name: string;
  emoji?: string;
  query: string;
  match?: string[];
  matchMode?: MatchMode;
  limit: number;
  locale: Omit<RssLocale, 'q'>;
};

export type TopicsConfig = {
  locale: Omit<RssLocale, 'q'>;
  topics: TopicConfig[];
};

export async function loadTopicsConfig(path: string): Promise<TopicsConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Topics config not found: ${path}`);
  }

  let raw: unknown;
  try {
    raw = await file.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse topics config at ${path}: ${msg}`);
  }

  return validate(raw, path);
}

function validate(raw: unknown, path: string): TopicsConfig {
  if (!isObject(raw)) {
    throw new Error(`Topics config at ${path} must be a JSON object`);
  }

  const localeRaw = raw.locale;
  const locale: Omit<RssLocale, 'q'> =
    localeRaw === undefined
      ? { hl: DEFAULT_LOCALE.hl, gl: DEFAULT_LOCALE.gl, ceid: DEFAULT_LOCALE.ceid }
      : parseLocale(localeRaw, `${path} → locale`);

  const topicsRaw = raw.topics;
  if (!Array.isArray(topicsRaw) || topicsRaw.length === 0) {
    throw new Error(
      `Topics config at ${path} must define at least one topic in the "topics" array`,
    );
  }

  const topics: TopicConfig[] = [];
  const seenSlugs = new Set<string>();
  for (let i = 0; i < topicsRaw.length; i++) {
    const t = topicsRaw[i];
    const where = `${path} → topics[${i}]`;
    if (!isObject(t)) throw new Error(`${where} must be an object`);

    const slug = requireString(t.slug, `${where}.slug`);
    const name = requireString(t.name, `${where}.name`);
    const query = requireString(t.query, `${where}.query`);
    const emoji = t.emoji === undefined ? undefined : requireString(t.emoji, `${where}.emoji`);

    let match: string[] | undefined;
    let matchMode: MatchMode | undefined;
    if (t.match !== undefined) {
      if (!Array.isArray(t.match) || t.match.length === 0) {
        throw new Error(`${where}.match must be a non-empty array of strings (got ${JSON.stringify(t.match)})`);
      }
      match = t.match.map((m, j) => requireString(m, `${where}.match[${j}]`));

      if (t.matchMode === undefined) {
        matchMode = 'all';
      } else if (t.matchMode === 'all' || t.matchMode === 'any') {
        matchMode = t.matchMode;
      } else if (typeof t.matchMode === 'number' && Number.isInteger(t.matchMode) && t.matchMode > 0) {
        matchMode = t.matchMode;
      } else {
        throw new Error(`${where}.matchMode must be "all", "any", or a positive integer (got ${JSON.stringify(t.matchMode)})`);
      }
    } else if (t.matchMode !== undefined) {
      throw new Error(`${where}.matchMode requires a "match" array to be set`);
    }

    let limit = DEFAULT_TOPIC_LIMIT;
    if (t.limit !== undefined) {
      if (typeof t.limit !== 'number' || !Number.isInteger(t.limit) || t.limit <= 0) {
        throw new Error(
          `${where}.limit must be a positive integer (got ${JSON.stringify(t.limit)})`,
        );
      }
      limit = t.limit;
    }

    const topicLocale =
      t.locale === undefined ? locale : parseLocale(t.locale, `${where}.locale`);

    if (seenSlugs.has(slug)) {
      throw new Error(`Topics config at ${path}: duplicate slug "${slug}"`);
    }
    seenSlugs.add(slug);

    topics.push({ slug, name, emoji, query, match, matchMode, limit, locale: topicLocale });
  }

  return { locale, topics };
}

function parseLocale(raw: unknown, where: string): Omit<RssLocale, 'q'> {
  if (!isObject(raw)) throw new Error(`${where} must be an object with hl/gl/ceid`);
  return {
    hl: requireString(raw.hl, `${where}.hl`),
    gl: requireString(raw.gl, `${where}.gl`),
    ceid: requireString(raw.ceid, `${where}.ceid`),
  };
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${where} must be a non-empty string`);
  }
  return value.trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type ResolveTopicsConfigOptions = {
  explicit?: string;
  cwd: string;
  env: Record<string, string | undefined>;
};

export async function resolveTopicsConfigPath(
  opts: ResolveTopicsConfigOptions,
): Promise<string | null> {
  if (opts.explicit !== undefined) {
    if (opts.explicit === '' || !(await Bun.file(opts.explicit).exists())) {
      throw new Error(`Topics config not found: ${opts.explicit}`);
    }
    return opts.explicit;
  }

  if (!opts.cwd) {
    throw new Error('resolveTopicsConfigPath: cwd is required');
  }

  const cwdCandidate = join(opts.cwd, 'digest.config.json');
  if (await Bun.file(cwdCandidate).exists()) return cwdCandidate;

  const xdg = opts.env.XDG_CONFIG_HOME
    ?? (opts.env.HOME ? join(opts.env.HOME, '.config') : null);
  if (xdg) {
    const xdgCandidate = join(xdg, 'uae-news-digest', 'topics.json');
    if (await Bun.file(xdgCandidate).exists()) return xdgCandidate;
  }

  return null;
}
