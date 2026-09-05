#!/usr/bin/env bun
import { Command } from 'commander';
import { dirname } from 'node:path';
import { DEFAULT_STATE_FILE, readSeenKeys, writeSeenKeys } from './state';
import { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from './config/load';
import { runDigest } from './pipeline';
import { renderText } from './render';
import { toJson } from './json';
import { buildFeedUrl } from './url';
import { translateDeepL } from './translate';
import { BIN_NAME, TOOL_ID, VERSION } from './meta';
import type { DigestConfig } from './config/schema';
import type { FetchText, Translate } from './pipeline';

const DESCRIPTION = 'Daily UAE news digest from Google News RSS with optional DeepL translation';
const USER_AGENT = 'Mozilla/5.0 (uae-news-digest)';

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

/** fetch with a timeout and human-readable failures; one call per topic feed. */
function makeFetchText(timeoutMs: number): FetchText {
  return async (url) => {
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const e = err as { name?: string; code?: string; message?: string };
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new Error(`RSS request timed out after ${timeoutMs}ms — retry, or pass --timeout-ms 30000`);
      }
      const detail = e.code ?? e.message ?? String(err);
      throw new Error(`Unable to connect to ${new URL(url).host} — check your connection (${detail})`);
    }
    if (!response.ok) {
      throw new Error(`RSS fetch failed: HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  };
}

function makeTranslate(deeplAuthKey: string | undefined): Translate | undefined {
  if (!deeplAuthKey) return undefined;
  return (texts, targetLang) => translateDeepL(texts, deeplAuthKey, targetLang);
}

const HELP = `
WHAT IT DOES
  Fetches one Google News RSS feed per topic, filters each to a lookback window
  (--hours), scores and de-duplicates articles against a seen-items state file,
  and prints one section per topic. Human-readable text by default; --json for
  machines.

CONFIG (auto-detected)
  Topics and heuristics come from a JSON config, found in this order:
    1. --config <path>
    2. ./digest.config.json  (current directory)
    3. $XDG_CONFIG_HOME/uae-news-digest/topics.json  (or ~/.config/...)
  Without a config the built-in UAE set is used (one topic, UAE heuristics).

OUTPUT
  Default: formatted digest text on stdout; warnings on stderr.
  --json : a single JSON object on stdout:
    {
      "tool", "version", "generatedAt",
      "query": { "hours", "limit" | null, "targetLang" | null },
      "topics": [ { "slug", "name", "count" } ],
      "count", "warnings": string[],
      "items": [ {
        "topic":           string,
        "title":           string,
        "translatedTitle": string | null,
        "source":          string,
        "url":             string | null,                // Google News article link
        "publishedAt":     string,                       // ISO-8601 UTC
        "hoursAgo":        number,
        "score":           number,
        "importance":      number,
        "tier":            "breaking" | "impact" | "neutral" | "fluff",
        "signals":         string[],
        "matchedTerms":    string[]
      } ]
    }
  In --json mode warnings go into the "warnings" array (not stderr).

STATE & DEDUP
  Seen article keys are persisted to --state-file (default ./seen_titles.txt) and
  skipped on later runs. A run only writes state when it produced items AND
  --dry-run is absent. Use --dry-run for any throwaway/inspection run.

AGENT FILTER (key-free smart pass)
  --prompt PRINTS a ready-made filter instruction and exits. Pipe the JSON items
  into an LLM with that instruction as the prompt:
    uae-news-digest --json --dry-run | claude "$(uae-news-digest --prompt)"

ENV VARS
  DEEPL_AUTH_KEY            Required by --target-lang (DeepL translation).
  UAE_NEWS_DIGEST_NOW       Override "now" (ISO-8601) for deterministic runs/tests.
  XDG_CONFIG_HOME / HOME    Used to locate the config (see CONFIG).

SUBCOMMANDS
  manifest                 Print a machine-readable tool descriptor as JSON.
  healthcheck [--rss-url]  Smoke-test the feed; prints {ok,version,latencyMs};
                           exits 0 on success, 1 on failure.

EXIT CODES
  0 success (a topic may still have failed — see warnings)
  1 no topic could be fetched, or a config/usage error (reason on stderr)

EXAMPLES
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --config ./digest.config.json --json
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE
  uae-news-digest --json --dry-run | claude "$(uae-news-digest --prompt)"`;

const FLAGS = [
  '--config <path>',
  '--hours <n>',
  '--limit <n>',
  '--state-file <path>',
  '--timeout-ms <n>',
  '--target-lang <code>',
  '--dry-run',
  '--prompt',
  '--json',
];

const program = new Command();

program
  .name(TOOL_ID)
  .description(DESCRIPTION)
  .version(VERSION)
  .option('--json', 'output as JSON', false)
  .option('--config <path>', 'path to the digest config JSON (overrides auto-detect)')
  .option('--state-file <path>', 'path to seen-items state file', DEFAULT_STATE_FILE)
  .option('--hours <number>', 'lookback window in hours', '36')
  .option('--limit <number>', "max items per topic (overrides each topic's limit)")
  .option('--timeout-ms <number>', 'RSS fetch timeout in milliseconds', '15000')
  .option('--target-lang <code>', 'translate via DeepL (requires DEEPL_AUTH_KEY)')
  .option('--dry-run', 'print digest without updating state file', false)
  .option('--prompt', 'print the agent filter prompt and exit', false)
  .addHelpText('after', HELP);

program
  .command('manifest')
  .description('Print tool manifest as JSON')
  .action(() => {
    console.log(JSON.stringify({
      id: TOOL_ID,
      version: VERSION,
      runtime: 'bun',
      bin: BIN_NAME,
      description: DESCRIPTION,
      commands: [
        {
          name: '(default)',
          description: 'Fetch and print news digest',
          flags: FLAGS,
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
      const rssUrl = options.rssUrl ?? buildFeedUrl(DEFAULT_CONFIG.topics[0]!);
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

program.action(async (options) => {
  try {
    if (options.prompt) {
      const prompt = DEFAULT_CONFIG.agentPrompt;
      if (!prompt) throw new Error('The built-in config has no agentPrompt; nothing to print.');
      process.stdout.write(prompt + '\n');
      return;
    }

    const hours = validatePositiveNumber('hours', options.hours);
    const limitOverride = options.limit === undefined ? undefined : validatePositiveNumber('limit', options.limit);
    const timeoutMs = validatePositiveNumber('timeout-ms', options.timeoutMs);
    const deeplAuthKey = process.env.DEEPL_AUTH_KEY;
    const now = resolveNow(process.env.UAE_NEWS_DIGEST_NOW);

    if (options.targetLang && !deeplAuthKey) {
      console.error(`--target-lang requires DEEPL_AUTH_KEY to be set.`);
      process.exitCode = 1;
      return;
    }

    const configPath = await resolveConfigPath({
      explicit: options.config,
      cwd: process.cwd(),
      env: process.env as Record<string, string | undefined>,
    });
    const config: DigestConfig = configPath ? await loadConfig(configPath) : DEFAULT_CONFIG;

    await Bun.$`mkdir -p ${dirname(options.stateFile)}`.quiet();
    const seenKeys = await readSeenKeys(options.stateFile);

    if (options.targetLang && deeplAuthKey) {
      console.error(`Translating to ${options.targetLang} via DeepL...`);
    }

    const result = await runDigest({
      config,
      seenKeys,
      hours,
      limitOverride,
      now,
      fetchText: makeFetchText(timeoutMs),
      translate: makeTranslate(deeplAuthKey),
      targetLang: options.targetLang,
    });

    if (options.json) {
      const json = toJson(result, { tool: TOOL_ID, version: VERSION, hours, limit: limitOverride, targetLang: options.targetLang, now });
      process.stdout.write(JSON.stringify(json, null, 2) + '\n');
    } else {
      for (const warning of result.warnings) console.error(warning);
      process.stdout.write(renderText(result, config, now) + '\n');
    }

    if (result.fetchedTopics === 0) {
      if (options.json) for (const warning of result.warnings) console.error(warning);
      process.exitCode = 1;
      return;
    }

    if (options.dryRun) console.error('(dry run — state file not updated)');
    const producedItems = result.sections.some((s) => s.items.length > 0);
    if (producedItems && !options.dryRun) {
      await writeSeenKeys(options.stateFile, result.nextSeenKeys);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
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
