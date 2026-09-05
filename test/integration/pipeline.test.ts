import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'bun';
import { runDigest } from '../../src/pipeline';
import { DEFAULT_CONFIG } from '../../src/config/load';

type DeepLHandler = (req: Request) => Response | Promise<Response>;
type CapturedDeepLRequest = {
  method: string;
  body: unknown;
};

let deeplHandler: DeepLHandler = () => new Response('Not configured', { status: 500 });
let deeplServer: Server<undefined>;
let deeplRequests: CapturedDeepLRequest[] = [];

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

beforeEach(() => {
  deeplRequests = [];
  deeplHandler = () => new Response('Not configured', { status: 500 });
});

function setupDeepLSuccess(translations: string[]): void {
  deeplHandler = async (req) => {
    deeplRequests.push({
      method: req.method,
      body: await req.json(),
    });
    return new Response(
      JSON.stringify({ translations: translations.map((text) => ({ detected_source_language: 'EN', text })) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

function setupDeepLStatus(status: number): void {
  deeplHandler = async () => new Response('Error', { status });
}

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
      heuristics: DEFAULT_CONFIG,
    });

    expect(result.output).toContain('Аэропорт Дубая возобновил работу после дождя');
    expect(result.output).toContain('Обзор рынка Абу-Даби');
    expect(result.output).toContain('1h ago');
    expect(result.output).toContain('2h ago');
    expect(result.digest).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    expect(deeplRequests).toEqual([
      {
        method: 'POST',
        body: {
          text: [
            'Dubai airport reopens after rain',
            'Abu Dhabi market overview',
          ],
          target_lang: 'RU',
        },
      },
    ]);
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
      heuristics: DEFAULT_CONFIG,
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('Reuters, 1h ago');
    expect(result.digest).toHaveLength(2);
    expect(result.warnings).toEqual(['DeepL translation to RU failed; using original titles.']);
  });

  test('skips DeepL when no targetLang', async () => {
    const result = await runDigest({
      xml: rssXml,
      seenKeys: new Set(),
      hours: 36,
      limit: 6,
      now: new Date('2026-03-22T08:00:00Z'),
      deeplAuthKey: 'fake-key',
      heuristics: DEFAULT_CONFIG,
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
      heuristics: DEFAULT_CONFIG,
    });

    expect(result.output).toContain('🇦🇪 UAE Latest News Digest');
    expect(result.output).toContain('Dubai airport reopens after rain');
    expect(result.output).toContain('Reuters, 1h ago');
  });
});

describe('runDigest end-to-end fixture', () => {
  const sampleXml = readFileSync(
    join(import.meta.dir, '..', 'fixtures', 'sample-feed.xml'),
    'utf-8',
  );

  test('renders digest end-to-end from fixture feed', async () => {
    const result = await runDigest({
      xml: sampleXml,
      seenKeys: new Set(),
      hours: 48,
      limit: 5,
      now: new Date('2026-04-15T12:00:00Z'),
      region: 'uae',
      heuristics: DEFAULT_CONFIG,
    });

    // Contract: the output is a non-empty rendered digest
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toContain('UAE');

    // Contract: at least one item survives scoring + dedup
    expect(result.digest.length).toBeGreaterThan(0);

    // Contract: near-duplicate items (sample-feed.xml items 1 and 4) are deduped
    // to one entry — the fixture has 5 raw items, we expect ≤ 4 after dedup.
    expect(result.digest.length).toBeLessThanOrEqual(4);

    // Contract: seen-keys are advanced by exactly the digest items
    expect(result.nextSeenKeys.size).toBe(result.digest.length);

    // Contract: at least one item is from a tier-1 source (Reuters or BBC are in the fixture)
    const sources = result.digest.map((d) => d.source);
    expect(sources.some((s) => s === 'Reuters' || s === 'BBC')).toBe(true);
  });
});
