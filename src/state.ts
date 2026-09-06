import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink } from 'node:fs/promises';
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
  // A missing directory fails here, on the directory itself; an existing but unwritable one fails on the write below and is reported against the state file.
  await mkdir(dir, { recursive: true });
  const tmpFile = join(dir, `.${basename(stateFile)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await Bun.write(tmpFile, `${[...seenKeys].sort().join('\n')}\n`);
    await rename(tmpFile, stateFile);
  } catch (error) {
    await unlink(tmpFile).catch((cleanupError: unknown) => {
      if ((cleanupError as { code?: string }).code === 'ENOENT') return; // the temp file was never created
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      console.error(`Failed to remove temporary state file ${tmpFile}: ${message}`);
    });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot write state file ${stateFile}: ${message}`);
  }
}
