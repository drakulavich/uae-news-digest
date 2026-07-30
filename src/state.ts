import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { acquireDirectoryLock } from './lock';

export const DEFAULT_STATE_FILE = './seen_titles.txt';

export async function readSeenKeys(stateFile: string): Promise<Set<string>> {
  const file = Bun.file(stateFile);
  if (!(await file.exists())) return new Set();
  const text = await file.text();
  return new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

export async function writeSeenKeys(stateFile: string, seenKeys: Set<string>): Promise<void> {
  const dir = dirname(stateFile);
  const tmpFile = join(dir, `.${basename(stateFile)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await Bun.write(tmpFile, `${[...seenKeys].sort().join('\n')}\n`);
    await rename(tmpFile, stateFile);
  } catch (error) {
    await unlink(tmpFile).catch((cleanupError: unknown) => {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      console.error(`Failed to remove temporary state file ${tmpFile}: ${message}`);
    });
    throw error;
  }
}

/**
 * Adds keys without losing a concurrent digest update. Every writer using this
 * helper serializes, re-reads the live file after acquiring the lock, and then
 * atomically replaces the merged state.
 */
export async function mergeSeenKeysIntoState(stateFile: string, keys: Iterable<string>): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  const release = await acquireDirectoryLock(`${stateFile}.lock`, `seen-item state: ${stateFile}`);
  try {
    const current = await readSeenKeys(stateFile);
    for (const key of keys) current.add(key);
    await writeSeenKeys(stateFile, current);
  } finally {
    await release();
  }
}
