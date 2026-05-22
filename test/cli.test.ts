import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';

// ── Canned responses ──────────────────────────────────────────

const TEST_NOW = new Date('2026-03-22T08:00:00Z');
const oneHourAgo = new Date(TEST_NOW.getTime() - 3_600_000).toUTCString();
const twoHoursAgo = new Date(TEST_NOW.getTime() - 7_200_000).toUTCString();

const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>Dubai airport reopens after rain</title><pubDate>${oneHourAgo}</pubDate><source url="https://example.com">Reuters</source></item>
  <item><title>Abu Dhabi market overview</title><pubDate>${twoHoursAgo}</pubDate><source url="https://example.com">Gulf News</source></item>
</channel></rss>`;

const RSS_EMPTY = `<?xml version="1.0"?><rss><channel></channel></rss>`;

const DEEPL_RESPONSE = JSON.stringify({
  translations: [
    { detected_source_language: 'EN', text: 'Flughafen Dubai öffnet nach Regen wieder' },
    { detected_source_language: 'EN', text: 'Marktübersicht Abu Dhabi' },
  ],
});

// ── Test server ───────────────────────────────────────────────

let server: Server<undefined>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/rss') {
        return new Response(RSS_XML, { headers: { 'content-type': 'application/xml' } });
      }

      if (url.pathname === '/rss/empty') {
        return new Response(RSS_EMPTY, { headers: { 'content-type': 'application/xml' } });
      }

      if (url.pathname === '/rss/error') {
        return new Response('Internal Server Error', { status: 500 });
      }

      if (url.pathname === '/translate' && req.method === 'POST') {
        return new Response(DEEPL_RESPONSE, { headers: { 'content-type': 'application/json' } });
      }

      if (url.pathname === '/translate/error' && req.method === 'POST') {
        return new Response('DeepL unavailable', { status: 500 });
      }

      if (url.pathname === '/rss/hang') {
        return new Promise<Response>(() => {
          // Intentionally never resolves — the CLI's timeout must fire.
        });
      }

      return new Response('Not Found', { status: 404 });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

// ── Helpers ───────────────────────────────────────────────────

const CLI = join(import.meta.dir, '..', 'src', 'index.ts');
const PACKAGE_JSON = join(import.meta.dir, '..', 'package.json');

type CliRunResult = {
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number | 'unknown';
};

const CLI_TIMEOUT_CLEANUP_MS = 1_000;

function formatRunResult(result: CliRunResult): string {
  return [
    `command: ${result.command.join(' ')}`,
    `exitCode: ${result.exitCode}`,
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
  ].join('\n');
}

async function run(
  args: string[],
  env?: Record<string, string>,
  options: { timeoutMs?: number } = {},
): Promise<CliRunResult> {
  const command = ['bun', CLI, ...args];
  const timeoutMs = options.timeoutMs ?? 5_000;
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, UAE_NEWS_DIGEST_NOW: TEST_NOW.toISOString(), ...env },
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  let timeout: Timer | undefined;

  const timedOut = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const exitOrTimeout = await Promise.race([proc.exited, timedOut]);
  if (timeout) clearTimeout(timeout);

  if (exitOrTimeout === 'timeout') {
    proc.kill();
    const result = await Promise.race<CliRunResult>([
      Promise.all([
        stdoutPromise,
        stderrPromise,
        proc.exited,
      ]).then(([stdout, stderr, exitCode]) => ({ command, stdout, stderr, exitCode })),
      new Promise<CliRunResult>((resolve) => {
        setTimeout(() => resolve({
          command,
          stdout: '<unavailable: process did not exit after kill>',
          stderr: '<unavailable: process did not exit after kill>',
          exitCode: 'unknown',
        }), CLI_TIMEOUT_CLEANUP_MS);
      }),
    ]);
    throw new Error(`CLI command timed out after ${timeoutMs}ms\n${formatRunResult(result)}`);
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { command, stdout, stderr, exitCode: exitOrTimeout };
}

function tmpStateFile(): string {
  return join(tmpdir(), `uae-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
}

// ── Tests ─────────────────────────────────────────────────────

describe('CLI integration', () => {
  test('default text output with items', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe([
      '🇦🇪 UAE Latest News Digest',
      '',
      '🌧️ Dubai airport reopens after rain (Reuters, 1h ago)',
      '📉 Abu Dhabi market overview (Gulf News, 2h ago)',
      '',
    ].join('\n'));
  });

  test('--json produces agent-friendly envelope', async () => {
    const stateFile = tmpStateFile();
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const { stdout, stderr, exitCode } = await run([
      '--json',
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('dry run');
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed).sort()).toEqual(['count', 'items', 'query', 'tool', 'version', 'warnings']);
    expect(parsed.tool).toBe('uae-news-digest');
    expect(parsed.version).toBe(packageJson.version);
    expect(Object.keys(parsed.query).sort()).toEqual(['hours', 'limit', 'targetLang']);
    expect(parsed.query).toEqual({ hours: 36, limit: 6, targetLang: null });
    expect(parsed.count).toBe(2);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.items).toHaveLength(2);
    expect(Object.keys(parsed.items[0]).sort()).toEqual(['hoursAgo', 'publishedAt', 'score', 'source', 'title']);
    expect(parsed.items[0]).toEqual({
      title: 'Dubai airport reopens after rain',
      source: 'Reuters',
      score: 8,
      publishedAt: new Date(oneHourAgo).toISOString(),
      hoursAgo: 1,
    });
    expect(parsed.items[1]).toEqual({
      title: 'Abu Dhabi market overview',
      source: 'Gulf News',
      score: 6,
      publishedAt: new Date(twoHoursAgo).toISOString(),
      hoursAgo: 2,
    });
  });

  test('manifest reports package version and bin name', async () => {
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const { stdout, exitCode } = await run(['manifest']);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.id).toBe('uae-news-digest');
    expect(parsed.version).toBe(packageJson.version);
    expect(parsed.bin).toBe('uae-news-digest');
  });

  test('--dry-run does not write state file', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('dry run');
    const exists = await Bun.file(stateFile).exists();
    expect(exists).toBe(false);
  });

  test('translation via DeepL with --target-lang', async () => {
    const stateFile = tmpStateFile();
    const { stdout, stderr, exitCode } = await run(
      [
        '--rss-url', `${baseUrl}/rss`,
        '--state-file', stateFile,
        '--target-lang', 'DE',
        '--dry-run',
      ],
      {
        DEEPL_AUTH_KEY: 'fake-key',
        DEEPL_API_URL: `${baseUrl}/translate`,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain('Translating to DE');
    expect(stdout).toContain('Flughafen Dubai öffnet nach Regen wieder');
    expect(stdout).toContain('Marktübersicht Abu Dhabi');
  });

  test('translation failure warns and falls back to original titles', async () => {
    const stateFile = tmpStateFile();
    const { stdout, stderr, exitCode } = await run(
      [
        '--rss-url', `${baseUrl}/rss`,
        '--state-file', stateFile,
        '--target-lang', 'DE',
        '--dry-run',
      ],
      {
        DEEPL_AUTH_KEY: 'fake-key',
        DEEPL_API_URL: `${baseUrl}/translate/error`,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain('DeepL translation to DE failed; using original titles.');
    expect(stdout).toContain('Dubai airport reopens after rain');
  });

  test('--json includes warnings when translation falls back', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await run(
      [
        '--json',
        '--rss-url', `${baseUrl}/rss`,
        '--state-file', stateFile,
        '--target-lang', 'DE',
        '--dry-run',
      ],
      {
        DEEPL_AUTH_KEY: 'fake-key',
        DEEPL_API_URL: `${baseUrl}/translate/error`,
      },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.warnings).toEqual(['DeepL translation to DE failed; using original titles.']);
  });

  test('--target-lang without DEEPL_AUTH_KEY exits with error', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run(
      [
        '--rss-url', `${baseUrl}/rss`,
        '--state-file', stateFile,
        '--target-lang', 'DE',
      ],
      { DEEPL_AUTH_KEY: '' },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain('DEEPL_AUTH_KEY');
  });

  test('invalid test clock exits with error', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
      '--dry-run',
    ], { UAE_NEWS_DIGEST_NOW: 'not-a-date' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid UAE_NEWS_DIGEST_NOW');
  });

  test('RSS timeout shows timeout message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss/hang`,
      '--state-file', stateFile,
      '--timeout-ms', '200',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('timed out');
  });

  test('CLI helper times out hung commands with diagnostics', async () => {
    const stateFile = tmpStateFile();

    await expect(run([
      '--rss-url', `${baseUrl}/rss/hang`,
      '--state-file', stateFile,
      '--timeout-ms', '5000',
    ], undefined, { timeoutMs: 100 })).rejects.toThrow(/CLI command timed out after 100ms[\s\S]*command: bun[\s\S]*exitCode:[\s\S]*stdout:[\s\S]*stderr:/);
  });

  test('RSS network failure shows network message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--rss-url', 'http://localhost:1/rss',
      '--state-file', stateFile,
      '--timeout-ms', '2000',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unable to connect');
  });

  test('RSS HTTP error shows message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss/error`,
      '--state-file', stateFile,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('RSS fetch failed');
  });

  test('empty RSS feed shows no-news message', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await run([
      '--rss-url', `${baseUrl}/rss/empty`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('No significant news');
  });

  test('state file is written when not dry-run', async () => {
    const stateFile = tmpStateFile();
    const { exitCode } = await run([
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
    ]);

    expect(exitCode).toBe(0);
    const exists = await Bun.file(stateFile).exists();
    expect(exists).toBe(true);
    const content = await Bun.file(stateFile).text();
    expect(content).toContain('dubai airport reopens after rain');

    // Cleanup
    await Bun.$`rm -f ${stateFile}`.quiet();
  });
});
