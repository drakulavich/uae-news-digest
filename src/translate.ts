export const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

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
): Promise<string[]> {
  if (texts.length === 0) return [];

  const url = process.env.DEEPL_API_URL ?? DEEPL_API_URL;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${authKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: texts, target_lang: targetLang }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DeepL request failed: ${msg}`);
  }

  if (response.status === 429) throw new Error('DeepL returned HTTP 429 (rate limited)');
  if (response.status === 456) throw new Error('DeepL returned HTTP 456 (quota exceeded)');
  if (!response.ok) throw new Error(`DeepL returned HTTP ${response.status} ${response.statusText}`);

  const data = (await response.json()) as DeepLResponse;
  const translations = data.translations ?? [];
  if (translations.length !== texts.length) {
    throw new Error(`DeepL returned ${translations.length} translations for ${texts.length} texts`);
  }
  return translations.map((t) => t.text);
}
