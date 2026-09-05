import { readSeenKeys, writeSeenKeys } from '../state';
import { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from '../config/load';
import type { DigestConfig } from '../config/schema';
import { runDigest } from '../pipeline';
import { renderText } from '../render';
import { toJson } from '../json';
import { TOOL_ID, VERSION } from '../meta';
import { makeFetchText, makeTranslate } from './adapters';
import { CliError } from './errors';

export type CliEnv = Record<string, string | undefined>;

/** Commander's option object for the default command (camelCased flag names). */
export type RunFlags = {
  json: boolean;
  config?: string;
  stateFile: string;
  hours: string | number;
  limit?: string | number;
  timeoutMs: string | number;
  targetLang?: string;
  dryRun: boolean;
  prompt: boolean;
};

export function validatePositiveNumber(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliError('usage', `Invalid --${name}: ${raw}`);
  }
  return value;
}

export function validatePositiveInteger(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError('usage', `Invalid --${name}: ${raw} — expected a positive integer`);
  }
  return value;
}

export function resolveNow(raw: string | undefined): Date {
  if (!raw) return new Date();
  const now = new Date(raw);
  if (Number.isNaN(now.getTime())) {
    throw new CliError('usage', `Invalid UAE_NEWS_DIGEST_NOW: ${raw}`);
  }
  return now;
}

/** The config to run with, plus a label for messages: the file path, or "built-in default config". */
export async function resolveConfig(explicit: string | undefined, env: CliEnv, cwd: string): Promise<{ config: DigestConfig; source: string }> {
  try {
    const path = await resolveConfigPath({ explicit, cwd, env });
    if (!path) return { config: DEFAULT_CONFIG, source: 'built-in default config' };
    return { config: await loadConfig(path), source: path };
  } catch (err) {
    throw new CliError('config', err instanceof Error ? err.message : String(err));
  }
}

/** The default command. Returns the exit code; throws CliError for usage/config problems. */
export async function runDefault(flags: RunFlags, env: CliEnv, cwd: string): Promise<number> {
  if (flags.prompt) {
    const prompt = DEFAULT_CONFIG.agentPrompt;
    if (!prompt) throw new CliError('config', 'The built-in config has no agentPrompt; nothing to print.');
    process.stdout.write(prompt + '\n');
    return 0;
  }

  const hours = validatePositiveNumber('hours', flags.hours);
  const limitOverride = flags.limit === undefined ? undefined : validatePositiveInteger('limit', flags.limit);
  const timeoutMs = validatePositiveNumber('timeout-ms', flags.timeoutMs);
  const deeplAuthKey = env.DEEPL_AUTH_KEY;
  const now = resolveNow(env.UAE_NEWS_DIGEST_NOW);

  if (flags.targetLang && !deeplAuthKey) {
    throw new CliError('usage', '--target-lang requires DEEPL_AUTH_KEY — set it to your DeepL Free API key, or drop --target-lang.');
  }

  const { config } = await resolveConfig(flags.config, env, cwd);
  const seenKeys = await readSeenKeys(flags.stateFile);

  if (flags.targetLang && deeplAuthKey) {
    console.error(`Translating to ${flags.targetLang} via DeepL...`);
  }

  const result = await runDigest({
    config,
    seenKeys,
    hours,
    limitOverride,
    now,
    fetchText: makeFetchText(timeoutMs),
    translate: makeTranslate(deeplAuthKey),
    targetLang: flags.targetLang,
  });

  if (flags.json) {
    const json = toJson(result, { tool: TOOL_ID, version: VERSION, hours, limit: limitOverride, targetLang: flags.targetLang, now });
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
  } else {
    for (const warning of result.warnings) console.error(warning);
    process.stdout.write(renderText(result, config, now) + '\n');
  }

  if (result.fetchedTopics === 0) {
    if (flags.json) for (const warning of result.warnings) console.error(warning);
    return 1;
  }

  if (flags.dryRun) console.error('(dry run — state file not updated)');
  const producedItems = result.sections.some((s) => s.items.length > 0);
  if (producedItems && !flags.dryRun) {
    await writeSeenKeys(flags.stateFile, result.nextSeenKeys);
  }
  return 0;
}
