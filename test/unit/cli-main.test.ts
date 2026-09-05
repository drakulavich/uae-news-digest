import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import { main } from '../../src/cli/program';

const NOISE = ['bun', 'index.ts'];

/** A minimal program whose default action throws, to exercise main's catch branches without the real CLI. */
function buildThrowingProgram(_onExit: (code: number) => void, _env: Record<string, string | undefined>, _cwd: string): Command {
  const program = new Command();
  program.exitOverride();
  program.action(() => {
    throw new TypeError('boom');
  });
  return program;
}

/** A minimal program whose default action never calls onExit, simulating an action that forgot to report a code. */
function buildForgetfulProgram(_onExit: (code: number) => void, _env: Record<string, string | undefined>, _cwd: string): Command {
  const program = new Command();
  program.exitOverride();
  program.action(() => {});
  return program;
}

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
      expect(await main([...NOISE, '--hours', 'abc'], { HOME: '/nonexistent' }, '/')).toBe(1);
    } finally {
      console.error = original;
    }
    expect(lines.join('\n')).toContain('Invalid --hours: abc');
  });

  test('an unexpected (non-CliError) exception exits 1 and prints its stack', async () => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
    try {
      expect(await main([...NOISE], {}, '/', buildThrowingProgram)).toBe(1);
    } finally {
      console.error = original;
    }
    const output = lines.join('\n');
    expect(output).toContain('TypeError: boom');
    expect(output).toContain('at ');
  });

  test('an action that never reports an exit code exits 1 with an internal-error message', async () => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
    try {
      expect(await main([...NOISE], {}, '/', buildForgetfulProgram)).toBe(1);
    } finally {
      console.error = original;
    }
    expect(lines.join('\n')).toContain('internal error: the command finished without reporting an exit code');
  });
});
