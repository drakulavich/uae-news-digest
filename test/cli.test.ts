import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'bun';

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

// ── Tests ─────────────────────────────────────────────────────

describe('CLI integration', () => {
  test('CLI diagnostics include mock request history', () => {
    const diagnostic = formatRunResult({
      command: ['bun', CLI, '--rss-url', `${baseUrl}/rss`],
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
      '--rss-url', `${baseUrl}/rss`,
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
      '--rss-url', `${baseUrl}/rss`,
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain('dry run');
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed).sort()).toEqual(['count', 'items', 'mode', 'query', 'tool', 'version', 'warnings']);
    expect(parsed.tool).toBe('uae-news-digest');
    expect(parsed.version).toBe(packageJson.version);
    expect(Object.keys(parsed.query).sort()).toEqual(['hours', 'limit', 'targetLang']);
    expect(parsed.query).toEqual({ hours: 36, limit: 6, targetLang: null });
    expect(parsed.count).toBe(2);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.items).toHaveLength(2);
    expect(Object.keys(parsed.items[0]).sort()).toEqual(['googleUrl', 'hoursAgo', 'importance', 'matchedTerms', 'publishedAt', 'score', 'signals', 'source', 'tier', 'title']);
    expect(parsed.items[0]).toEqual({
      title: 'Dubai airport reopens after rain',
      source: 'Reuters',
      score: 9,
      publishedAt: new Date(oneHourAgo).toISOString(),
      hoursAgo: 1,
      importance: expect.any(Number),
      tier: expect.any(String),
      signals: expect.any(Array),
      matchedTerms: [],
      googleUrl: 'https://news.google.com/rss/articles/dubai-airport',
    });
    expect(parsed.items[1]).toEqual({
      title: 'Abu Dhabi market overview',
      source: 'Gulf News',
      score: 6,
      publishedAt: new Date(twoHoursAgo).toISOString(),
      hoursAgo: 2,
      importance: expect.any(Number),
      tier: expect.any(String),
      signals: expect.any(Array),
      matchedTerms: [],
      googleUrl: null,
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
    const fixturePath = join(import.meta.dir, 'fixtures', 'sample-feed.xml');
    const result = await run(
      ['--json', '--no-topics', '--rss-url', `file://${fixturePath}`, '--state-file', stateFile, '--dry-run'],
      { UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z' },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items[0]).toHaveProperty('importance');
    expect(parsed.items[0]).toHaveProperty('tier');
    expect(parsed.items[0]).toHaveProperty('signals');
    // every fixture item carries an <link>, so googleUrl flows through to JSON
    for (const item of parsed.items) {
      expect(item.googleUrl).toMatch(/^https:\/\/example\.com\//);
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
    expect(parsed.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'agent collect' }),
      expect.objectContaining({ name: 'agent commit' }),
    ]));
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
    const result = await run(
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
    const result = await run([
      '--rss-url', `${baseUrl}/rss/hang`,
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
      '--rss-url', `${baseUrl}/rss/hang`,
      '--state-file', stateFile,
      '--timeout-ms', '5000',
    ], undefined, { timeoutMs: 100 })).rejects.toThrow(/CLI command timed out after 100ms[\s\S]*command: bun[\s\S]*exitCode:[\s\S]*stdout:[\s\S]*stderr:[\s\S]*requests:/);
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
    const result = await run([
      '--rss-url', `${baseUrl}/rss/error`,
      '--state-file', stateFile,
    ]);

    expectExitCode(result, 1);
    expect(result.stderr).toContain('RSS fetch failed');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss/error', body: null }]);
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

describe('topics mode', () => {
  function writeTopicsCwd(): { cwd: string; cleanup: () => void } {
    const cwd = mkdtempSync(join(tmpdir(), 'cli-topics-'));
    writeFileSync(
      join(cwd, 'digest.config.json'),
      JSON.stringify({
        topics: [
          { slug: 'a', name: 'Alpha', emoji: '🅰️', query: 'alpha' },
          { slug: 'b', name: 'Beta',  emoji: '🅱️', query: 'beta' },
        ],
      }),
    );
    return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
  }

  const FIXTURE_PATH = join(import.meta.dir, 'fixtures', 'sample-feed.xml');

  test('auto-detects digest.config.json in cwd and switches to topics mode', async () => {
    const { cwd, cleanup } = writeTopicsCwd();
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await runFromCwd(
        ['--json', '--hours', '99999', '--state-file', stateFile],
        {
          cwd,
          env: {
            UAE_NEWS_DIGEST_TOPIC_FIXTURE: FIXTURE_PATH,
            UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z',
          },
        },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.mode).toBe('topics');
      expect(parsed.topics).toEqual([
        expect.objectContaining({ slug: 'a', name: 'Alpha' }),
        expect.objectContaining({ slug: 'b', name: 'Beta' }),
      ]);
      for (const item of parsed.items) {
        expect(['a', 'b']).toContain(item.topic);
      }
      await Bun.$`rm -f ${stateFile}`.quiet();
    } finally {
      cleanup();
    }
  });

  test('--no-topics forces legacy mode even with config present', async () => {
    const { cwd, cleanup } = writeTopicsCwd();
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await runFromCwd(
        [
          '--json', '--no-topics',
          '--rss-url', `${baseUrl}/rss`,
          '--state-file', stateFile,
        ],
        { cwd, env: { UAE_NEWS_DIGEST_NOW: TEST_NOW.toISOString() } },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.mode).toBe('region');
      expect(parsed.topics).toBeUndefined();
      await Bun.$`rm -f ${stateFile}`.quiet();
    } finally {
      cleanup();
    }
  });

  test('warns when --region is explicitly passed alongside topics config', async () => {
    const { cwd, cleanup } = writeTopicsCwd();
    try {
      const stateFile = tmpStateFile();
      const { stderr } = await runFromCwd(
        ['--region', 'us', '--json', '--state-file', stateFile],
        {
          cwd,
          env: {
            UAE_NEWS_DIGEST_TOPIC_FIXTURE: FIXTURE_PATH,
            UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z',
          },
        },
      );
      expect(stderr).toMatch(/--region.*ignored.*topics config/i);
      await Bun.$`rm -f ${stateFile}`.quiet();
    } finally {
      cleanup();
    }
  });

  test('--topics-config <path> overrides auto-detect', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cli-topics-explicit-'));
    const configPath = join(cwd, 'custom.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        topics: [{ slug: 'x', name: 'Xray', emoji: '❎', query: 'xray' }],
      }),
    );
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await runFromCwd(
        ['--json', '--topics-config', configPath, '--hours', '99999', '--state-file', stateFile],
        {
          cwd,
          env: {
            UAE_NEWS_DIGEST_TOPIC_FIXTURE: FIXTURE_PATH,
            UAE_NEWS_DIGEST_NOW: '2026-04-15T12:00:00Z',
          },
        },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.mode).toBe('topics');
      expect(parsed.topics).toEqual([expect.objectContaining({ slug: 'x', name: 'Xray' })]);
      await Bun.$`rm -f ${stateFile}`.quiet();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('agent workflow', () => {
  function tmpDir(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
  }

  test('collect returns broad, self-describing candidates without changing state', async () => {
    const stateFile = tmpStateFile();
    const cacheHome = tmpDir('uae-agent-cache-');
    try {
      const result = await run([
        'agent', 'collect',
        '--rss-url', `${baseUrl}/rss`,
        '--state-file', stateFile,
      ], { XDG_CACHE_HOME: cacheHome });

      expectExitCode(result, 0);
      expect(await Bun.file(stateFile).exists()).toBe(false);
      const parsed = JSON.parse(result.stdout);
      expect(Object.keys(parsed).sort()).toEqual(['count', 'instructions', 'items', 'mode', 'next', 'query', 'runId', 'tool', 'version']);
      expect(parsed.mode).toBe('region');
      expect(parsed.query).toEqual({ hours: 36, candidateLimit: 200 });
      expect(parsed.count).toBe(2);
      expect(parsed.instructions).toEqual([{
        source: 'built-in',
        text: expect.stringContaining('news filter for an expat family in the UAE'),
      }]);
      expect(parsed.next).toEqual({ command: 'agent commit', runId: parsed.runId });
      expect(Object.keys(parsed.items[0]).sort()).toEqual([
        'googleUrl', 'hoursAgo', 'id', 'importance', 'matchedTerms', 'publishedAt',
        'score', 'signals', 'source', 'tier', 'title',
      ]);
      expect(parsed.items[0].id).toEqual(expect.any(String));
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
    }
  });

  test('collect excludes existing seen items and composes config and flag rules in order', async () => {
    const stateFile = tmpStateFile();
    const cacheHome = tmpDir('uae-agent-cache-');
    const configHome = tmpDir('uae-agent-config-');
    mkdirSync(join(configHome, 'uae-news-digest'), { recursive: true });
    writeFileSync(join(configHome, 'uae-news-digest', 'filter.md'), 'Keep school updates too.');
    writeFileSync(stateFile, 'abu dhabi market overview || gulf news\n');
    try {
      const result = await run([
        'agent', 'collect',
        '--rss-url', `${baseUrl}/rss`,
        '--state-file', stateFile,
        '--filter-rule', 'Keep verified sources.',
        '--filter-rule', 'Prefer UAE coverage.',
      ], { XDG_CACHE_HOME: cacheHome, XDG_CONFIG_HOME: configHome });

      expectExitCode(result, 0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.count).toBe(1);
      expect(parsed.items[0].title).toBe('Dubai airport reopens after rain');
      expect(parsed.instructions).toEqual([
        { source: 'built-in', text: expect.any(String) },
        { source: 'config', text: 'Keep school updates too.' },
        { source: 'flag', text: 'Keep verified sources.' },
        { source: 'flag', text: 'Prefer UAE coverage.' },
      ]);
      expect(await Bun.file(stateFile).text()).toBe('abu dhabi market overview || gulf news\n');
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
      rmSync(configHome, { recursive: true, force: true });
      rmSync(stateFile, { force: true });
    }
  });

  test('collect rejects invalid limits and explicit topics configs without creating a run', async () => {
    const stateFile = tmpStateFile();
    const cacheHome = tmpDir('uae-agent-cache-');
    try {
      const invalidLimit = await run(['agent', 'collect', '--limit', '0', '--state-file', stateFile], {
        XDG_CACHE_HOME: cacheHome,
      });
      expectExitCode(invalidLimit, 1);
      expect(invalidLimit.stderr).toContain('Invalid --limit');

      const topicsConfig = join(cacheHome, 'topics.json');
      writeFileSync(topicsConfig, '{"topics":[]}');
      const topics = await run(['agent', 'collect', '--topics-config', topicsConfig, '--state-file', stateFile], {
        XDG_CACHE_HOME: cacheHome,
      });
      expectExitCode(topics, 1);
      expect(topics.stderr).toMatch(/region-only/i);
      expect(await Bun.file(stateFile).exists()).toBe(false);
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
    }
  });

  test('collect fails safely when the persistent rules path cannot be read', async () => {
    const stateFile = tmpStateFile();
    const cacheHome = tmpDir('uae-agent-cache-');
    const configHome = tmpDir('uae-agent-config-');
    const rulesPath = join(configHome, 'uae-news-digest', 'filter.md');
    mkdirSync(rulesPath, { recursive: true });
    try {
      const result = await run([
        'agent', 'collect', '--rss-url', `${baseUrl}/rss`, '--state-file', stateFile,
      ], { XDG_CACHE_HOME: cacheHome, XDG_CONFIG_HOME: configHome });
      expectExitCode(result, 1);
      expect(result.stderr).toMatch(/could not read persistent agent filter rules/i);
      expect(await Bun.file(stateFile).exists()).toBe(false);
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
      rmSync(configHome, { recursive: true, force: true });
    }
  });

  test('commit records every reviewed candidate, preserves an intervening write, and returns only kept items', async () => {
    const stateFile = tmpStateFile();
    const cacheHome = tmpDir('uae-agent-cache-');
    try {
      const collected = await run([
        'agent', 'collect', '--rss-url', `${baseUrl}/rss`, '--state-file', stateFile,
      ], { XDG_CACHE_HOME: cacheHome });
      expectExitCode(collected, 0);
      const candidate = JSON.parse(collected.stdout);
      writeFileSync(stateFile, 'intervening item || another source\n');

      const committed = await run([
        'agent', 'commit', '--run-id', candidate.runId, '--keep', candidate.items[0].id,
      ], { XDG_CACHE_HOME: cacheHome });
      expectExitCode(committed, 0);
      const parsed = JSON.parse(committed.stdout);
      expect(parsed.count).toBe(1);
      expect(parsed.items).toEqual([expect.objectContaining({ id: candidate.items[0].id })]);
      const state = await Bun.file(stateFile).text();
      expect(state).toContain('intervening item || another source');
      expect(state).toContain('dubai airport reopens after rain || reuters');
      expect(state).toContain('abu dhabi market overview || gulf news');
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
      rmSync(stateFile, { force: true });
    }
  });

  test('commit rejects invalid, duplicate, and expired runs without changing state', async () => {
    const stateFile = tmpStateFile();
    const cacheHome = tmpDir('uae-agent-cache-');
    try {
      const collected = await run([
        'agent', 'collect', '--rss-url', `${baseUrl}/rss`, '--state-file', stateFile,
      ], { XDG_CACHE_HOME: cacheHome });
      const candidate = JSON.parse(collected.stdout);

      const invalid = await run([
        'agent', 'commit', '--run-id', candidate.runId, '--keep', 'wrong-id',
      ], { XDG_CACHE_HOME: cacheHome });
      expectExitCode(invalid, 1);
      expect(invalid.stderr).toMatch(/not part of run/i);
      expect(await Bun.file(stateFile).exists()).toBe(false);

      const committed = await run(['agent', 'commit', '--run-id', candidate.runId], { XDG_CACHE_HOME: cacheHome });
      expectExitCode(committed, 0);
      expect(JSON.parse(committed.stdout)).toMatchObject({ count: 0, items: [] });
      const duplicate = await run(['agent', 'commit', '--run-id', candidate.runId], { XDG_CACHE_HOME: cacheHome });
      expectExitCode(duplicate, 1);
      expect(duplicate.stderr).toMatch(/agent collect again/i);

      const unknown = await run(['agent', 'commit', '--run-id', '00000000-0000-4000-8000-000000000000'], {
        XDG_CACHE_HOME: cacheHome,
      });
      expectExitCode(unknown, 1);
      expect(unknown.stderr).toMatch(/unknown or unavailable agent run/i);

      const expiring = await run([
        'agent', 'collect', '--rss-url', `${baseUrl}/rss`, '--state-file', stateFile,
      ], { XDG_CACHE_HOME: cacheHome });
      const expiredRun = JSON.parse(expiring.stdout);
      const expired = await run(['agent', 'commit', '--run-id', expiredRun.runId], {
        XDG_CACHE_HOME: cacheHome,
        UAE_NEWS_DIGEST_NOW: new Date(TEST_NOW.getTime() + 25 * 3_600_000).toISOString(),
      });
      expectExitCode(expired, 1);
      expect(expired.stderr).toMatch(/agent collect again/i);
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
      rmSync(stateFile, { force: true });
    }
  });
});
