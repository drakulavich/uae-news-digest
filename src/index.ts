#!/usr/bin/env bun
import { Command } from 'commander';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  buildRssUrl,
  DEFAULT_STATE_FILE,
  mergeSeenKeysIntoState,
  readSeenKeys,
  runDigest,
} from './lib';
import { loadTopicsConfig, resolveTopicsConfigPath } from './topics';
import { runTopicalDigest } from './pipeline';
import type { TopicConfig, TopicsConfig } from './topics';
import { BIN_NAME, TOOL_ID, VERSION } from './meta';
import { FILTER_PROMPT } from './importance';
import { commitAgentRun, createAgentRun, loadAgentInstructions } from './agent';

function validatePositiveNumber(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return value;
}

function parseMatchMode(raw: string): 'all' | 'any' | number {
  if (raw === 'all' || raw === 'any') return raw;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid --match-mode: ${raw} (use all | any | positive integer)`);
  return n;
}

function resolveNow(raw: string | undefined): Date {
  if (!raw) return new Date();
  const now = new Date(raw);
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid UAE_NEWS_DIGEST_NOW: ${raw}`);
  }
  return now;
}

const program = new Command();

program
  .name(TOOL_ID)
  .description('Daily UAE news digest from Google News RSS with optional DeepL translation')
  .version(VERSION)
  .option('--json', 'output as JSON', false)
  .option('--region <code>', 'news region preset (uae, us, uk, de)', 'uae')
  .option('--rss-url <url>', 'RSS URL (overrides --region)')
  .option('--state-file <path>', 'path to seen-items state file', DEFAULT_STATE_FILE)
  .option('--hours <number>', 'lookback window in hours', '36')
  .option('--limit <number>', 'max items in digest', '6')
  .option('--timeout-ms <number>', 'RSS fetch timeout in milliseconds', '15000')
  .option('--target-lang <code>', 'translate via DeepL (requires DEEPL_AUTH_KEY)')
  .option('--topics-config <path>', 'path to topics config JSON (overrides auto-detect)')
  .option('--no-topics', 'force legacy region mode even if a topics config is present')
  .option('--dry-run', 'print digest without updating state file', false)
  .option('--match <terms...>', 'require these keywords in the title (region mode)')
  .option('--match-mode <mode>', 'how many --match terms to require: all | any | <N>', 'all')
  .option('--prompt', 'print the agent filter prompt and exit', false)
  .addHelpText('after', `
WHAT IT DOES
  Fetches a Google News RSS feed, filters to a lookback window (--hours), scores
  and de-duplicates articles against a seen-items state file, and prints the top
  --limit items. Human-readable text by default; machine-readable with --json.

MODES (auto-detected)
  region  (default) One RSS feed chosen by --region (uae|us|uk|de) or --rss-url.
                    Optional title keyword gate via --match / --match-mode.
  topics            Per-topic digest. Enabled automatically when a topics config
                    is found, in this order:
                      1. --topics-config <path>
                      2. ./digest.config.json  (current directory)
                      3. $XDG_CONFIG_HOME/uae-news-digest/topics.json  (or ~/.config/...)
                    Force plain region mode with --no-topics. In topics mode
                    --region and --rss-url are ignored (a note is sent to stderr).

OUTPUT
  Default: formatted digest text on stdout; warnings on stderr.
  --json : a single JSON object on stdout:
    {
      "tool", "version",
      "mode": "region" | "topics",
      "query": { "hours", "limit"?, "targetLang" },
      "topics"?: [ { "slug", "name", "count" } ],   // topics mode only
      "count", "warnings": string[],
      "items": [ {
        "topic"?:      string,                       // topics mode only
        "title":       string,
        "source":      string,
        "score":       number,
        "publishedAt": string,                       // ISO-8601 UTC
        "hoursAgo":    number,
        "importance":  number,
        "tier":        "breaking" | "impact" | "neutral" | "fluff",
        "signals":     string[],
        "matchedTerms": string[],
        "googleUrl":   string | null                 // Google News article link
      } ]
    }
  In --json mode warnings go into the "warnings" array (not stderr).

STATE & DEDUP
  Seen article keys are persisted to --state-file (default ./seen_titles.txt) and
  skipped on later runs. A run only writes state when it produced items AND
  --dry-run is absent. Use --dry-run for any throwaway/inspection run so it does
  not hide those articles from the next scheduled digest.

AGENT FILTER (key-free smart pass)
  Use an explicit two-step protocol. agent collect returns broad candidates,
  the built-in criterion, custom rules, and a run ID without changing state.
  After filtering, call agent commit --run-id <id> with zero or more --keep IDs.
  Candidate runs expire after 24 hours.
    uae-news-digest agent collect --hours 168
    uae-news-digest agent commit --run-id <id> --keep <item-id>
  Persistent rules: $XDG_CONFIG_HOME/uae-news-digest/filter.md (or ~/.config/...)
  Add one-run rules with repeated --filter-rule <text>. --prompt remains available
  to print only the built-in criterion for legacy integrations.

ENV VARS
  DEEPL_AUTH_KEY            Required by --target-lang (DeepL translation).
  UAE_NEWS_DIGEST_NOW       Override "now" (ISO-8601) for deterministic runs/tests.
  XDG_CONFIG_HOME / HOME    Used to locate the topics config (see MODES).

SUBCOMMANDS
  manifest                 Print a machine-readable tool descriptor (id, version,
                           flags, envVars) as JSON. Use this to discover the tool.
  healthcheck [--rss-url]  Smoke-test the feed; prints {ok,version,latencyMs};
                           exits 0 on success, 1 on failure.

EXIT CODES
  0 success   1 fetch/timeout/validation error (a human-readable reason is
  printed to stderr; on timeout retry with --timeout-ms 30000).

EXAMPLES
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --region us
  uae-news-digest --json
  uae-news-digest --json --hours 168 --limit 168 --dry-run    # weekly, no state write
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE
  uae-news-digest manifest
  uae-news-digest healthcheck
  uae-news-digest agent collect --hours 168
  uae-news-digest agent commit --run-id <id> --keep <item-id>`);

// ── Manifest subcommand (inlined from @openclaw/cli-common) ──

program
  .command('manifest')
  .description('Print tool manifest as JSON')
  .action(() => {
    console.log(JSON.stringify({
      id: TOOL_ID,
      version: VERSION,
      runtime: 'bun',
      bin: BIN_NAME,
      description: 'Daily UAE news digest from Google News RSS with optional DeepL translation',
      commands: [
        {
          name: '(default)',
          description: 'Fetch and print news digest',
          flags: [
            '--region <code>',
            '--rss-url <url>',
            '--hours <n>',
            '--limit <n>',
            '--state-file <path>',
            '--timeout-ms <n>',
            '--target-lang <code>',
            '--topics-config <path>',
            '--no-topics',
            '--dry-run',
            '--match <terms...>',
            '--match-mode <mode>',
            '--prompt',
            '--json',
          ],
          examples: ['uae-news-digest --hours 12 --limit 10'],
        },
        {
          name: 'agent collect',
          description: 'Collect a broad region-mode candidate digest for an external agent',
          flags: ['--hours <n>', '--limit <n> (default: 200)', '--state-file <path>', '--rss-url <url>', '--region <code>', '--filter-rule <text> (repeatable)'],
          examples: ['uae-news-digest agent collect --hours 168'],
        },
        {
          name: 'agent commit',
          description: 'Record a filtering decision and return selected candidates',
          flags: ['--run-id <id> (required)', '--keep <item-id> (repeatable)'],
          examples: ['uae-news-digest agent commit --run-id <id> --keep <item-id>'],
        },
      ],
      envVars: ['DEEPL_AUTH_KEY', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'],
    }, null, 2));
  });

// ── Agent workflow ──

const agent = program
  .command('agent')
  .description('Collect and explicitly commit an external agent filtering decision');

agent
  .command('collect')
  .description('Return region-mode JSON candidates and filtering instructions without updating state')
  .option('--limit <number>', 'max candidate items', '200')
  .option('--filter-rule <text>', 'additional filtering rule (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
  .action(async function (this: Command, options: { limit: string; filterRule: string[] }) {
    const global = this.optsWithGlobals() as {
      region: string;
      rssUrl?: string;
      stateFile: string;
      hours: string;
      timeoutMs: string;
      topicsConfig?: string;
      match?: string[];
      matchMode: string;
    };
    if (this.getOptionValueSourceWithGlobals('topicsConfig') === 'cli') {
      throw new Error('Agent collection is region-only; remove --topics-config and run `uae-news-digest agent collect` again.');
    }

    const hours = validatePositiveNumber('hours', global.hours);
    const limit = validatePositiveNumber(
      'limit',
      program.getOptionValueSource('limit') === 'cli' ? program.opts().limit : options.limit,
    );
    const timeoutMs = validatePositiveNumber('timeout-ms', global.timeoutMs);
    const now = resolveNow(process.env.UAE_NEWS_DIGEST_NOW);
    const seenKeys = await readSeenKeys(global.stateFile);
    const rssUrl = global.rssUrl ?? buildRssUrl(global.region);
    const response = await fetch(rssUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (uae-news-digest)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`RSS fetch failed: HTTP ${response.status} ${response.statusText}. Check --rss-url or try again.`);
    }

    const result = await runDigest({
      xml: await response.text(),
      seenKeys,
      hours,
      limit,
      region: global.region,
      now,
      match: global.match,
      matchMode: global.match ? parseMatchMode(global.matchMode) : undefined,
    });
    const instructions = await loadAgentInstructions(options.filterRule, process.env);
    const run = await createAgentRun({
      stateFile: resolve(global.stateFile),
      digest: result.digest,
      now,
    }, process.env);
    process.stdout.write(JSON.stringify({
      tool: TOOL_ID,
      version: VERSION,
      runId: run.runId,
      mode: 'region',
      query: { hours, candidateLimit: limit },
      count: run.candidates.length,
      instructions,
      items: run.candidates,
      next: { command: 'agent commit', runId: run.runId },
    }, null, 2) + '\n');
  });

agent
  .command('commit')
  .description('Persist reviewed candidates and return only selected items')
  .requiredOption('--run-id <id>', 'run identifier from agent collect')
  .option('--keep <item-id>', 'candidate ID to keep (repeatable)', (value: string, previous: string[] = []) => [...previous, value], [])
  .action(async function (this: Command, options: { runId: string; keep: string[] }) {
    const now = resolveNow(process.env.UAE_NEWS_DIGEST_NOW);
    const result = await commitAgentRun(options.runId, options.keep, now, process.env);
    process.stdout.write(JSON.stringify({
      tool: TOOL_ID,
      version: VERSION,
      runId: result.runId,
      count: result.count,
      items: result.items,
    }, null, 2) + '\n');
  });

program
  .command('healthcheck')
  .description('Run smoke test and report status')
  .option('--rss-url <url>', 'RSS URL for deterministic smoke testing')
  .action(async function (this: Command) {
    const start = performance.now();
    try {
      const options = this.optsWithGlobals() as { rssUrl?: string };
      const rssUrl = options.rssUrl ?? buildRssUrl('uae');
      const res = await fetch(rssUrl, { signal: AbortSignal.timeout(10000) });
      const result = { ok: res.ok, version: VERSION, latencyMs: Math.round(performance.now() - start) };
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const result = { ok: false, version: VERSION, latencyMs: Math.round(performance.now() - start), error: message };
      console.log(JSON.stringify(result));
      process.exit(1);
    }
  });

// ── Topics-mode helpers ──

type TopicsRunArgs = {
  config: TopicsConfig;
  configPath: string;
  options: { region: string; rssUrl?: string; targetLang?: string; json: boolean; dryRun: boolean; stateFile: string };
  hours: number;
  limit: number;
  timeoutMs: number;
  deeplAuthKey: string | undefined;
  now: Date;
  seenKeys: Set<string>;
};

async function runInTopicsMode(args: TopicsRunArgs): Promise<void> {
  const { config, configPath, options, hours, limit, timeoutMs, deeplAuthKey, now, seenKeys } = args;

  const regionSource = program.getOptionValueSource('region');
  if (regionSource === 'cli') {
    console.error(`--region "${options.region}" ignored: topics config in use (${configPath})`);
  }
  if (options.rssUrl) {
    console.error(`--rss-url ignored: topics config in use (${configPath})`);
  }

  const limitOverride = program.getOptionValueSource('limit') === 'cli' ? limit : undefined;

  const result = await runTopicalDigest({
    config,
    seenKeys,
    hours,
    limitOverride,
    fetchTopicRss: makeFetcher(timeoutMs),
    now,
    deeplAuthKey,
    targetLang: options.targetLang,
  });

  if (!options.json) {
    for (const w of result.warnings) console.error(w);
  }

  if (options.json) {
    const items = result.sections.flatMap((s) =>
      s.items.map((d) => ({
        topic: s.topic.slug,
        title: d.title,
        source: d.source,
        score: d.score,
        publishedAt: d.publishedAt.toISOString(),
        hoursAgo: Math.round((now.getTime() - d.publishedAt.getTime()) / 3_600_000),
        importance: d.importance,
        tier: d.tier,
        signals: d.signals,
        matchedTerms: d.matchedTerms ?? [],
        googleUrl: d.link ?? null,
      })),
    );
    process.stdout.write(JSON.stringify({
      tool: TOOL_ID,
      version: VERSION,
      mode: 'topics',
      query: { hours, targetLang: options.targetLang ?? null },
      topics: result.sections.map((s) => ({
        slug: s.topic.slug,
        name: s.topic.name,
        count: s.items.length,
      })),
      count: items.length,
      warnings: result.warnings,
      items,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(result.output + '\n');
  }

  if (options.dryRun) console.error('(dry run — state file not updated)');
  const wroteAny = result.sections.some((s) => s.items.length > 0);
  if (wroteAny && !options.dryRun) {
    await mergeSeenKeysIntoState(options.stateFile, result.nextSeenKeys);
  }
}

function makeFetcher(timeoutMs: number) {
  return async (topic: TopicConfig): Promise<string> => {
    const fixture = process.env.UAE_NEWS_DIGEST_TOPIC_FIXTURE;
    if (fixture) return await readFile(fixture, 'utf-8');

    const url = buildRssUrl({
      q: topic.query,
      hl: topic.locale.hl,
      gl: topic.locale.gl,
      ceid: topic.locale.ceid,
    });
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (uae-news-digest)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  };
}

// ── Main action ──

program.action(async (options) => {
  try {
    if (options.prompt) {
      process.stdout.write(FILTER_PROMPT + '\n');
      return;
    }

    const hours = validatePositiveNumber('hours', options.hours);
    const limit = validatePositiveNumber('limit', options.limit);
    const timeoutMs = validatePositiveNumber('timeout-ms', options.timeoutMs);
    const deeplAuthKey = process.env.DEEPL_AUTH_KEY;
    const now = resolveNow(process.env.UAE_NEWS_DIGEST_NOW);

    if (options.targetLang && !deeplAuthKey) {
      console.error(`--target-lang requires DEEPL_AUTH_KEY to be set.`);
      process.exit(1);
    }

    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
    const seenKeys = await readSeenKeys(options.stateFile);

    let topicsConfig: TopicsConfig | null = null;
    let topicsConfigPath: string | null = null;
    if (options.topics !== false) {
      topicsConfigPath = await resolveTopicsConfigPath({
        explicit: options.topicsConfig,
        cwd: process.cwd(),
        env: process.env as Record<string, string | undefined>,
      });
      if (topicsConfigPath) {
        topicsConfig = await loadTopicsConfig(topicsConfigPath);
      }
    }

    if (topicsConfig) {
      await runInTopicsMode({
        config: topicsConfig,
        configPath: topicsConfigPath!,
        options,
        hours,
        limit,
        timeoutMs,
        deeplAuthKey,
        now,
        seenKeys,
      });
      return;
    }

    const rssUrl = options.rssUrl ?? buildRssUrl(options.region);

    const response = await fetch(rssUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (uae-news-digest)' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`RSS fetch failed: HTTP ${response.status} ${response.statusText}. Check --rss-url or try again.`);
      process.exit(1);
    }

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
      region: options.region,
      now,
      match: options.match,
      matchMode: options.match ? parseMatchMode(options.matchMode) : undefined,
    });

    if (!options.json) {
      for (const warning of result.warnings) {
        console.error(warning);
      }
    }

    if (options.json) {
      process.stdout.write(JSON.stringify({
        tool: TOOL_ID,
        version: VERSION,
        mode: 'region',
        query: { hours, limit, targetLang: options.targetLang ?? null },
        count: result.digest.length,
        warnings: result.warnings,
        items: result.digest.map(d => ({
          title: d.title,
          source: d.source,
          score: d.score,
          publishedAt: d.publishedAt.toISOString(),
          hoursAgo: Math.round((now.getTime() - d.publishedAt.getTime()) / 3_600_000),
          importance: d.importance,
          tier: d.tier,
          signals: d.signals,
          matchedTerms: d.matchedTerms ?? [],
          googleUrl: d.link ?? null,
        })),
      }, null, 2) + '\n');
    } else {
      process.stdout.write(result.output + '\n');
    }

    if (options.dryRun) {
      console.error('(dry run — state file not updated)');
    }

    if (result.digest.length > 0 && !options.dryRun) {
      await mergeSeenKeysIntoState(options.stateFile, result.nextSeenKeys);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('timeout') || message.includes('TimeoutError') || message.includes('AbortError')) {
      console.error(`RSS feed did not respond within the timeout. Retry, or pass --timeout-ms 30000.`);
    } else if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('fetch failed') || message.includes('NetworkError')) {
      console.error(`Could not reach news.google.com. Check your connection.`);
    } else {
      console.error(message);
    }
    process.exit(1);
  }
});

// ── Global error handling ──

process.on('uncaughtException', (err) => {
  console.error(err.message);
  process.exit(1);
});

program.exitOverride();
try {
  await program.parseAsync(process.argv);
} catch (err: any) {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  }
  console.error(err.message);
  process.exit(1);
}
