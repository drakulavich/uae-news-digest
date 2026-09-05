import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';
import defaultConfig from '../src/config/default.json';

// ── Canned responses ──────────────────────────────────────────

const TEST_NOW = new Date('2026-03-22T08:00:00Z');
const oneHourAgo = new Date(TEST_NOW.getTime() - 3_600_000).toUTCString();
const twoHoursAgo = new Date(TEST_NOW.getTime() - 7_200_000).toUTCString();

const RSS_XML = `<?xml version="1.0"?><rss><channel>
  <item><title>Dubai airport reopens after rain</title><link>https://news.google.com/rss/articles/dubai-airport</link><pubDate>${oneHourAgo}</pubDate><source url="https://example.com">Reuters</source></item>
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
type CapturedRequest = {
  method: string;
  path: string;
  body: unknown;
};
let requestHistory: CapturedRequest[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === 'POST' ? await req.clone().json().catch(() => null) : null;
      requestHistory.push({ method: req.method, path: url.pathname, body });

      if (url.pathname === '/rss') {
        return new Response(RSS_XML, { headers: { 'content-type': 'application/xml' } });
      }

      if (url.pathname === '/rss/fixture') {
        return new Response(await Bun.file(join(import.meta.dir, 'fixtures', 'sample-feed.xml')).text(), { headers: { 'content-type': 'application/xml' } });
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

beforeEach(() => {
  requestHistory = [];
});

// ── Helpers ───────────────────────────────────────────────────

const CLI = join(import.meta.dir, '..', 'src', 'index.ts');
const PACKAGE_JSON = join(import.meta.dir, '..', 'package.json');
const TEXT_GOLDEN = join(import.meta.dir, 'fixtures', 'cli-default-output.txt');

type CliRunResult = {
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number | 'unknown';
  requests: CapturedRequest[];
};

const CLI_TIMEOUT_CLEANUP_MS = 1_000;

function formatRunResult(result: CliRunResult): string {
  return [
    `command: ${result.command.join(' ')}`,
    `exitCode: ${result.exitCode}`,
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
    `requests:\n${formatRequests(result.requests)}`,
  ].join('\n');
}

function formatRequests(requests: CapturedRequest[]): string {
  if (requests.length === 0) return '(none)';
  return requests.map((req) => {
    const body = req.body === null ? '' : ` body=${JSON.stringify(req.body)}`;
    return `${req.method} ${req.path}${body}`;
  }).join('\n');
}

function expectExitCode(result: CliRunResult, expected: number): void {
  if (result.exitCode !== expected) {
    throw new Error(`Expected exit code ${expected}\n${formatRunResult(result)}`);
  }
}

async function run(
  args: string[],
  env?: Record<string, string>,
  options: { timeoutMs?: number } = {},
): Promise<CliRunResult> {
  const command = ['bun', CLI, ...args];
  const timeoutMs = options.timeoutMs ?? 5_000;
  // Neutralize HOME/XDG so the user's real ~/.config/uae-news-digest/topics.json
  // can't bleed into legacy-mode CLI tests via auto-detect.
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      HOME: '/nonexistent',
      XDG_CONFIG_HOME: '/nonexistent',
      UAE_NEWS_DIGEST_NOW: TEST_NOW.toISOString(),
      ...env,
    },
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
      ]).then(([stdout, stderr, exitCode]) => ({ command, stdout, stderr, exitCode, requests: [...requestHistory] })),
      new Promise<CliRunResult>((resolve) => {
        setTimeout(() => resolve({
          command,
          stdout: '<unavailable: process did not exit after kill>',
          stderr: '<unavailable: process did not exit after kill>',
          exitCode: 'unknown',
          requests: [...requestHistory],
        }), CLI_TIMEOUT_CLEANUP_MS);
      }),
    ]);
    throw new Error(`CLI command timed out after ${timeoutMs}ms\n${formatRunResult(result)}`);
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { command, stdout, stderr, exitCode: exitOrTimeout, requests: [...requestHistory] };
}

async function runFromCwd(
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
  options: { timeoutMs?: number } = {},
): Promise<CliRunResult> {
  const command = ['bun', CLI, ...args];
  const timeoutMs = options.timeoutMs ?? 10_000;
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
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
      Promise.all([stdoutPromise, stderrPromise, proc.exited]).then(([stdout, stderr, exitCode]) => ({
        command,
        stdout,
        stderr,
        exitCode,
        requests: [...requestHistory],
      })),
      new Promise<CliRunResult>((resolve) => {
        setTimeout(() => resolve({
          command,
          stdout: '<unavailable: process did not exit after kill>',
          stderr: '<unavailable: process did not exit after kill>',
          exitCode: 'unknown',
          requests: [...requestHistory],
        }), CLI_TIMEOUT_CLEANUP_MS);
      }),
    ]);
    throw new Error(`CLI command timed out after ${timeoutMs}ms\n${formatRunResult(result)}`);
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { command, stdout, stderr, exitCode: exitOrTimeout, requests: [...requestHistory] };
}

function tmpStateFile(): string {
  return join(tmpdir(), `uae-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
}

const tempDirs: string[] = [];
afterAll(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });

/** A config identical to the built-in UAE one, except the topic fetches `feedUrl`. Returns the `--config` path. */
function feedConfig(feedUrl: string, topicOverrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-feed-'));
  tempDirs.push(dir);
  const path = join(dir, 'digest.config.json');
  writeFileSync(path, JSON.stringify({
    ...defaultConfig,
    topics: [{ ...defaultConfig.topics[0], feedUrl, ...topicOverrides }],
  }));
  return path;
}

// ── Tests ─────────────────────────────────────────────────────

describe('CLI integration', () => {
  test('CLI diagnostics include mock request history', () => {
    const diagnostic = formatRunResult({
      command: ['bun', CLI, '--config', '/tmp/digest.config.json'],
      stdout: '',
      stderr: 'RSS fetch failed',
      exitCode: 1,
      requests: [{ method: 'GET', path: '/rss', body: null }],
    });

    expect(diagnostic).toContain('requests:');
    expect(diagnostic).toContain('GET /rss');
  });

  test('--version prints version string and exits 0', async () => {
    const { stdout, exitCode } = await run(['--version']);
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(packageJson.version);
  });

  test('default text output with items', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await run([
      '--config', feedConfig(`${baseUrl}/rss`),
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe(await Bun.file(TEXT_GOLDEN).text());
  });

  test('--json produces agent-friendly envelope', async () => {
    const stateFile = tmpStateFile();
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const { stdout, stderr, exitCode } = await run([
      '--json',
      '--config', feedConfig(`${baseUrl}/rss`),
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('dry run');
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed).sort()).toEqual(['count', 'generatedAt', 'items', 'query', 'tool', 'topics', 'version', 'warnings']);
    expect(parsed.tool).toBe('uae-news-digest');
    expect(parsed.version).toBe(packageJson.version);
    expect(Object.keys(parsed.query).sort()).toEqual(['hours', 'limit', 'targetLang']);
    expect(parsed.query).toEqual({ hours: 36, limit: null, targetLang: null });
    expect(parsed.topics).toEqual([{ slug: 'uae', name: 'UAE', count: 2 }]);
    expect(parsed.count).toBe(2);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.items).toHaveLength(2);
    expect(Object.keys(parsed.items[0]).sort()).toEqual(['hoursAgo', 'importance', 'matchedTerms', 'publishedAt', 'score', 'signals', 'source', 'tier', 'title', 'topic', 'translatedTitle', 'url']);
    expect(parsed.items[0]).toEqual({
      topic: 'uae',
      title: 'Dubai airport reopens after rain',
      translatedTitle: null,
      source: 'Reuters',
      score: 9,
      publishedAt: new Date(oneHourAgo).toISOString(),
      hoursAgo: 1,
      importance: expect.any(Number),
      tier: expect.any(String),
      signals: expect.any(Array),
      matchedTerms: [],
      url: 'https://news.google.com/rss/articles/dubai-airport',
    });
    expect(parsed.items[1]).toEqual({
      topic: 'uae',
      title: 'Abu Dhabi market overview',
      translatedTitle: null,
      source: 'Gulf News',
      score: 6,
      publishedAt: new Date(twoHoursAgo).toISOString(),
      hoursAgo: 2,
      importance: expect.any(Number),
      tier: expect.any(String),
      signals: expect.any(Array),
      matchedTerms: [],
      url: null,
    });
  });

  test('--prompt prints the filter criterion and exits 0', async () => {
    const proc = Bun.spawn(['bun', CLI, '--prompt'], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(out).toContain('news filter for an expat family in the UAE');
  });

  test('--json enriches items with importance, signals, and tier', async () => {
    const stateFile = tmpStateFile();
    const result = await run(
      ['--json', '--config', feedConfig(`${baseUrl}/rss/fixture`), '--state-file', stateFile, '--dry-run'],
      { UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z' },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items[0]).toHaveProperty('importance');
    expect(parsed.items[0]).toHaveProperty('tier');
    expect(parsed.items[0]).toHaveProperty('signals');
    // every fixture item carries a <link>, so url flows through to JSON
    for (const item of parsed.items) {
      expect(item.url).toMatch(/^https:\/\/example\.com\//);
    }
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

  test('healthcheck supports deterministic RSS URL', async () => {
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const result = await run(['healthcheck', '--rss-url', `${baseUrl}/rss`]);

    expectExitCode(result, 0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.version).toBe(packageJson.version);
    expect(typeof parsed.latencyMs).toBe('number');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss', body: null }]);
  });

  test('healthcheck reports non-200 RSS URL as unhealthy', async () => {
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const result = await run(['healthcheck', '--rss-url', `${baseUrl}/rss/error`]);

    expectExitCode(result, 1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.version).toBe(packageJson.version);
    expect(typeof parsed.latencyMs).toBe('number');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss/error', body: null }]);
  });

  test('--dry-run does not write state file', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--config', feedConfig(`${baseUrl}/rss`),
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
    const result = await run(
      [
        '--config', feedConfig(`${baseUrl}/rss`),
        '--state-file', stateFile,
        '--target-lang', 'DE',
        '--dry-run',
      ],
      {
        DEEPL_AUTH_KEY: 'fake-key',
        DEEPL_API_URL: `${baseUrl}/translate`,
      },
    );

    expectExitCode(result, 0);
    expect(result.stderr).toContain('Translating to DE');
    expect(result.stdout).toContain('Flughafen Dubai öffnet nach Regen wieder');
    expect(result.stdout).toContain('Marktübersicht Abu Dhabi');
    expect(result.requests).toEqual([
      { method: 'GET', path: '/rss', body: null },
      {
        method: 'POST',
        path: '/translate',
        body: {
          text: [
            'Dubai airport reopens after rain',
            'Abu Dhabi market overview',
          ],
          target_lang: 'DE',
        },
      },
    ]);
  });

  test('translation failure warns and falls back to original titles', async () => {
    const stateFile = tmpStateFile();
    const { stdout, stderr, exitCode } = await run(
      [
        '--config', feedConfig(`${baseUrl}/rss`),
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
    expect(stderr).toContain('DeepL translation to DE failed (DeepL returned HTTP 500 Internal Server Error); using original titles.');
    expect(stdout).toContain('Dubai airport reopens after rain');
  });

  test('--json includes warnings when translation falls back', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await run(
      [
        '--json',
        '--config', feedConfig(`${baseUrl}/rss`),
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
    expect(parsed.warnings).toEqual(['DeepL translation to DE failed (DeepL returned HTTP 500 Internal Server Error); using original titles.']);
  });

  test('--target-lang without DEEPL_AUTH_KEY exits with error', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run(
      [
        '--config', feedConfig(`${baseUrl}/rss`),
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
      '--config', feedConfig(`${baseUrl}/rss`),
      '--state-file', stateFile,
      '--dry-run',
    ], { UAE_NEWS_DIGEST_NOW: 'not-a-date' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid UAE_NEWS_DIGEST_NOW');
  });

  test('RSS timeout shows timeout message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const result = await run([
      '--config', feedConfig(`${baseUrl}/rss/hang`),
      '--state-file', stateFile,
      '--timeout-ms', '200',
    ]);

    expectExitCode(result, 1);
    expect(result.stderr).toContain('timed out');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss/hang', body: null }]);
  });

  test('CLI helper times out hung commands with diagnostics', async () => {
    const stateFile = tmpStateFile();

    await expect(run([
      '--config', feedConfig(`${baseUrl}/rss/hang`),
      '--state-file', stateFile,
      '--timeout-ms', '5000',
    ], undefined, { timeoutMs: 100 })).rejects.toThrow(/CLI command timed out after 100ms[\s\S]*command: bun[\s\S]*exitCode:[\s\S]*stdout:[\s\S]*stderr:[\s\S]*requests:/);
  });

  test('RSS network failure shows network message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await run([
      '--config', feedConfig('http://localhost:1/rss'),
      '--state-file', stateFile,
      '--timeout-ms', '2000',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unable to connect');
  });

  test('RSS HTTP error shows message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const result = await run([
      '--config', feedConfig(`${baseUrl}/rss/error`),
      '--state-file', stateFile,
    ]);

    expectExitCode(result, 1);
    expect(result.stderr).toContain('RSS fetch failed');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss/error', body: null }]);
  });

  test('--json still prints the envelope when every topic fails, and exits 1', async () => {
    const stateFile = tmpStateFile();
    const result = await run([
      '--json',
      '--config', feedConfig(`${baseUrl}/rss/error`),
      '--state-file', stateFile,
    ]);

    expectExitCode(result, 1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.count).toBe(0);
    expect(parsed.items).toEqual([]);
    expect(parsed.warnings[0]).toContain('RSS fetch failed');
    // in JSON mode warnings live in the envelope, but the exit-1 path also echoes them
    expect(result.stderr).toContain('RSS fetch failed');
  });

  test('one failing topic is a warning, not a failure: exit 0 and the other section still renders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-partial-'));
    tempDirs.push(dir);
    const configPath = join(dir, 'digest.config.json');
    writeFileSync(configPath, JSON.stringify({
      ...defaultConfig,
      topics: [
        { ...defaultConfig.topics[0], slug: 'good', name: 'Good', emoji: '✅', feedUrl: `${baseUrl}/rss` },
        { ...defaultConfig.topics[0], slug: 'bad', name: 'Bad', emoji: '❌', feedUrl: `${baseUrl}/rss/error` },
      ],
    }));

    const stateFile = tmpStateFile();
    const { stdout, stderr, exitCode } = await run([
      '--config', configPath,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('Topic "bad" failed: RSS fetch failed: HTTP 500');
    expect(stdout).toContain('✅ Good\n  🌧️ Dubai airport reopens after rain');
    expect(stdout).toContain('❌ Bad\n  (no new items)');
  });

  test('empty RSS feed shows no-news message', async () => {
    const stateFile = tmpStateFile();
    const { stdout, stderr, exitCode } = await run([
      '--config', feedConfig(`${baseUrl}/rss/empty`),
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('(no new items)');
    expect(stderr).toContain('feed returned no items');
  });

  test('state file is written when not dry-run', async () => {
    const stateFile = tmpStateFile();
    const { exitCode } = await run([
      '--config', feedConfig(`${baseUrl}/rss`),
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

describe('config discovery', () => {
  function writeTopicsCwd(): { cwd: string; cleanup: () => void } {
    const cwd = mkdtempSync(join(tmpdir(), 'cli-topics-'));
    writeFileSync(
      join(cwd, 'digest.config.json'),
      JSON.stringify({
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [
          { slug: 'a', name: 'Alpha', emoji: '🅰️', query: 'alpha', feedUrl: `${baseUrl}/rss/fixture` },
          { slug: 'b', name: 'Beta',  emoji: '🅱️', query: 'beta', feedUrl: `${baseUrl}/rss/fixture` },
        ],
      }),
    );
    return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
  }

  test('loads digest.config.json from cwd', async () => {
    const { cwd, cleanup } = writeTopicsCwd();
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await runFromCwd(
        ['--json', '--hours', '99999', '--state-file', stateFile],
        { cwd, env: { UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z' } },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.topics).toEqual([
        expect.objectContaining({ slug: 'a', name: 'Alpha' }),
        expect.objectContaining({ slug: 'b', name: 'Beta' }),
      ]);
      expect(parsed.items.length).toBeGreaterThan(0);
      for (const item of parsed.items) {
        expect(['a', 'b']).toContain(item.topic);
      }
      await Bun.$`rm -f ${stateFile}`.quiet();
    } finally {
      cleanup();
    }
  });

  test('--config <path> overrides auto-detect', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cli-topics-explicit-'));
    const configPath = join(cwd, 'custom.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [{ slug: 'x', name: 'Xray', emoji: '❎', query: 'xray', feedUrl: `${baseUrl}/rss/fixture` }],
      }),
    );
    // The auto-detect candidate that --config must beat.
    writeFileSync(
      join(cwd, 'digest.config.json'),
      JSON.stringify({
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [{ slug: 'ignored', name: 'Ignored', query: 'ignored', feedUrl: `${baseUrl}/rss/fixture` }],
      }),
    );
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await runFromCwd(
        ['--json', '--config', configPath, '--hours', '99999', '--state-file', stateFile],
        { cwd, env: { UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z' } },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.topics).toEqual([expect.objectContaining({ slug: 'x', name: 'Xray' })]);
      await Bun.$`rm -f ${stateFile}`.quiet();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('heuristics from the config file drive emoji and the Important block', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cli-topics-heuristics-'));
    writeFileSync(
      join(cwd, 'digest.config.json'),
      JSON.stringify({
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [{ slug: 'space', name: 'Space', emoji: '🚀', query: 'satellite', feedUrl: `${baseUrl}/rss/fixture` }],
        emoji: [{ emoji: '🛰️', terms: ['satellite'] }],
        importance: { threshold: 1, impact: { weight: 2, markers: ['satellite'] } },
        // The fixture carries two near-duplicate satellite headlines; disable fuzzy
        // dedupe so both stay distinct and the exact-title assertion below is stable.
        dedupe: { similarityThreshold: 1 },
      }),
    );
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await runFromCwd(
        ['--hours', '99999', '--dry-run', '--state-file', stateFile],
        { cwd, env: { UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z' } },
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain('🚨 Important');
      expect(stdout).toContain('🛰️ UAE launches new satellite');
      expect(stdout).toContain('[satellite]');
      // If the file's emoji rules were ignored the line would fall back to the bullet.
      expect(stdout).not.toContain('• UAE launches new satellite');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
