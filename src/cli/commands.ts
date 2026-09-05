import type { Command } from 'commander';
import defaultJson from '../config/default.json';
import { loadConfig, resolveConfigPath } from '../config/load';
import { buildFeedUrl } from '../url';
import { BIN_NAME, DESCRIPTION, TOOL_ID, VERSION } from '../meta';
import { CliError } from './errors';
import { resolveConfig, type CliEnv } from './run';

/** `manifest`: machine-readable tool descriptor on stdout; flags and subcommands come from the program itself. */
export function manifest(program: Command): number {
  const flags = program.options.filter((o) => o.long !== '--version').map((o) => o.flags);
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
        flags,
        examples: ['uae-news-digest --hours 12 --limit 10'],
      },
      ...program.commands.map((c) => ({ name: c.name(), description: c.description() })),
    ],
    envVars: ['DEEPL_AUTH_KEY'],
  }, null, 2));
  return 0;
}

/** `healthcheck`: GET `--rss-url`, else the first topic of the resolved config; {ok, version, latencyMs} on stdout. */
export async function healthcheck(opts: { rssUrl?: string; config?: string }, env: CliEnv, cwd: string): Promise<number> {
  const start = performance.now();
  try {
    const rssUrl = opts.rssUrl ?? buildFeedUrl((await resolveConfig(opts.config, env, cwd)).config.topics[0]!);
    const res = await fetch(rssUrl, { signal: AbortSignal.timeout(10_000) });
    const result = { ok: res.ok, version: VERSION, latencyMs: Math.round(performance.now() - start) };
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ ok: false, version: VERSION, latencyMs: Math.round(performance.now() - start), error: message }));
    return 1;
  }
}

/** `config print-default`: the built-in config exactly as shipped, for copying into digest.config.json. */
export function configPrintDefault(): number {
  console.log(JSON.stringify(defaultJson, null, 2));
  return 0;
}

/** `config validate [path]`: run the file (or the discovered config) through the schema. */
export async function configValidate(explicit: string | undefined, env: CliEnv, cwd: string): Promise<number> {
  let path: string | null;
  try {
    path = await resolveConfigPath({ explicit, cwd, env });
  } catch (err) {
    throw new CliError('config', err instanceof Error ? err.message : String(err));
  }
  if (!path) {
    console.error('No config found — pass a path, or create ./digest.config.json (start from `config print-default`).');
    return 1;
  }
  try {
    const config = await loadConfig(path);
    console.log(`ok — ${path}: ${config.topics.length} topic(s)`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
