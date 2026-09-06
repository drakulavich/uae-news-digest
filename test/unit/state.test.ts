import { describe, expect, test, afterAll } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { readSeenKeys, writeSeenKeys } from '../../src/state';

describe('readSeenKeys / writeSeenKeys', () => {
  const testFile = join(tmpdir(), `uae-news-test-${Date.now()}.txt`);

  afterAll(async () => {
    try { await Bun.$`rm -f ${testFile}`.quiet(); } catch {}
  });

  test('returns empty set for non-existent file', async () => {
    const keys = await readSeenKeys('/tmp/does-not-exist-uae-test.txt');
    expect(keys.size).toBe(0);
  });

  test('round-trip: write then read preserves keys', async () => {
    const keys = new Set(['key one || source a', 'key two || source b', 'key three || source c']);
    await writeSeenKeys(testFile, keys);
    const loaded = await readSeenKeys(testFile);
    expect(loaded).toEqual(keys);
  });

  test('written file is sorted', async () => {
    const keys = new Set(['zebra || z', 'alpha || a', 'middle || m']);
    await writeSeenKeys(testFile, keys);
    const raw = await Bun.file(testFile).text();
    const lines = raw.trim().split('\n');
    expect(lines).toEqual(['alpha || a', 'middle || m', 'zebra || z']);
  });

  test('successful writes do not leave temporary state files', async () => {
    const keys = new Set(['atomic || source']);
    await writeSeenKeys(testFile, keys);

    const files = await readdir(dirname(testFile));
    const tempPrefix = `.${basename(testFile)}.`;
    expect(files.filter((file) => file.startsWith(tempPrefix) && file.endsWith('.tmp'))).toEqual([]);
  });

  test('an unwritable state directory is reported against the state file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'state-ro-'));
    chmodSync(dir, 0o500);
    const file = join(dir, 'seen.txt');
    try {
      await expect(writeSeenKeys(file, new Set(['k']))).rejects.toThrow(`Cannot write state file ${file}`);
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writeSeenKeys creates missing parent directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'state-nested-'));
    const file = join(dir, 'a', 'b', 'seen.txt');
    await writeSeenKeys(file, new Set(['k1', 'k2']));
    expect(await readSeenKeys(file)).toEqual(new Set(['k1', 'k2']));
    rmSync(dir, { recursive: true, force: true });
  });
});
