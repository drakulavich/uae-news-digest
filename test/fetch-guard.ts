const originalFetch = globalThis.fetch;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isAllowedTestUrl(rawUrl: string): boolean {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  return LOOPBACK_HOSTS.has(url.hostname);
}

const guardedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const rawUrl = requestUrl(input);
  if (!isAllowedTestUrl(rawUrl)) {
    throw new Error(`Unexpected network access in tests: ${rawUrl}`);
  }
  return originalFetch(input, init);
};

Object.assign(guardedFetch, originalFetch);
globalThis.fetch = guardedFetch as typeof fetch;
