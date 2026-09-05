import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { BIN_NAME, DESCRIPTION, TOOL_ID, VERSION } from '../../src/meta';

test('meta mirrors package.json without reading it at runtime', async () => {
  const pkg = await Bun.file(join(import.meta.dir, '..', '..', 'package.json')).json();
  expect(TOOL_ID).toBe('uae-news-digest');
  expect(VERSION).toBe(pkg.version);
  expect(BIN_NAME).toBe(Object.keys(pkg.bin)[0]);
  expect(DESCRIPTION).toBe(pkg.description);
});
