import { describe, expect, test, afterAll, beforeEach } from 'bun:test';
import { startCliHarness, cleanupTempDirs, expectExitCode, PACKAGE_JSON } from '../helpers/cli';

const cli = startCliHarness();
afterAll(() => { cli.stop(); cleanupTempDirs(); });
beforeEach(() => cli.reset());

describe('CLI commands', () => {
  test('--version prints version string and exits 0', async () => {
    const { stdout, exitCode } = await cli.run(['--version']);
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(packageJson.version);
  });

  test('manifest reports package version and bin name', async () => {
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const { stdout, exitCode } = await cli.run(['manifest']);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.id).toBe('uae-news-digest');
    expect(parsed.version).toBe(packageJson.version);
    expect(parsed.bin).toBe('uae-news-digest');
  });

  test('healthcheck supports deterministic RSS URL', async () => {
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const result = await cli.run(['healthcheck', '--rss-url', `${cli.baseUrl}/rss`]);

    expectExitCode(result, 0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.version).toBe(packageJson.version);
    expect(typeof parsed.latencyMs).toBe('number');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss', body: null }]);
  });

  test('healthcheck reports non-200 RSS URL as unhealthy', async () => {
    const packageJson = await Bun.file(PACKAGE_JSON).json();
    const result = await cli.run(['healthcheck', '--rss-url', `${cli.baseUrl}/rss/error`]);

    expectExitCode(result, 1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.version).toBe(packageJson.version);
    expect(typeof parsed.latencyMs).toBe('number');
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss/error', body: null }]);
  });

  test('--prompt prints the filter criterion and exits 0', async () => {
    const { stdout, exitCode } = await cli.run(['--prompt']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('news filter for an expat family in the UAE');
  });
});
