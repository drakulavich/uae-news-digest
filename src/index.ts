#!/usr/bin/env bun
import { Command } from 'commander';
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  buildRssUrl,
  DEFAULT_STATE_FILE,
  readSeenKeys,
  runDigest,
  writeSeenKeys,
} from './lib';
import { loadTopicsConfig, resolveTopicsConfigPath } from './topics';
import { runTopicalDigest } from './pipeline';
import type { TopicConfig, TopicsConfig } from './topics';
import { BIN_NAME, TOOL_ID, VERSION } from './meta';

function validatePositiveNumber(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return value;
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
  .option('--json', 'output as JSON', false)
  .option('--region <code>', 'news region preset (uae, us, uk, de, ru)', 'uae')
  .option('--rss-url <url>', 'RSS URL (overrides --region)')
  .option('--state-file <path>', 'path to seen-items state file', DEFAULT_STATE_FILE)
  .option('--hours <number>', 'lookback window in hours', '36')
  .option('--limit <number>', 'max items in digest', '6')
  .option('--timeout-ms <number>', 'RSS fetch timeout in milliseconds', '15000')
  .option('--target-lang <code>', 'translate via DeepL (requires DEEPL_AUTH_KEY)')
  .option('--topics-config <path>', 'path to topics config JSON (overrides auto-detect)')
  .option('--no-topics', 'force legacy region mode even if a topics config is present')
  .option('--dry-run', 'print digest without updating state file', false)
  .addHelpText('after', `
Example:
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --region us
  uae-news-digest --json
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE`);

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
          flags: ['--region <code>', '--rss-url <url>', '--hours <n>', '--limit <n>', '--state-file <path>', '--target-lang <code>', '--dry-run', '--json'],
          examples: ['uae-news-digest --hours 12 --limit 10'],
        },
      ],
      envVars: ['DEEPL_AUTH_KEY'],
    }, null, 2));
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
    await writeSeenKeys(options.stateFile, result.nextSeenKeys);
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
        })),
      }, null, 2) + '\n');
    } else {
      process.stdout.write(result.output + '\n');
    }

    if (options.dryRun) {
      console.error('(dry run — state file not updated)');
    }

    if (result.digest.length > 0 && !options.dryRun) {
      await writeSeenKeys(options.stateFile, result.nextSeenKeys);
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
