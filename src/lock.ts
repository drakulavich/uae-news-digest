import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const OWNER_FILE = 'owner.json';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 25;
const UNOWNED_LOCK_STALE_MS = 60_000;

type LockOwner = {
  pid: number;
  createdAt: string;
};

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function processIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    return code !== 'ESRCH';
  }
}

async function staleLock(lockDir: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(join(lockDir, OWNER_FILE), 'utf8')) as LockOwner;
    if (Number.isInteger(owner.pid) && owner.pid > 0) {
      return !(await processIsAlive(owner.pid));
    }
  } catch {
    // A process may die after mkdir but before recording its owner. Fall back
    // to the directory age below rather than leaving the operation blocked.
  }

  try {
    return Date.now() - (await stat(lockDir)).mtimeMs >= UNOWNED_LOCK_STALE_MS;
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    return code === 'ENOENT';
  }
}

async function recoverStaleLock(lockDir: string): Promise<void> {
  const recoveryDir = `${lockDir}.recovery`;
  try {
    await mkdir(recoveryDir);
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'EEXIST') return;
    throw error;
  }

  try {
    if (await staleLock(lockDir)) {
      await rm(lockDir, { recursive: true, force: true });
    }
  } finally {
    await rm(recoveryDir, { recursive: true, force: true });
  }
}

/**
 * Acquires a cross-process directory lock. A lock owned by a dead process is
 * reclaimed, while a lock without readable ownership metadata expires after a
 * short safety window for the mkdir-to-owner-record crash gap.
 */
export async function acquireDirectoryLock(lockDir: string, description: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await mkdir(lockDir);
      try {
        await Bun.write(join(lockDir, OWNER_FILE), JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        } satisfies LockOwner));
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      return async () => {
        await rm(lockDir, { recursive: true, force: true });
      };
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : '';
      if (code !== 'EEXIST') throw error;
      await recoverStaleLock(lockDir);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting to update ${description}`);
      }
      await wait(LOCK_RETRY_MS);
    }
  }
}
