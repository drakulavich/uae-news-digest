import { describe, expect, test } from 'bun:test';
import { main } from '../../src/cli/program';

const NOISE = ['bun', 'index.ts'];

describe('main', () => {
  test('--version and --help exit 0 through the single exit path', async () => {
    expect(await main([...NOISE, '--version'])).toBe(0);
    expect(await main([...NOISE, '--help'])).toBe(0);
  });

  test('an unknown option exits 1 (commander prints the usage error)', async () => {
    expect(await main([...NOISE, '--bogus'])).toBe(1);
  });

  test('a usage error from the default command exits 1 with its message on stderr', async () => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
    try {
      expect(await main([...NOISE, '--hours', 'abc', '--config', '/nonexistent/config.json'], { HOME: '/nonexistent' }, '/')).toBe(1);
    } finally {
      console.error = original;
    }
    expect(lines.join('\n')).toContain('Invalid --hours: abc');
  });
});
