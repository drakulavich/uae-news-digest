import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTopicsConfig, resolveTopicsConfigPath } from '../../src/topics';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'topics-test-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
}

describe('loadTopicsConfig', () => {
  test('loads a valid config with inherited locale', async () => {
    const path = writeConfig('ok.json', {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [
        { slug: 'economy', name: 'Экономика', query: 'UAE economy' },
        { slug: 'iran', name: 'Иран', emoji: '⚠️', query: 'Iran UAE', limit: 3 },
      ],
    });

    const cfg = await loadTopicsConfig(path);

    expect(cfg.locale).toEqual({ hl: 'en', gl: 'AE', ceid: 'AE:en' });
    expect(cfg.topics).toHaveLength(2);
    expect(cfg.topics[0]).toMatchObject({ slug: 'economy', name: 'Экономика', limit: 5 });
    expect(cfg.topics[1]).toMatchObject({ slug: 'iran', emoji: '⚠️', limit: 3 });
  });

  test('defaults locale to UAE when omitted', async () => {
    const path = writeConfig('no-locale.json', {
      topics: [{ slug: 'a', name: 'A', query: 'x' }],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.locale).toEqual({ hl: 'en', gl: 'AE', ceid: 'AE:en' });
  });

  test('per-topic locale overrides top-level', async () => {
    const path = writeConfig('per-topic-locale.json', {
      locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
      topics: [
        { slug: 'de', name: 'DE', query: 'x', locale: { hl: 'de', gl: 'DE', ceid: 'DE:de' } },
      ],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]?.locale).toEqual({ hl: 'de', gl: 'DE', ceid: 'DE:de' });
  });

  test('rejects malformed JSON with file path in message', async () => {
    const path = writeConfig('broken.json', '{ not json');
    await expect(loadTopicsConfig(path)).rejects.toThrow(/broken\.json/);
  });

  test('rejects empty topics array', async () => {
    const path = writeConfig('empty.json', { topics: [] });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/at least one topic/i);
  });

  test('rejects topic missing slug', async () => {
    const path = writeConfig('no-slug.json', {
      topics: [{ name: 'X', query: 'q' }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/slug/);
  });

  test('rejects topic missing query', async () => {
    const path = writeConfig('no-query.json', {
      topics: [{ slug: 'a', name: 'A' }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/query/);
  });

  test('rejects duplicate slugs', async () => {
    const path = writeConfig('dup.json', {
      topics: [
        { slug: 'x', name: 'X', query: 'a' },
        { slug: 'x', name: 'Y', query: 'b' },
      ],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/duplicate.*slug.*x/i);
  });

  test('rejects non-positive limit', async () => {
    const path = writeConfig('bad-limit.json', {
      topics: [{ slug: 'a', name: 'A', query: 'q', limit: 0 }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/limit/);
  });

  test('rejects nonexistent file with helpful message', async () => {
    await expect(loadTopicsConfig('/nope/missing.json')).rejects.toThrow(/missing\.json/);
  });

  test('trims whitespace from string fields', async () => {
    const path = writeConfig('whitespace.json', {
      topics: [{ slug: '  economy ', name: ' Экономика  ', query: '  UAE economy  ', emoji: ' 💰 ' }],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]).toMatchObject({
      slug: 'economy',
      name: 'Экономика',
      query: 'UAE economy',
      emoji: '💰',
    });
  });

  test('parses optional match and matchMode on a topic', async () => {
    const path = writeConfig('match-mode.json', {
      topics: [{ slug: 'schools', name: 'Schools', query: 'school fees', match: ['school', 'fees'], matchMode: 'any' }],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]!.match).toEqual(['school', 'fees']);
    expect(cfg.topics[0]!.matchMode).toBe('any');
  });

  test('defaults matchMode to "all" when match present but mode omitted', async () => {
    const path = writeConfig('match-default-mode.json', {
      topics: [{ slug: 'schools', name: 'Schools', query: 'school fees', match: ['school', 'fees'] }],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]!.matchMode).toBe('all');
  });

  test('rejects a non-string entry in match', async () => {
    const path = writeConfig('match-invalid.json', {
      topics: [{ slug: 'x', name: 'X', query: 'q', match: ['ok', 5] }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/match/);
  });

  test('accepts a positive-integer matchMode', async () => {
    const path = writeConfig('match-mode-int.json', {
      topics: [{ slug: 'x', name: 'X', query: 'q', match: ['a', 'b', 'c'], matchMode: 2 }],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]!.matchMode).toBe(2);
  });

  test('rejects an invalid matchMode', async () => {
    const path = writeConfig('match-mode-invalid.json', {
      topics: [{ slug: 'x', name: 'X', query: 'q', match: ['a'], matchMode: 'sometimes' }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/matchMode/);
  });

  test('rejects a non-array match', async () => {
    const path = writeConfig('match-non-array.json', {
      topics: [{ slug: 'x', name: 'X', query: 'q', match: 'school' }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/match/);
  });

  test('rejects matchMode without a match array', async () => {
    const path = writeConfig('match-mode-orphan.json', {
      topics: [{ slug: 'x', name: 'X', query: 'q', matchMode: 'any' }],
    });
    await expect(loadTopicsConfig(path)).rejects.toThrow(/matchMode requires/);
  });
});

describe('resolveTopicsConfigPath', () => {
  test('returns explicit path when provided and file exists', async () => {
    const path = writeConfig('explicit.json', { topics: [{ slug: 'a', name: 'A', query: 'q' }] });
    const result = await resolveTopicsConfigPath({ explicit: path, cwd: dir, env: {} });
    expect(result).toBe(path);
  });

  test('throws when explicit path is missing', async () => {
    await expect(resolveTopicsConfigPath({ explicit: '/nope.json', cwd: dir, env: {} }))
      .rejects.toThrow(/nope\.json/);
  });

  test('finds digest.config.json in cwd', async () => {
    const path = writeConfig('digest.config.json', { topics: [{ slug: 'a', name: 'A', query: 'q' }] });
    const result = await resolveTopicsConfigPath({ cwd: dir, env: {} });
    expect(result).toBe(path);
  });

  test('falls back to XDG_CONFIG_HOME location', async () => {
    const xdg = mkdtempSync(join(tmpdir(), 'xdg-'));
    try {
      const subdir = join(xdg, 'uae-news-digest');
      mkdirSync(subdir, { recursive: true });
      const path = join(subdir, 'topics.json');
      writeFileSync(path, JSON.stringify({ topics: [{ slug: 'a', name: 'A', query: 'q' }] }));
      const cwdNoConfig = mkdtempSync(join(tmpdir(), 'cwd-empty-'));
      try {
        const result = await resolveTopicsConfigPath({
          cwd: cwdNoConfig,
          env: { XDG_CONFIG_HOME: xdg },
        });
        expect(result).toBe(path);
      } finally {
        rmSync(cwdNoConfig, { recursive: true, force: true });
      }
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  test('falls back to $HOME/.config when XDG_CONFIG_HOME is unset', async () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    try {
      const subdir = join(home, '.config', 'uae-news-digest');
      mkdirSync(subdir, { recursive: true });
      const path = join(subdir, 'topics.json');
      writeFileSync(path, JSON.stringify({ topics: [{ slug: 'a', name: 'A', query: 'q' }] }));
      const cwdNoConfig = mkdtempSync(join(tmpdir(), 'cwd-empty-'));
      try {
        const result = await resolveTopicsConfigPath({
          cwd: cwdNoConfig,
          env: { HOME: home },
        });
        expect(result).toBe(path);
      } finally {
        rmSync(cwdNoConfig, { recursive: true, force: true });
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('returns null when no config found', async () => {
    const emptyCwd = mkdtempSync(join(tmpdir(), 'cwd-none-'));
    try {
      const result = await resolveTopicsConfigPath({
        cwd: emptyCwd,
        env: { HOME: emptyCwd },
      });
      expect(result).toBeNull();
    } finally {
      rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  test('throws when explicit is provided as empty string', async () => {
    await expect(resolveTopicsConfigPath({ explicit: '', cwd: dir, env: {} }))
      .rejects.toThrow(/Topics config not found/);
  });

  test('throws when cwd is empty and no explicit path is given', async () => {
    await expect(resolveTopicsConfigPath({ cwd: '', env: {} }))
      .rejects.toThrow(/cwd is required/);
  });
});
