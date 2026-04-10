import { Command } from 'commander';
import { dirname } from 'node:path';
import {
  DEFAULT_RSS_URL,
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
  .option('--format <format>', 'output format: json, table', 'json')
  .option('--rss-url <url>', 'RSS URL to fetch', DEFAULT_RSS_URL)
  .option('--state-file <path>', 'path to seen-items state file', DEFAULT_STATE_FILE)
  .option('--hours <number>', 'lookback window in hours', '36')
  .option('--limit <number>', 'max items in digest', '6')
  .option('--timeout-ms <number>', 'RSS fetch timeout in milliseconds', '15000')
  .option('--target-lang <code>', 'DeepL target language code (e.g. RU, DE, FR)', 'RU')
  .option('--dry-run', 'print digest without updating state file', false)
  .option('--no-translate', 'skip DeepL, use keyword fallback (RU) or raw English')
  .addHelpText('after', `
Example:
  uae-news-digest --hours 12 --limit 10 --target-lang DE
  uae-news-digest --dry-run --format table
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang FR`);

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
          flags: ['--hours <n>', '--limit <n>', '--state-file <path>', '--target-lang <code>', '--dry-run', '--no-translate', '--format <json|table>'],
          examples: ['uae-news-digest --hours 12 --limit 10 --target-lang DE'],
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
  const fmt = options.format ?? 'json';
  try {
    const hours = validatePositiveNumber('hours', options.hours);
    const limit = validatePositiveNumber('limit', options.limit);
    const timeoutMs = validatePositiveNumber('timeout-ms', options.timeoutMs);
    const targetLang: string = options.targetLang ?? 'RU';

    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
    const seenKeys = await readSeenKeys(options.stateFile);

    const response = await fetch(options.rssUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (uae-news-digest)' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`RSS fetch failed: HTTP ${response.status} ${response.statusText}. Check --rss-url or try again.`);
      process.exit(1);
    }

    const xml = await response.text();
    const deeplAuthKey = process.env.DEEPL_AUTH_KEY;
    const translate = options.translate !== false;

    if (translate && deeplAuthKey) {
      console.error(`Translating to ${targetLang} via DeepL...`);
    }

    const result = await runDigest({
      xml,
      seenKeys,
      hours,
      limit,
      translate,
      deeplAuthKey,
      targetLang,
    });

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
