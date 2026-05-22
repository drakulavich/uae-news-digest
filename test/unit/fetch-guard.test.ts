import { describe, expect, test } from 'bun:test';

describe('test fetch guard', () => {
  test('blocks accidental public network fetches', async () => {
    await expect(fetch('https://example.com/should-not-be-called')).rejects.toThrow(
      'Unexpected network access in tests',
    );
  });
});
