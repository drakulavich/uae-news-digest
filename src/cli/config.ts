import { DEFAULT_CONFIG, loadConfig, resolveConfigPath } from '../config/load';
import type { DigestConfig } from '../config/schema';
import { CliError } from './errors';

export type CliEnv = Record<string, string | undefined>;

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
