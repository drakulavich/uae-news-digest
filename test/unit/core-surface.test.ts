import { expect, test } from 'bun:test';

const PUBLIC_VALUES = [
  'DEEPL_API_URL',
  'DEFAULT_CONFIG',
  'DEFAULT_STATE_FILE',
  'loadConfig',
  'parseConfig',
  'parseRss',
  'readSeenKeys',
  'renderText',
  'resolveConfigPath',
  'runDigest',
  'toJson',
  'translateDeepL',
  'writeSeenKeys',
];

test('@drakulavich/uae-news-digest/core exports exactly the documented values', async () => {
  const core = await import('../../src/core');
  expect(Object.keys(core).sort()).toEqual(PUBLIC_VALUES);
});

test('src/lib.ts is gone and nothing imports it', async () => {
  expect(await Bun.file(new URL('../../src/lib.ts', import.meta.url)).exists()).toBe(false);
});
