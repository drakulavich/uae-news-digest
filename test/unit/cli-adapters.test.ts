import { afterAll, describe, expect, test } from 'bun:test';
import { makeFetchText, makeTranslate, USER_AGENT } from '../../src/cli/adapters';
import { CliError } from '../../src/cli/errors';

let seenUserAgent: string | null = null;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const path = new URL(req.url).pathname;
    seenUserAgent = req.headers.get('user-agent');
    if (path === '/ok') return new Response('<rss/>');
    if (path === '/error') return new Response('nope', { status: 503, statusText: 'Service Unavailable' });
    // "Hang" long enough for the 50 ms timeout test, but resolve eventually so server.stop() never waits on a dangling request (flaky on macOS CI otherwise).
    return Bun.sleep(1_000).then(() => new Response('late'));
  },
});
afterAll(async () => { await server.stop(true); });
const base = `http://localhost:${server.port}`;

async function rejection(p: Promise<unknown>): Promise<CliError> {
  try { await p; } catch (err) { return err as CliError; }
  throw new Error('expected a rejection');
}

describe('makeFetchText', () => {
  test('returns the body and sends the tool user-agent', async () => {
    expect(await makeFetchText(5_000)(`${base}/ok`)).toBe('<rss/>');
    expect(seenUserAgent).toBe(USER_AGENT);
  });

  test('non-2xx is a network CliError with the status line', async () => {
    const err = await rejection(makeFetchText(5_000)(`${base}/error`));
    expect(err).toBeInstanceOf(CliError);
    expect(err.kind).toBe('network');
    expect(err.message).toBe('RSS fetch failed: HTTP 503 Service Unavailable');
  });

  test('a hung server is a timeout CliError after timeoutMs', async () => {
    const err = await rejection(makeFetchText(50)(`${base}/hang`));
    expect(err.kind).toBe('timeout');
    expect(err.message).toBe('RSS request timed out after 50ms — retry, or pass --timeout-ms 30000');
  });

  test('a closed port is a network CliError', async () => {
    const err = await rejection(makeFetchText(5_000)('http://localhost:1/rss'));
    expect(err.kind).toBe('network');
    expect(err.message).toStartWith('Unable to connect to localhost:1');
  });
});

describe('makeTranslate', () => {
  test('is undefined without an auth key and a function with one', () => {
    expect(makeTranslate(undefined)).toBeUndefined();
    expect(makeTranslate('')).toBeUndefined();
    expect(typeof makeTranslate('key')).toBe('function');
  });
});
