import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTopicsConfig } from '../../src/topics';

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
        { slug: 'ru', name: 'RU', query: 'x', locale: { hl: 'ru', gl: 'RU', ceid: 'RU:ru' } },
      ],
    });
    const cfg = await loadTopicsConfig(path);
    expect(cfg.topics[0]?.locale).toEqual({ hl: 'ru', gl: 'RU', ceid: 'RU:ru' });
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
});
