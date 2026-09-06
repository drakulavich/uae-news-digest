import type { FetchText, Translate } from '../pipeline/run';
import { translateDeepL } from '../translate';
import { CliError, classifyFetchError } from './errors';

export const USER_AGENT = 'Mozilla/5.0 (uae-news-digest)';

/** fetch with a timeout and human-readable failures; one call per topic feed. */
export function makeFetchText(timeoutMs: number): FetchText {
  return async (url) => {
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw classifyFetchError(err, { url, timeoutMs });
    }
    if (!response.ok) {
      throw new CliError('network', `RSS fetch failed: HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  };
}

export function makeTranslate(deeplAuthKey: string | undefined): Translate | undefined {
  if (!deeplAuthKey) return undefined;
  return (texts, targetLang) => translateDeepL(texts, deeplAuthKey, targetLang);
}
