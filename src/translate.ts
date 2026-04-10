export const DEEPL_API_URL = process.env.DEEPL_API_URL ?? 'https://api-free.deepl.com/v2/translate';

export type DeepLTranslation = {
  detected_source_language: string;
  text: string;
};

export type DeepLResponse = {
  translations: DeepLTranslation[];
};

export async function translateDeepL(
  texts: string[],
  authKey: string,
  targetLang: string = 'RU',
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<string[] | null> {
  if (texts.length === 0) return [];

  try {
    const response = await fetchFn(DEEPL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${authKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        target_lang: targetLang,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 429 || response.status === 456 || !response.ok) {
      return null;
    }

    const data = (await response.json()) as DeepLResponse;

    if (!data.translations || data.translations.length !== texts.length) {
      return null;
    }

    return data.translations.map((t) => t.text);
  } catch {
    return null;
  }
}
