import { join } from 'node:path';
import defaultJson from './default.json';
import { parseConfig, type DigestConfig } from './schema';

/** The UAE config the CLI uses when no config file is found. Validated at import time. */
export const DEFAULT_CONFIG: DigestConfig = parseConfig(defaultJson, 'built-in default config');

export async function loadConfig(path: string): Promise<DigestConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Config not found: ${path}`);
  }

  let raw: unknown;
  try {
    raw = await file.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config at ${path}: ${msg}`);
  }

  return parseConfig(raw, path);
}

export type ResolveConfigOptions = {
  explicit?: string;
  cwd: string;
  env: Record<string, string | undefined>;
};

/**
 * Discovery order (first hit wins):
 *   1. `explicit` (the --config flag) — must exist, otherwise an error
 *   2. <cwd>/digest.config.json
 *   3. $XDG_CONFIG_HOME/uae-news-digest/topics.json, or ~/.config/uae-news-digest/topics.json
 * Returns null when nothing is found; callers fall back to DEFAULT_CONFIG.
 */
export async function resolveConfigPath(opts: ResolveConfigOptions): Promise<string | null> {
  if (opts.explicit !== undefined) {
    if (opts.explicit === '' || !(await Bun.file(opts.explicit).exists())) {
      throw new Error(`Config not found: ${opts.explicit}`);
    }
    return opts.explicit;
  }

  if (!opts.cwd) {
    throw new Error('resolveConfigPath: cwd is required');
  }

  const cwdCandidate = join(opts.cwd, 'digest.config.json');
  if (await Bun.file(cwdCandidate).exists()) return cwdCandidate;

  const xdg = opts.env.XDG_CONFIG_HOME ?? (opts.env.HOME ? join(opts.env.HOME, '.config') : null);
  if (xdg) {
    const xdgCandidate = join(xdg, 'uae-news-digest', 'topics.json');
    if (await Bun.file(xdgCandidate).exists()) return xdgCandidate;
  }

  return null;
}
