import { describe, expect, test, afterAll, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import defaultConfig from '../../src/config/default.json';
import { buildProgram } from '../../src/cli/program';
import { startCliHarness, cleanupTempDirs, expectExitCode, PACKAGE_JSON, feedConfig } from '../helpers/cli';

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

  test('manifest lists exactly the flags defined on the program, and the subcommands', async () => {
    const { stdout, exitCode } = await cli.run(['manifest']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const expectedFlags = buildProgram(() => {}, {}, '/').options.filter((o) => o.long !== '--version').map((o) => o.flags);
    expect(parsed.commands[0].name).toBe('(default)');
    expect(parsed.commands[0].flags).toEqual(expectedFlags);
    expect(parsed.commands.slice(1).map((c: { name: string }) => c.name)).toEqual(['manifest', 'healthcheck', 'config']);
  });

  test('healthcheck without --rss-url probes the first topic of the resolved config', async () => {
    const result = await cli.run(['healthcheck', '--config', feedConfig(`${cli.baseUrl}/rss`)]);
    expectExitCode(result, 0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
    expect(result.requests).toEqual([{ method: 'GET', path: '/rss', body: null }]);
  });

  test('--prompt prints agentPrompt from the resolved config', async () => {
    const config = feedConfig(`${cli.baseUrl}/rss`, {}, { agentPrompt: 'Custom prompt for tests' });
    const { stdout, exitCode } = await cli.run(['--prompt', '--config', config]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('Custom prompt for tests\n');
  });

  test('--prompt fails cleanly when the config has no agentPrompt', async () => {
    const config = feedConfig(`${cli.baseUrl}/rss`, {}, { agentPrompt: undefined });
    const result = await cli.run(['--prompt', '--config', config]);
    expectExitCode(result, 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`Config at ${config} has no "agentPrompt"`);
  });

  test('config print-default prints the built-in config as JSON', async () => {
    const { stdout, exitCode } = await cli.run(['config', 'print-default']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(defaultConfig);
  });

  test('config validate <path> reports ok for a valid file', async () => {
    const config = feedConfig(`${cli.baseUrl}/rss`);
    const result = await cli.run(['config', 'validate', config]);
    expectExitCode(result, 0);
    expect(result.stdout).toStartWith('ok');
    expect(result.stdout).toContain('1 topic(s)');
  });

  test('config validate lists every issue with its JSON path and exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-broken-'));
    const path = join(dir, 'broken.json');
    writeFileSync(path, JSON.stringify({ locale: { hl: 'en', gl: 'AE', ceid: 'AE:en' }, topics: [{ slug: 'a', name: 'A' }], bogus: 1 }));
    try {
      const result = await cli.run(['config', 'validate', path]);
      expectExitCode(result, 1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`Invalid config at ${path}`);
      expect(result.stderr).toContain('topics[0].query');
      expect(result.stderr).toContain('bogus');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('config validate with a missing explicit path exits 1', async () => {
    const result = await cli.run(['config', 'validate', '/nonexistent/digest.config.json']);
    expectExitCode(result, 1);
    expect(result.stderr).toContain('Config not found: /nonexistent/digest.config.json');
  });

  test('config validate without a path and nothing discoverable says so', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cli-nocfg-'));
    try {
      const result = await cli.runFromCwd(['config', 'validate'], { cwd, env: { HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent' } });
      expectExitCode(result, 1);
      expect(result.stderr).toContain('No config found');
      expect(result.stderr).toContain('config print-default');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
