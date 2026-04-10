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

// ── parseRss ───────────────────────────────────────────────────

describe('parseRss', () => {
  test('extracts items and source text', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Dubai market rises</title><pubDate>Sun, 22 Mar 2026 04:00:00 GMT</pubDate><source url="https://example.com">Reuters</source></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      title: 'Dubai market rises',
      pubDate: 'Sun, 22 Mar 2026 04:00:00 GMT',
      source: 'Reuters',
    });
  });

  test('returns empty array for empty channel', () => {
    const xml = `<?xml version="1.0"?><rss><channel></channel></rss>`;
    expect(parseRss(xml)).toEqual([]);
  });

  test('handles single item (not wrapped in array)', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Only one</title></item></channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Only one');
  });

  test('handles malformed XML gracefully', () => {
    expect(() => parseRss('not xml at all')).not.toThrow();
    const items = parseRss('not xml at all');
    expect(items).toEqual([]);
  });

  test('handles XML with no rss root', () => {
    const xml = `<?xml version="1.0"?><feed><entry><title>Atom</title></entry></feed>`;
    expect(parseRss(xml)).toEqual([]);
  });
});

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

// ── scoreItem ──────────────────────────────────────────────────

describe('scoreItem', () => {
  test('preferred source gets +3', () => {
    expect(scoreItem('Generic headline', 'Reuters')).toBe(3);
    expect(scoreItem('Generic headline', 'AP News')).toBe(3);
  });

  test('UAE mention in title gets +2', () => {
    expect(scoreItem('Dubai sees growth', 'Unknown Blog')).toBe(2);
    expect(scoreItem('Abu Dhabi airport news', 'Unknown Blog')).toBe(4);
  });

  test('priority keyword gets +2', () => {
    expect(scoreItem('Rain expected tomorrow', 'Unknown')).toBe(2);
    expect(scoreItem('Missile launch detected', 'Unknown')).toBe(2);
  });

  test('preferred source + UAE + priority stacks', () => {
    expect(scoreItem('Dubai airport closed due to rain', 'Reuters')).toBe(7);
  });

  test('no match returns 0', () => {
    expect(scoreItem('Generic headline about nothing', 'Unknown Blog')).toBe(0);
  });
});

// ── titleSimilarity ────────────────────────────────────────────

describe('titleSimilarity', () => {
  test('identical titles return 1', () => {
    expect(titleSimilarity('Dubai market rises', 'Dubai market rises')).toBe(1);
  });

  test('completely different titles return low similarity', () => {
    const sim = titleSimilarity('Dubai airport closure', 'Iran nuclear talks resume');
    expect(sim).toBeLessThan(0.3);
  });

  test('similar titles about the same event score high', () => {
    const sim = titleSimilarity(
      'UAE says it intercepted 5 Iranian missiles, 17 drones',
      'UAE air defences engage 5 ballistic missiles, 17 UAVs'
    );
    expect(sim).toBeGreaterThan(0.4);
  });

  test('empty titles return 1', () => {
    expect(titleSimilarity('', '')).toBe(1);
  });
});

// ── emojiFor ───────────────────────────────────────────────────

describe('emojiFor', () => {
  test('weather/rain', () => {
    expect(emojiFor('Heavy rain expected')).toBe('🌧️');
    expect(emojiFor('Unstable weather conditions')).toBe('🌧️');
  });

  test('property/market', () => {
    expect(emojiFor('Property prices surge')).toBe('📉');
    expect(emojiFor('Dubai market overview')).toBe('📉');
  });

  test('aviation', () => {
    expect(emojiFor('Airport reopens after delays')).toBe('✈️');
    expect(emojiFor('Airspace closed for safety')).toBe('✈️');
  });

  test('military', () => {
    expect(emojiFor('Missile intercepted')).toBe('🛡️');
    expect(emojiFor('Drone attack reported')).toBe('🛡️');
  });

  test('shipping', () => {
    expect(emojiFor('Hormuz strait tensions')).toBe('⛴️');
  });

  test('terrorism', () => {
    expect(emojiFor('Hezbollah funding traced')).toBe('🚨');
  });

  test('education', () => {
    expect(emojiFor('Schools reopen after break')).toBe('🎓');
  });

  test('oil/energy', () => {
    expect(emojiFor('Oil prices drop sharply')).toBe('🛢️');
  });

  test('default bullet for unmatched', () => {
    expect(emojiFor('Something completely unrelated')).toBe('•');
  });

  test('Russian погода', () => {
    expect(emojiFor('нестабильная погода обрушивается')).toBe('🌧️');
  });
});

// ── translateDeepL ─────────────────────────────────────────────

describe('translateDeepL', () => {
  test('returns translated texts on success', async () => {
    setupDeepLSuccess(['Рынок Дубая растёт', 'Аэропорт Абу-Даби открыт']);
    const result = await translateDeepL(
      ['Dubai market rises', 'Abu Dhabi airport reopens'],
      'fake-key',
      'RU',
    );
    expect(result).toEqual(['Рынок Дубая растёт', 'Аэропорт Абу-Даби открыт']);
  });

  test('returns empty array for empty input', async () => {
    const result = await translateDeepL([], 'fake-key');
    expect(result).toEqual([]);
  });

  test('returns null on rate limit (429)', async () => {
    setupDeepLStatus(429);
    const result = await translateDeepL(['test'], 'fake-key', 'RU');
    expect(result).toBeNull();
  });

  test('returns null on quota exceeded (456)', async () => {
    setupDeepLStatus(456);
    const result = await translateDeepL(['test'], 'fake-key', 'RU');
    expect(result).toBeNull();
  });

  test('returns null on server error (500)', async () => {
    setupDeepLStatus(500);
    const result = await translateDeepL(['test'], 'fake-key', 'RU');
    expect(result).toBeNull();
  });

  test('returns null on network error', async () => {
    setupDeepLNetworkError();
    try {
      const result = await translateDeepL(['test'], 'fake-key', 'RU');
      expect(result).toBeNull();
    } finally {
      restoreDeepLUrl();
    }
  });

  test('returns null if response count mismatches', async () => {
    // Send 2 texts but server returns only 1 translation
    setupDeepLSuccess(['only one']);
    const result = await translateDeepL(['text one', 'text two'], 'fake-key', 'RU');
    expect(result).toBeNull();
  });

  test('passes targetLang to DeepL API', async () => {
    let capturedBody: any;
    deeplHandler = async (req) => {
      capturedBody = await req.json();
      return new Response(
        JSON.stringify({ translations: [{ detected_source_language: 'EN', text: 'Markt in Dubai steigt' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await translateDeepL(['Dubai market rises'], 'fake-key', 'DE');
    expect(capturedBody.target_lang).toBe('DE');
  });
});

// ── renderDigest ───────────────────────────────────────────────

describe('renderDigest', () => {
  const now = new Date('2026-03-22T08:00:00Z');
  const sampleItem: DigestItem = {
    score: 5,
    publishedAt: new Date('2026-03-22T07:00:00Z'),
    title: 'Dubai property sector shows early signs of weakness',
    source: 'Reuters',
    key: makeKey('Dubai property sector shows early signs of weakness', 'Reuters'),
  };

  test('prints digest with hours ago suffix', () => {
    const output = renderDigest([sampleItem], undefined, now);
    expect(output).toContain('🇦🇪 UAE Latest News Digest');
    expect(output).toContain('📉');
    expect(output).toContain('Dubai property sector shows early signs of weakness');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('shows 0h ago for very recent items', () => {
    const recentItem: DigestItem = {
      ...sampleItem,
      publishedAt: new Date('2026-03-22T07:45:00Z'),
    };
    const output = renderDigest([recentItem], undefined, now);
    expect(output).toContain('Reuters, 0h ago');
  });

  test('uses DeepL translations when provided', () => {
    const translations = new Map([
      ['Dubai property sector shows early signs of weakness', 'Сектор недвижимости Дубая'],
    ]);
    const output = renderDigest([sampleItem], translations, now);
    expect(output).toContain('Сектор недвижимости Дубая');
    expect(output).toContain('Reuters, 1h ago');
  });

  test('keeps original title when translations map has no entry', () => {
    const translations = new Map<string, string>();
    const output = renderDigest([sampleItem], translations, now);
    expect(output).toContain('Dubai property sector shows early signs of weakness');
  });

  test('prints empty message for no items', () => {
    const output = renderDigest([]);
    expect(output).toContain('No significant news in the check window.');
  });

  test('uses UAE header for default region', () => {
    const output = renderDigest([sampleItem], undefined, now);
    expect(output).toContain('🇦🇪 UAE');
  });

  test('uses US header for us region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'us');
    expect(output).toContain('🇺🇸 US');
  });

  test('uses Germany header for de region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'de');
    expect(output).toContain('🇩🇪 Germany');
  });

  test('uses generic header for unknown region', () => {
    const output = renderDigest([sampleItem], undefined, now, 'xx');
    expect(output).toContain('📰 News');
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
