import { describe, expect, test } from 'bun:test';
import { CliError, classifyFetchError } from '../../src/cli/errors';

describe('CliError', () => {
  test('carries its kind and message', () => {
    const err = new CliError('usage', 'Invalid --hours: abc');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CliError');
    expect(err.kind).toBe('usage');
    expect(err.message).toBe('Invalid --hours: abc');
  });
});

describe('classifyFetchError', () => {
  const ctx = { url: 'http://localhost:1/rss', timeoutMs: 15000 };

  test('TimeoutError and AbortError become a timeout with the retry hint', () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const err = classifyFetchError(Object.assign(new Error('The operation timed out'), { name }), ctx);
      expect(err.kind).toBe('timeout');
      expect(err.message).toBe('RSS request timed out after 15000ms — retry, or pass --timeout-ms 30000');
    }
  });

  test('connection failures become a network error naming the host and the code', () => {
    const err = classifyFetchError(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }), ctx);
    expect(err.kind).toBe('network');
    expect(err.message).toBe('Unable to connect to localhost:1 — check your connection (ECONNREFUSED)');
  });

  test('falls back to the message, then to String(err), when there is no code', () => {
    expect(classifyFetchError(new Error('boom'), ctx).message).toContain('(boom)');
    expect(classifyFetchError('weird', ctx).message).toContain('(weird)');
  });

  test('an unparseable URL is echoed as-is instead of throwing', () => {
    const err = classifyFetchError(new Error('x'), { url: 'not a url', timeoutMs: 1 });
    expect(err.message).toBe('Unable to connect to not a url — check your connection (x)');
  });
});
