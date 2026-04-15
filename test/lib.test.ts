import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import {
  buildDigest,
  buildRssUrl,
  emojiFor,
  makeKey,
  parseRss,
  readSeenKeys,
  renderDigest,
  runDigest,
  scoreItem,
  titleSimilarity,
  translateDeepL,
  writeSeenKeys,
  type DeepLResponse,
  type DigestItem,
  type RssItem,
} from '../src/lib';

// ── DeepL test server ──────────────────────────────────────────

type DeepLHandler = (req: Request) => Response | Promise<Response>;

let deeplHandler: DeepLHandler = () => new Response('Not configured', { status: 500 });
let deeplServer: Server;

beforeAll(() => {
  deeplServer = Bun.serve({
    port: 0,
    fetch(req) {
      return deeplHandler(req);
    },
  });
  process.env.DEEPL_API_URL = `http://localhost:${deeplServer.port}/translate`;
});

afterAll(() => {
  deeplServer.stop(true);
  delete process.env.DEEPL_API_URL;
});

/** Set up deeplHandler to return a successful translation response. */
function setupDeepLSuccess(translations: string[]): void {
  deeplHandler = async () => new Response(
    JSON.stringify({ translations: translations.map((text) => ({ detected_source_language: 'EN', text })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Set up deeplHandler to return a specific HTTP error status. */
function setupDeepLStatus(status: number): void {
  deeplHandler = async () => new Response('Error', { status });
}

/** Set up DEEPL_API_URL to point to a port with no listener, simulating a connection refused. */
function setupDeepLNetworkError(): void {
  // Point to a port that is not listening (1 is always unavailable)
  process.env.DEEPL_API_URL = 'http://localhost:1/translate';
}

/** Restore DEEPL_API_URL back to the test server. */
function restoreDeepLUrl(): void {
  process.env.DEEPL_API_URL = `http://localhost:${deeplServer.port}/translate`;
}

// ── buildDigest ────────────────────────────────────────────────

describe('buildDigest', () => {
  test('filters seen, old, and low-signal items deterministically', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'Dubai property sector shows early signs of weakness', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'Dubai property sector shows early signs of weakness', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'UAE football roundup', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'MSN' },
      { title: 'Abu Dhabi airport reopens airspace', pubDate: 'Fri, 20 Mar 2026 01:00:00 GMT', source: 'The National' },
      { title: 'Dubai flight status updates after rain', pubDate: 'Sun, 22 Mar 2026 06:45:00 GMT', source: 'Khaleej Times' },
    ];

    const digest = buildDigest(items, {
      seenKeys: new Set([makeKey('Dubai flight status updates after rain', 'Khaleej Times')]),
      hours: 36,
      limit: 6,
      now,
    });

    expect(digest).toHaveLength(1);
    expect(digest[0]?.title).toContain('Dubai property sector');
    expect(digest[0]?.source).toBe('Reuters');
  });

  test('fuzzy dedup coalesces similar titles from different sources', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'UAE says it intercepted 5 Iranian missiles, 17 drones', pubDate: 'Sun, 22 Mar 2026 07:00:00 GMT', source: 'Reuters' },
      { title: 'UAE air defences engage 5 ballistic missiles, 17 UAVs on March 24', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'Gulf News' },
    ];

    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });
    expect(digest).toHaveLength(1);
  });

  test('returns empty for all-skipped items', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const items: RssItem[] = [
      { title: 'UAE football roundup', pubDate: 'Sun, 22 Mar 2026 07:30:00 GMT', source: 'MSN' },
    ];
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 6, now });
    expect(digest).toHaveLength(0);
  });

  test('respects limit', () => {
    const now = new Date('2026-03-22T08:00:00Z');
    const topics = ['airport closure', 'property market crash', 'oil price surge', 'visa regulation change', 'metro expansion plan', 'weather sandstorm warning', 'hospital opening ceremony', 'shipping trade agreement', 'drone technology expo', 'education reform policy'];
    const items: RssItem[] = topics.map((topic, i) => ({
      title: `Dubai ${topic}`,
      pubDate: `Sun, 22 Mar 2026 0${Math.min(7, i)}:00:00 GMT`,
      source: 'Reuters',
    }));
    const digest = buildDigest(items, { seenKeys: new Set(), hours: 36, limit: 3, now });
    expect(digest).toHaveLength(3);
  });
});

// ── runDigest (integration) ────────────────────────────────────

describe('runDigest', () => {
  const rssXml = `<?xml version="1.0"?><rss><channel>
    <item><title>Dubai airport reopens after rain</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source url="https://example.com">Reuters</source></item>
    <item><title>Abu Dhabi market overview</title><pubDate>Sun, 22 Mar 2026 06:00:00 GMT</pubDate><source url="https://example.com">Gulf News</source></item>
  </channel></rss>`;

  test('uses DeepL when key and targetLang are provided', async () => {
    setupDeepLSuccess([
      'Аэропорт Дубая возобновил работу после дождя',
      'Обзор рынка Абу-Даби',
    ]);

    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      deeplAuthKey: 'fake-key',
      targetLang: 'RU',
    });

    expect(result.output).toContain('Аэропорт Дубая возобновил работу после дождя');
    expect(result.output).toContain('Обзор рынка Абу-Даби');
    expect(result.output).toContain('1h ago');
    expect(result.output).toContain('2h ago');
    expect(result.digest).toHaveLength(2);
  });

  test('falls back to English when DeepL fails', async () => {
    setupDeepLStatus(500);

    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      deeplAuthKey: 'fake-key',
      targetLang: 'RU',
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('Reuters, 1h ago');
    expect(result.digest).toHaveLength(2);
  });

  test('skips DeepL when no targetLang', async () => {
    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      deeplAuthKey: 'fake-key',
    });

    // Output should be in English (DeepL not called without targetLang)
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('1h ago');
  });

  test('skips DeepL when no auth key', async () => {
    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('Reuters, 1h ago');
  });
});

// ── buildRssUrl ────────────────────────────────────────────────

describe('buildRssUrl', () => {
  test('returns Google News RSS URL for known region', () => {
    const url = buildRssUrl('uae');
    expect(url).toContain('news.google.com/rss/search');
    expect(url).toContain('UAE');
    expect(url).toContain('gl=AE');
  });

  test('supports us region', () => {
    const url = buildRssUrl('us');
    expect(url).toContain('gl=US');
    expect(url).toContain('USA');
  });

  test('supports uk region', () => {
    const url = buildRssUrl('uk');
    expect(url).toContain('gl=GB');
  });

  test('supports de region', () => {
    const url = buildRssUrl('de');
    expect(url).toContain('gl=DE');
    expect(url).toContain('hl=de');
  });

  test('supports ru region', () => {
    const url = buildRssUrl('ru');
    expect(url).toContain('gl=RU');
    expect(url).toContain('hl=ru');
  });

  test('is case-insensitive', () => {
    const url = buildRssUrl('UAE');
    expect(url).toContain('gl=AE');
  });

  test('throws for unknown region with available options', () => {
    expect(() => buildRssUrl('xx')).toThrow('Unknown region "xx"');
    expect(() => buildRssUrl('xx')).toThrow('uae');
  });
});

// ── readSeenKeys / writeSeenKeys ───────────────────────────────

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
});
