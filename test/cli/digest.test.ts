import { describe, expect, test, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startCliHarness, tmpStateFile, feedConfig, cleanupTempDirs, expectExitCode, formatRunResult,
  CLI, TEXT_GOLDEN, PACKAGE_JSON, TEST_NOW,
} from '../helpers/cli';
import defaultConfig from '../../src/config/default.json';

const cli = startCliHarness();
afterAll(() => { cli.stop(); cleanupTempDirs(); });
beforeEach(() => cli.reset());

const oneHourAgo = new Date(TEST_NOW.getTime() - 3_600_000).toUTCString();
const twoHoursAgo = new Date(TEST_NOW.getTime() - 7_200_000).toUTCString();

const tempDirs: string[] = [];
afterAll(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });

describe('CLI digest', () => {
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

  test('default text output with items', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss`),
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe(await Bun.file(TEXT_GOLDEN).text());
  });

  test('--json produces agent-friendly envelope', async () => {
    const stateFile = tmpStateFile();
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const { stdout, stderr, exitCode } = await cli.run([
      '--json',
      '--config', feedConfig(`${cli.baseUrl}/rss`),
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

  test('--json enriches items with importance, signals, and tier', async () => {
    const stateFile = tmpStateFile();
    const result = await cli.run(
      ['--json', '--config', feedConfig(`${cli.baseUrl}/rss/fixture`), '--state-file', stateFile, '--dry-run'],
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

  test('--dry-run does not write state file', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss`),
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
    const result = await cli.run(
      [
        '--config', feedConfig(`${cli.baseUrl}/rss`),
        '--state-file', stateFile,
        '--target-lang', 'DE',
        '--dry-run',
      ],
      {
        DEEPL_AUTH_KEY: 'fake-key',
        DEEPL_API_URL: `${cli.baseUrl}/translate`,
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
    const { stdout, stderr, exitCode } = await cli.run(
      [
        '--config', feedConfig(`${cli.baseUrl}/rss`),
        '--state-file', stateFile,
        '--target-lang', 'DE',
        '--dry-run',
      ],
      {
        DEEPL_AUTH_KEY: 'fake-key',
        DEEPL_API_URL: `${cli.baseUrl}/translate/error`,
      },
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain('DeepL translation to DE failed (DeepL returned HTTP 500 Internal Server Error); using original titles.');
    expect(stdout).toContain('Dubai airport reopens after rain');
  });

  test('--json includes warnings when translation falls back', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await cli.run(
      [
        '--json',
        '--config', feedConfig(`${cli.baseUrl}/rss`),
        '--state-file', stateFile,
        '--target-lang', 'DE',
        '--dry-run',
      ],
      {
        DEEPL_AUTH_KEY: 'fake-key',
        DEEPL_API_URL: `${cli.baseUrl}/translate/error`,
      },
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.warnings).toEqual(['DeepL translation to DE failed (DeepL returned HTTP 500 Internal Server Error); using original titles.']);
  });

  test('--target-lang without DEEPL_AUTH_KEY exits with error', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await cli.run(
      [
        '--config', feedConfig(`${cli.baseUrl}/rss`),
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
    const { stderr, exitCode } = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss`),
      '--state-file', stateFile,
      '--dry-run',
    ], { UAE_NEWS_DIGEST_NOW: 'not-a-date' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid UAE_NEWS_DIGEST_NOW');
  });

  test('RSS timeout shows timeout message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const result = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss/hang`),
      '--state-file', stateFile,
      '--timeout-ms', '200',
    ]);

    expectExitCode(result, 1);
    expect(result.stderr).toContain('timed out');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss/hang', body: null }]);
  });

  test('CLI helper times out hung commands with diagnostics', async () => {
    const stateFile = tmpStateFile();

    await expect(cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss/hang`),
      '--state-file', stateFile,
      '--timeout-ms', '5000',
    ], undefined, { timeoutMs: 100 })).rejects.toThrow(/CLI command timed out after 100ms[\s\S]*command: bun[\s\S]*exitCode:[\s\S]*stdout:[\s\S]*stderr:[\s\S]*requests:/);
  });

  test('RSS network failure shows network message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const { stderr, exitCode } = await cli.run([
      '--config', feedConfig('http://localhost:1/rss'),
      '--state-file', stateFile,
      '--timeout-ms', '2000',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unable to connect');
  });

  test('RSS HTTP error shows message and exits 1', async () => {
    const stateFile = tmpStateFile();
    const result = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss/error`),
      '--state-file', stateFile,
    ]);

    expectExitCode(result, 1);
    expect(result.stderr).toContain('RSS fetch failed');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss/error', body: null }]);
  });

  test('HTTP 200 body that is not a feed (HTML error page) exits 1 with a parse message', async () => {
    const stateFile = tmpStateFile();
    const result = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss/html`),
      '--state-file', stateFile,
    ]);

    expectExitCode(result, 1);
    expect(result.stderr).toContain('could not parse RSS');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss/html', body: null }]);
  });

  test('--json still prints the envelope when every topic fails, and exits 1', async () => {
    const stateFile = tmpStateFile();
    const result = await cli.run([
      '--json',
      '--config', feedConfig(`${cli.baseUrl}/rss/error`),
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
        { ...defaultConfig.topics[0], slug: 'good', name: 'Good', emoji: '✅', feedUrl: `${cli.baseUrl}/rss` },
        { ...defaultConfig.topics[0], slug: 'bad', name: 'Bad', emoji: '❌', feedUrl: `${cli.baseUrl}/rss/error` },
      ],
    }));

    const stateFile = tmpStateFile();
    const { stdout, stderr, exitCode } = await cli.run([
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
    const { stdout, stderr, exitCode } = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss/empty`),
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('(no new items)');
    expect(stderr).toContain('feed returned no items');
  });

  test('state file is written when not dry-run', async () => {
    const stateFile = tmpStateFile();
    const { exitCode } = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss`),
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

  test('state file is not written when zero items were produced (not dry-run)', async () => {
    const stateFile = tmpStateFile();
    const { exitCode } = await cli.run([
      '--config', feedConfig(`${cli.baseUrl}/rss/empty`),
      '--state-file', stateFile,
    ]);

    expect(exitCode).toBe(0);
    const exists = await Bun.file(stateFile).exists();
    expect(exists).toBe(false);
  });

  test('--limit caps items per topic', async () => {
    const stateFile = tmpStateFile();
    const { stdout, exitCode } = await cli.run([
      '--json',
      '--limit', '1',
      '--config', feedConfig(`${cli.baseUrl}/rss`),
      '--state-file', stateFile,
      '--dry-run',
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.query.limit).toBe(1);
    expect(parsed.count).toBe(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.topics).toEqual([{ slug: 'uae', name: 'UAE', count: 1 }]);
  });

  test('--limit rejects non-integers with a usage error', async () => {
    const result = await cli.run(['--config', feedConfig(`${cli.baseUrl}/rss`), '--state-file', tmpStateFile(), '--limit', '2.5', '--dry-run']);
    expectExitCode(result, 1);
    expect(result.stderr).toContain('Invalid --limit: 2.5 — expected a positive integer');
    expect(result.requests).toEqual([]);
  });

  test('--limit rejects non-decimal-digit numeric forms with a usage error', async () => {
    const result = await cli.run(['--config', feedConfig(`${cli.baseUrl}/rss`), '--state-file', tmpStateFile(), '--limit', '1e3', '--dry-run']);
    expectExitCode(result, 1);
    expect(result.stderr).toContain('Invalid --limit: 1e3 — expected a positive integer');
    expect(result.requests).toEqual([]);
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
          { slug: 'a', name: 'Alpha', emoji: '🅰️', query: 'alpha', feedUrl: `${cli.baseUrl}/rss/fixture` },
          { slug: 'b', name: 'Beta',  emoji: '🅱️', query: 'beta', feedUrl: `${cli.baseUrl}/rss/fixture` },
        ],
      }),
    );
    return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
  }

  test('loads digest.config.json from cwd', async () => {
    const { cwd, cleanup } = writeTopicsCwd();
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await cli.runFromCwd(
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
        topics: [{ slug: 'x', name: 'Xray', emoji: '❎', query: 'xray', feedUrl: `${cli.baseUrl}/rss/fixture` }],
      }),
    );
    // The auto-detect candidate that --config must beat.
    writeFileSync(
      join(cwd, 'digest.config.json'),
      JSON.stringify({
        locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' },
        topics: [{ slug: 'ignored', name: 'Ignored', query: 'ignored', feedUrl: `${cli.baseUrl}/rss/fixture` }],
      }),
    );
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await cli.runFromCwd(
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
        topics: [{ slug: 'space', name: 'Space', emoji: '🚀', query: 'satellite', feedUrl: `${cli.baseUrl}/rss/fixture` }],
        emoji: [{ emoji: '🛰️', terms: ['satellite'] }],
        importance: { threshold: 1, impact: { weight: 2, markers: ['satellite'] } },
        // The fixture carries two near-duplicate satellite headlines; disable fuzzy
        // dedupe so both stay distinct and the exact-title assertion below is stable.
        dedupe: { similarityThreshold: 1 },
      }),
    );
    try {
      const stateFile = tmpStateFile();
      const { stdout, exitCode } = await cli.runFromCwd(
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
