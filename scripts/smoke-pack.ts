import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'bun';

type PackResult = {
  filename: string;
  files?: Array<{ path: string }>;
};

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>Dubai airport reopens after rain</title><pubDate>Sun, 22 Mar 2026 07:00:00 GMT</pubDate><source url="https://example.com">Reuters</source></item>
</channel></rss>`;

async function run(command: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
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

function assertPackedFiles(packResults: PackResult[]): void {
  const files = packResults[0]?.files?.map((file) => file.path).sort();
  if (!files || files.length === 0) {
    throw new Error(`npm pack did not report packaged files: ${JSON.stringify(packResults)}`);
  }

  const disallowed = files.filter((path) => (
    !path.startsWith('src/')
    && path !== 'README.md'
    && path !== 'LICENSE'
    && path !== 'package.json'
  ));
  if (disallowed.length > 0) {
    throw new Error(`Packed artifact contains unexpected files: ${disallowed.join(', ')}`);
  }
}

function startRssServer(): Server<undefined> {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/rss') {
        return new Response(RSS_XML, { headers: { 'content-type': 'application/xml' } });
      }
      return new Response('Not Found', { status: 404 });
    },
  });
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

    const dryRunOutput = await run(['npm', 'pack', '--dry-run', '--json'], rootDir);
    assertPackedFiles(JSON.parse(dryRunOutput) as PackResult[]);

    const packOutput = await run(['npm', 'pack', '--json', '--pack-destination', packDir], rootDir);
    const packResults = JSON.parse(packOutput) as PackResult[];
    assertPackedFiles(packResults);
    const tarball = join(packDir, packResults[0]!.filename);

    await Bun.write(join(consumerDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
    await run(['bun', 'add', tarball], consumerDir);

    const bin = join(consumerDir, 'node_modules', '.bin', 'uae-news-digest');
    const manifest = JSON.parse(await run(['bun', bin, 'manifest'], consumerDir));
    if (manifest.id !== 'uae-news-digest' || manifest.bin !== 'uae-news-digest') {
      throw new Error(`Unexpected manifest from packed binary: ${JSON.stringify(manifest)}`);
    }

    const printed = JSON.parse(await run(['bun', bin, 'config', 'print-default'], consumerDir));
    if (!Array.isArray(printed.topics) || printed.topics.length === 0) {
      throw new Error(`Unexpected config print-default from packed binary: ${JSON.stringify(printed).slice(0, 200)}`);
    }

    const rssServer = startRssServer();
    try {
      const rssUrl = `http://localhost:${rssServer.port}/rss`;
      const healthcheck = JSON.parse(await run(['bun', bin, 'healthcheck', '--rss-url', rssUrl], consumerDir));
      if (healthcheck.ok !== true || healthcheck.version !== manifest.version) {
        throw new Error(`Unexpected healthcheck from packed binary: ${JSON.stringify(healthcheck)}`);
      }

      const stateFile = join(workDir, 'seen_titles.txt');
      const configPath = join(workDir, 'digest.config.json');
      await Bun.write(configPath, JSON.stringify({
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [{ slug: 'uae', name: 'UAE', query: 'UAE', feedUrl: rssUrl, limit: 6 }],
      }));
      const validated = await run(['bun', bin, 'config', 'validate', configPath], consumerDir);
      if (!validated.startsWith('ok')) {
        throw new Error(`Unexpected config validate from packed binary: ${validated}`);
      }
      const digest = JSON.parse(await run([
        'bun', bin, '--json', '--config', configPath, '--state-file', stateFile, '--dry-run',
      ], consumerDir, {
        UAE_NEWS_DIGEST_NOW: '2026-03-22T08:00:00Z',
        // Neutralize XDG/HOME so a user's real topics config can't bleed in.
        HOME: workDir,
        XDG_CONFIG_HOME: workDir,
      }));
      if (digest.tool !== 'uae-news-digest' || digest.count !== 1 || digest.items[0]?.title !== 'Dubai airport reopens after rain') {
        throw new Error(`Unexpected digest from packed binary: ${JSON.stringify(digest)}`);
      }
    } finally {
      rssServer.stop(true);
    }

    const coreSmoke = join(consumerDir, 'core-smoke.ts');
    await Bun.write(coreSmoke, `
import { buildFeedUrl, runDigest, renderText, DEFAULT_CONFIG } from '@drakulavich/uae-news-digest/core';

if (!buildFeedUrl(DEFAULT_CONFIG.topics[0]).startsWith('https://news.google.com/rss/search')) {
  throw new Error('buildFeedUrl did not return a Google News RSS URL');
}

const xml = ${JSON.stringify(RSS_XML)};
const now = new Date('2026-03-22T08:00:00Z');

const result = await runDigest({
  config: DEFAULT_CONFIG,
  seenKeys: new Set(),
  hours: 36,
  limitOverride: 1,
  now,
  fetchText: async () => xml,
});

const text = renderText(result, DEFAULT_CONFIG, now);
if (result.sections[0].items.length !== 1 || !text.includes('Dubai airport reopens after rain')) {
  throw new Error('runDigest packed core smoke failed');
}
`);
    await run(['bun', coreSmoke], consumerDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

await main();
