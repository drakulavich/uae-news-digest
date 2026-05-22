import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type PackResult = {
  filename: string;
};

const rootDir = fileURLToPath(new URL('..', import.meta.url));

async function run(command: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error([
      `Command failed: ${command.join(' ')}`,
      `cwd: ${cwd}`,
      `exitCode: ${exitCode}`,
      `stdout:\n${stdout}`,
      `stderr:\n${stderr}`,
    ].join('\n'));
  }

  return stdout;
}

async function main(): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'uae-news-pack-smoke-'));

  try {
    await run(['npm', '--version'], rootDir).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Package smoke requires npm in PATH so it can run npm pack.\n${message}`);
    });

    const packDir = join(workDir, 'pack');
    const consumerDir = join(workDir, 'consumer');
    await Bun.$`mkdir -p ${packDir} ${consumerDir}`.quiet();

    const packOutput = await run(['npm', 'pack', '--json', '--pack-destination', packDir], rootDir);
    const packResults = JSON.parse(packOutput) as PackResult[];
    const tarball = join(packDir, packResults[0]!.filename);

    await writeFile(join(consumerDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
    await run(['bun', 'add', tarball], consumerDir);

    const bin = join(consumerDir, 'node_modules', '.bin', 'uae-news-digest');
    const manifest = JSON.parse(await run(['bun', bin, 'manifest'], consumerDir));
    if (manifest.id !== 'uae-news-digest' || manifest.bin !== 'uae-news-digest') {
      throw new Error(`Unexpected manifest from packed binary: ${JSON.stringify(manifest)}`);
    }

    const coreSmoke = join(consumerDir, 'core-smoke.ts');
    await writeFile(coreSmoke, `
import { buildRssUrl, runDigest } from '@drakulavich/uae-news-digest/core';

if (!buildRssUrl('uae').startsWith('https://news.google.com/rss/search')) {
  throw new Error('buildRssUrl did not return a Google News RSS URL');
}

const xml = \`<?xml version="1.0"?><rss><channel>
  <item><title>Dubai airport reopens after rain</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source url="https://example.com">Reuters</source></item>
</channel></rss>\`;

const result = await runDigest({
  xml,
  seenKeys: new Set(),
  hours: 36,
  limit: 1,
  now: new Date('2026-03-22T08:00:00Z'),
});

if (result.digest.length !== 1 || !result.output.includes('Dubai airport reopens after rain')) {
  throw new Error('runDigest packed core smoke failed');
}
`);
    await run(['bun', coreSmoke], consumerDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

await main();
