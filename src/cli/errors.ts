export type CliErrorKind = 'usage' | 'config' | 'network' | 'timeout';

/** A user-facing failure: the message says what failed, why, and what to do; `kind` is for tests and callers. */
export class CliError extends Error {
  readonly kind: CliErrorKind;

  constructor(kind: CliErrorKind, message: string) {
    super(message);
    this.name = 'CliError';
    this.kind = kind;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Turn a rejected fetch() into a CliError at the source, so nothing upstream matches on message text. */
export function classifyFetchError(err: unknown, ctx: { url: string; timeoutMs: number }): CliError {
  const e = (err ?? {}) as { name?: string; code?: string; message?: string };
  if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    return new CliError('timeout', `RSS request timed out after ${ctx.timeoutMs}ms — retry, or pass --timeout-ms 30000`);
  }
  const detail = e.code ?? e.message ?? String(err);
  return new CliError('network', `Unable to connect to ${hostOf(ctx.url)} — check your connection (${detail})`);
}
