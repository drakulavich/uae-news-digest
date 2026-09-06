import { Command, CommanderError } from 'commander';
import { DEFAULT_STATE_FILE } from '../state';
import { DESCRIPTION, TOOL_ID, VERSION } from '../meta';
import { runDefault, type RunFlags } from './run';
import { type CliEnv } from './config';
import { configPrintDefault, configValidate, healthcheck, manifest } from './commands';
import { CliError } from './errors';

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
  In --json mode warnings go into the "warnings" array; they are also echoed to stderr when the run exits 1.

STATE & DEDUP
  Seen article keys are persisted to --state-file (default ./seen_titles.txt) and
  skipped on later runs. A run only writes state when it produced items AND
  --dry-run is absent. Use --dry-run for any throwaway/inspection run.

AGENT FILTER (key-free smart pass)
  --prompt PRINTS the "agentPrompt" from the resolved config and exits. Pipe the
  JSON items into an LLM with that instruction as the prompt:
    uae-news-digest --json --dry-run | claude "$(uae-news-digest --prompt)"

ENV VARS
  DEEPL_AUTH_KEY            Required by --target-lang (DeepL translation).
  UAE_NEWS_DIGEST_NOW       Override "now" (ISO-8601) for deterministic runs/tests.
  XDG_CONFIG_HOME / HOME    Used to locate the config (see CONFIG).

SUBCOMMANDS
  manifest                 Print a machine-readable tool descriptor as JSON.
  healthcheck [--rss-url]  Smoke-test the first topic's feed (or --rss-url); prints
                           {ok,version,latencyMs}; exits 0 on success, 1 on failure.
  config print-default     Print the built-in config as JSON to copy and edit.
  config validate [path]   Validate a config file (default: the auto-detected one);
                           prints "ok" or every issue with its JSON path.

EXIT CODES
  0 success (a topic may still have failed — see warnings)
  1 no topic could be fetched, or a config/usage error (reason on stderr)

EXAMPLES
  uae-news-digest --hours 12 --limit 10
  uae-news-digest --config ./digest.config.json --json
  DEEPL_AUTH_KEY=xxx uae-news-digest --target-lang DE
  uae-news-digest --json --dry-run | claude "$(uae-news-digest --prompt)"`;

/**
 * The Commander program. Actions never exit the process: each one hands its exit code to `onExit`,
 * and `main` turns that (or a thrown error) into the return value.
 */
export function buildProgram(onExit: (code: number) => void, env: CliEnv, cwd: string): Command {
  const program = new Command();
  program.exitOverride(); // before .command(): subcommands inherit it at creation time

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
    .addHelpText('after', HELP)
    .action(async (flags: RunFlags) => onExit(await runDefault(flags, env, cwd)));

  program
    .command('manifest')
    .description('Print tool manifest as JSON')
    .action(() => onExit(manifest(program)));

  program
    .command('healthcheck')
    .description('Run smoke test and report status')
    .option('--rss-url <url>', 'RSS URL for deterministic smoke testing')
    .action(async function (this: Command) {
      const opts = this.optsWithGlobals() as { rssUrl?: string; config?: string };
      onExit(await healthcheck(opts, env, cwd));
    });

  const config = program
    .command('config')
    .description('Print or validate the digest config');
  config
    .command('print-default')
    .description('Print the built-in config as JSON (copy it to ./digest.config.json and edit)')
    .action(() => onExit(configPrintDefault()));
  config
    .command('validate [path]')
    .description('Validate a config file, or the one auto-detected when no path is given')
    .action(async function (this: Command, path: string | undefined) {
      const opts = this.optsWithGlobals() as { config?: string };
      if (path !== undefined && opts.config !== undefined && path !== opts.config) {
        throw new CliError('usage', 'Pass the config as either a positional path or --config, not both.');
      }
      onExit(await configValidate(path ?? opts.config, env, cwd));
    });

  return program;
}

/** Parse argv and run; the only place that decides the exit code. Never throws. */
export async function main(
  argv: string[],
  env: CliEnv = process.env,
  cwd: string = process.cwd(),
  build: typeof buildProgram = buildProgram,
): Promise<number> {
  let exitCode: number | undefined;
  const program = build((code) => { exitCode = code; }, env, cwd);
  try {
    await program.parseAsync(argv);
    if (exitCode === undefined) {
      console.error('internal error: the command finished without reporting an exit code');
      return 1;
    }
    return exitCode;
  } catch (err) {
    // --help / --version (exitCode 0) and usage errors (exitCode 1, message already printed by commander)
    if (err instanceof CommanderError) return err.exitCode;
    if (err instanceof CliError) {
      console.error(err.message);
    } else {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
    return 1;
  }
}
