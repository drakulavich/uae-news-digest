import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { Server } from 'bun';
import { translateDeepL } from '../../src/translate';

type DeepLHandler = (req: Request) => Response | Promise<Response>;

let deeplHandler: DeepLHandler = () => new Response('Not configured', { status: 500 });
let deeplServer: Server<undefined>;

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
  deeplHandler = () => new Response('Not configured', { status: 500 });
  restoreDeepLUrl();
});

function setupDeepLSuccess(translations: string[]): void {
  deeplHandler = async () => new Response(
    JSON.stringify({ translations: translations.map((text) => ({ detected_source_language: 'EN', text })) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function setupDeepLStatus(status: number): void {
  deeplHandler = async () => new Response('Error', { status });
}

function setupDeepLNetworkError(): void {
  process.env.DEEPL_API_URL = 'http://localhost:1/translate';
}

function restoreDeepLUrl(): void {
  process.env.DEEPL_API_URL = `http://localhost:${deeplServer.port}/translate`;
}

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

  test('throws on rate limit (429)', async () => {
    setupDeepLStatus(429);
    await expect(translateDeepL(['test'], 'fake-key', 'RU')).rejects.toThrow(/HTTP 429.*rate limited/);
  });

  test('throws on quota exceeded (456)', async () => {
    setupDeepLStatus(456);
    await expect(translateDeepL(['test'], 'fake-key', 'RU')).rejects.toThrow(/HTTP 456.*quota/);
  });

  test('throws on server error (500)', async () => {
    setupDeepLStatus(500);
    await expect(translateDeepL(['test'], 'fake-key', 'RU')).rejects.toThrow(/HTTP 500/);
  });

  test('throws on network error', async () => {
    setupDeepLNetworkError();
    await expect(translateDeepL(['test'], 'fake-key', 'RU')).rejects.toThrow(/DeepL request failed/);
  });

  test('throws if response count mismatches', async () => {
    // Send 2 texts but server returns only 1 translation
    setupDeepLSuccess(['only one']);
    await expect(translateDeepL(['text one', 'text two'], 'fake-key', 'RU')).rejects.toThrow(/1 translations for 2 texts/);
  });

  test('a non-JSON 200 body is reported as such', async () => {
    deeplHandler = async () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(translateDeepL(['x'], 'key', 'DE')).rejects.toThrow('DeepL returned a non-JSON response');
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
