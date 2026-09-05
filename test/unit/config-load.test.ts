import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveConfigPath } from '../../src/config/load';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'config-load-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const valid = {
  locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
  topics: [{ slug: 'a', name: 'A', query: 'q' }],
};

function write(name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
}

describe('loadConfig', () => {
  test('loads a valid file', async () => {
    const cfg = await loadConfig(write('ok.json', valid));
    expect(cfg.topics[0]).toMatchObject({ slug: 'a', limit: 5 });
  });

  test('rejects malformed JSON with the file path in the message', async () => {
    await expect(loadConfig(write('broken.json', '{ not json'))).rejects.toThrow(/Failed to parse config at .*broken\.json/);
  });

  test('rejects a schema violation with the file path in the message', async () => {
    await expect(loadConfig(write('bad.json', { topics: [] }))).rejects.toThrow(/Invalid config at .*bad\.json/);
  });

  test('rejects a missing file with a helpful message', async () => {
    await expect(loadConfig('/nope/missing.json')).rejects.toThrow(/Config not found: \/nope\/missing\.json/);
  });
});

describe('resolveConfigPath', () => {
  test('returns the explicit path when it exists', async () => {
    const path = write('explicit.json', valid);
    expect(await resolveConfigPath({ explicit: path, cwd: dir, env: {} })).toBe(path);
  });

  test('throws when the explicit path is missing or empty', async () => {
    await expect(resolveConfigPath({ explicit: '/nope.json', cwd: dir, env: {} })).rejects.toThrow(/Config not found: \/nope\.json/);
    await expect(resolveConfigPath({ explicit: '', cwd: dir, env: {} })).rejects.toThrow(/Config not found/);
  });

  test('finds digest.config.json in cwd', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-'));
    try {
      const path = join(cwd, 'digest.config.json');
      writeFileSync(path, JSON.stringify(valid));
      expect(await resolveConfigPath({ cwd, env: {} })).toBe(path);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('falls back to $XDG_CONFIG_HOME/uae-news-digest/topics.json', async () => {
    const xdg = mkdtempSync(join(tmpdir(), 'xdg-'));
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-empty-'));
    try {
      mkdirSync(join(xdg, 'uae-news-digest'), { recursive: true });
      const path = join(xdg, 'uae-news-digest', 'topics.json');
      writeFileSync(path, JSON.stringify(valid));
      expect(await resolveConfigPath({ cwd, env: { XDG_CONFIG_HOME: xdg } })).toBe(path);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('falls back to $HOME/.config when XDG_CONFIG_HOME is unset', async () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-empty-'));
    try {
      mkdirSync(join(home, '.config', 'uae-news-digest'), { recursive: true });
      const path = join(home, '.config', 'uae-news-digest', 'topics.json');
      writeFileSync(path, JSON.stringify(valid));
      expect(await resolveConfigPath({ cwd, env: { HOME: home } })).toBe(path);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('returns null when nothing is found', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cwd-none-'));
    try {
      expect(await resolveConfigPath({ cwd, env: { HOME: cwd } })).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('throws when cwd is empty', async () => {
    await expect(resolveConfigPath({ cwd: '', env: {} })).rejects.toThrow(/cwd is required/);
  });
});
