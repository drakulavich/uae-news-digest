import type { Command } from 'commander';
import { DEFAULT_CONFIG } from '../config/load';
import { buildFeedUrl } from '../url';
import { BIN_NAME, DESCRIPTION, TOOL_ID, VERSION } from '../meta';
import type { CliEnv } from './run';

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

/** `manifest`: machine-readable tool descriptor on stdout. */
export function manifest(_program: Command): number {
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
  return 0;
}

/** `healthcheck`: GET the feed URL and report {ok, version, latencyMs} on stdout. */
export async function healthcheck(opts: { rssUrl?: string }, _env: CliEnv, _cwd: string): Promise<number> {
  const start = performance.now();
  try {
    const rssUrl = opts.rssUrl ?? buildFeedUrl(DEFAULT_CONFIG.topics[0]!);
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
