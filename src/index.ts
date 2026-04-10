#!/usr/bin/env bun
import { Command } from 'commander';
import { dirname } from 'node:path';
import {
  buildRssUrl,
  DEFAULT_STATE_FILE,
  readSeenKeys,
  runDigest,
  validatePositiveNumber,
  writeSeenKeys,
} from './lib';

const program = new Command();

program
  .name('uae-news-digest')
  .description('Daily UAE news digest from Google News RSS with optional DeepL translation')
  .option('--json', 'output as JSON', false)
  .option('--region <code>', 'news region preset (uae, us, uk, de, ru)', 'uae')
  .option('--rss-url <url>', 'RSS URL (overrides --region)')
  .option('--state-file <path>', 'path to seen-items state file', DEFAULT_STATE_FILE)
  .option('--hours <number>', 'lookback window in hours', '36')
  .option('--limit <number>', 'max items in digest', '6')
  .option('--timeout-ms <number>', 'RSS fetch timeout in milliseconds', '15000')
  .option('--target-lang <code>', 'translate via DeepL (requires DEEPL_AUTH_KEY)')
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
      id: 'uae-news-digest',
      version: '0.1.0',
      runtime: 'bun',
      bin: null,
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
  .action(async () => {
    const start = performance.now();
    try {
      const res = await fetch('https://news.google.com/rss/search?q=UAE&hl=en-AE&gl=AE&ceid=AE:en', { signal: AbortSignal.timeout(10000) });
      const result = { ok: res.ok, version: '0.1.0', latencyMs: Math.round(performance.now() - start) };
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const result = { ok: false, version: '0.1.0', latencyMs: Math.round(performance.now() - start), error: message };
      console.log(JSON.stringify(result));
      process.exit(1);
    }
  });

// ── Main action ──

program.action(async (options) => {
  try {
    const hours = validatePositiveNumber('hours', options.hours);
    const limit = validatePositiveNumber('limit', options.limit);
    const timeoutMs = validatePositiveNumber('timeout-ms', options.timeoutMs);
    const deeplAuthKey = process.env.DEEPL_AUTH_KEY;

    if (options.targetLang && !deeplAuthKey) {
      console.error(`--target-lang requires DEEPL_AUTH_KEY to be set.`);
      process.exit(1);
    }

    const rssUrl = options.rssUrl ?? buildRssUrl(options.region);

    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
    const seenKeys = await readSeenKeys(options.stateFile);

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
    });

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
