import { describe, expect, test } from 'bun:test';

describe('test fetch guard', () => {
  test('blocks accidental public network fetches', async () => {
    await expect(fetch('https://example.com/should-not-be-called')).rejects.toThrow(
      'Unexpected network access in tests',
    );
  });

  test('blocks relative URL fetches with guard diagnostics', async () => {
    await expect(fetch('/api/test')).rejects.toThrow('Unexpected network access in tests: /api/test');
  });
});
