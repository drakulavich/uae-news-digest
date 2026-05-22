import { randomUUID } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

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
    await unlink(tmpFile).catch(() => {});
    throw error;
  }
}
