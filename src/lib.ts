import { XMLParser } from 'fast-xml-parser';

export const DEFAULT_RSS_URL = 'https://news.google.com/rss/search?q=UAE+OR+%22Abu+Dhabi%22+OR+Dubai&hl=en&gl=AE&ceid=AE:en';
export const DEFAULT_STATE_FILE = './seen_titles.txt';
export const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

const DEFAULT_SKIP_RE = /(opinion|daily mail|travel and tour world|tradingview|cycling|horse|football|msn|substack|influencer|hotel room|fitness journey|baskin-robbins)/i;
const DEFAULT_PREFER_RE = /(reuters|the national|gulf news|khaleej times|cnbc|ap news|bbc|anadolu|zawya)/i;
const UAE_RE = /(UAE|Dubai|Abu Dhabi|Sharjah|Ras al-Khaimah|Fujairah)/i;
const PRIORITY_RE = /(weather|rain|missile|drone|airspace|defence|defense|property|market|flight|shipping|Hezbollah|Iran|airport|Hormuz)/i;

/** Similarity threshold for fuzzy dedup (0–1). Titles above this are considered the same story. */
const FUZZY_SIMILARITY_THRESHOLD = 0.45;

export type RssItem = {
  title: string;
  pubDate?: string;
  source?: string;
};

export type DigestItem = {
  score: number;
  publishedAt: Date;
  title: string;
  source: string;
  key: string;
};

export type BuildDigestOptions = {
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  skipRe?: RegExp;
  preferRe?: RegExp;
};

export type RunDigestOptions = {
  xml: string;
  seenKeys: Set<string>;
  hours: number;
  limit: number;
  now?: Date;
  translate?: boolean;
  deeplAuthKey?: string;
  targetLang?: string;
  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;
};

// ── Normalization ──────────────────────────────────────────────

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(title: string): string {
  return normalizeWhitespace(title.replace(/\s+-\s+[^-]+$/, '').trim());
}

export function normalizeSource(source?: string): string {
  return normalizeWhitespace(source ?? '');
}

export function makeKey(title: string, source?: string): string {
  return `${normalizeTitle(title).toLowerCase()} || ${normalizeSource(source).toLowerCase()}`;
}

// ── Fuzzy dedup ────────────────────────────────────────────────

/** Synonym map to normalize vocabulary before comparison. */
const SYNONYMS: Record<string, string> = {
  drone: 'uav', drones: 'uav', uavs: 'uav', uav: 'uav',
  intercept: 'engage', intercepted: 'engage', intercepts: 'engage', engage: 'engage', engaged: 'engage', engages: 'engage',
  missile: 'missile', missiles: 'missile', ballistic: 'missile',
  defence: 'defense', defences: 'defense', defenses: 'defense', defense: 'defense',
  iranian: 'iran', iran: 'iran',
  airport: 'airport', airspace: 'airport', flights: 'flight', flight: 'flight',
  property: 'realestate', housing: 'realestate', realestate: 'realestate',
  rain: 'weather', weather: 'weather', flooding: 'weather', flood: 'weather',
  shipping: 'shipping', hormuz: 'shipping',
  school: 'education', schools: 'education', education: 'education',
  says: '_skip', said: '_skip', report: '_skip', reports: '_skip',
};

/** Extract significant words from a title for comparison, normalizing synonyms. */
function extractWords(title: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'it', 'its', 'by', 'from', 'with', 'as', 'after', 'that', 'this', 'new', 'amid', '_skip']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map(w => SYNONYMS[w] ?? w)
    .filter(w => w.length > 1 && !stop.has(w));
}

/** Jaccard similarity of two word sets (0–1). */
export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(extractWords(a));
  const wb = new Set(extractWords(b));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}

// ── Date / validation ──────────────────────────────────────────

export function parsePubDate(pubDate: string | undefined, now = new Date()): Date {
  if (!pubDate) return now;
  const parsed = new Date(pubDate);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

export function validatePositiveNumber(name: string, raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --${name}: ${raw}`);
  }
  return value;
}

// ── RSS parsing ────────────────────────────────────────────────

export function parseRss(xml: string): RssItem[] {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(xml) as any;
  const rawItems = parsed?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items.map((item: any) => ({
    title: normalizeWhitespace(String(item.title ?? '')),
    pubDate: item.pubDate ? String(item.pubDate) : undefined,
    source: typeof item.source === 'string'
      ? item.source
      : item.source?.['#text']
        ? String(item.source['#text'])
        : undefined,
  }));
}

// ── Scoring ────────────────────────────────────────────────────

export function scoreItem(title: string, source: string, preferRe = DEFAULT_PREFER_RE): number {
  let score = 0;
  if (preferRe.test(source)) score += 3;
  if (UAE_RE.test(title)) score += 2;
  if (PRIORITY_RE.test(title)) score += 2;
  return score;
}

// ── Digest builder ─────────────────────────────────────────────

export function buildDigest(items: RssItem[], options: BuildDigestOptions): DigestItem[] {
  const { seenKeys, hours, limit, now = new Date(), skipRe = DEFAULT_SKIP_RE, preferRe = DEFAULT_PREFER_RE } = options;
  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const unique = new Map<string, DigestItem>();

  for (const item of items) {
    const title = normalizeTitle(item.title);
    const source = normalizeSource(item.source);
    if (!title) continue;
    if (skipRe.test(title) || skipRe.test(source)) continue;

    const publishedAt = parsePubDate(item.pubDate, now);
    if (publishedAt < cutoff) continue;

    const key = makeKey(title, source);
    if (seenKeys.has(key)) continue;

    const digestItem: DigestItem = {
      score: scoreItem(title, source, preferRe),
      publishedAt,
      title,
      source,
      key,
    };

    // Exact key dedup
    const existing = unique.get(key);
    if (existing) {
      const replace = digestItem.score > existing.score || (digestItem.score === existing.score && digestItem.publishedAt > existing.publishedAt);
      if (replace) unique.set(key, digestItem);
      continue;
    }

    // Fuzzy dedup: check if a similar title already exists from a different source
    let fuzzyDup = false;
    for (const [existingKey, existingItem] of unique) {
      if (titleSimilarity(title, existingItem.title) >= FUZZY_SIMILARITY_THRESHOLD) {
        // Keep the higher-scored version
        if (digestItem.score > existingItem.score || (digestItem.score === existingItem.score && digestItem.publishedAt > existingItem.publishedAt)) {
          unique.delete(existingKey);
          unique.set(key, digestItem);
        }
        fuzzyDup = true;
        break;
      }
    }

    if (!fuzzyDup) {
      unique.set(key, digestItem);
    }
  }

  return [...unique.values()]
    .sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime() || a.title.localeCompare(b.title))
    .slice(0, limit);
}

// ── Emoji ──────────────────────────────────────────────────────

export function emojiFor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('rain') || t.includes('weather') || t.includes('погода') || t.includes('дожд')) return '🌧️';
  if (t.includes('property') || t.includes('market') || t.includes('недвижимост') || t.includes('рынок')) return '📉';
  if (t.includes('flight') || t.includes('airspace') || t.includes('airport') || t.includes('рейс') || t.includes('аэропорт') || t.includes('воздушн')) return '✈️';
  if (t.includes('missile') || t.includes('drone') || t.includes('defence') || t.includes('defense') || t.includes('air attack') || t.includes('ракет') || t.includes('бпла') || t.includes('пво')) return '🛡️';
  if (t.includes('shipping') || t.includes('hormuz') || t.includes('судоход') || t.includes('ормуз')) return '⛴️';
  if (t.includes('hezbollah') || t.includes('terror') || t.includes('хезболла') || t.includes('террор')) return '🚨';
  if (t.includes('school') || t.includes('education') || t.includes('школ') || t.includes('образован')) return '🎓';
  if (t.includes('oil') || t.includes('gas') || t.includes('нефт') || t.includes('газ')) return '🛢️';
  if (t.includes('visa') || t.includes('виз')) return '🛂';
  return '•';
}

// ── DeepL Translation ──────────────────────────────────────────

export type DeepLTranslation = {
  detected_source_language: string;
  text: string;
};

export type DeepLResponse = {
  translations: DeepLTranslation[];
};

/**
 * Batch-translate texts to Russian via DeepL Free API.
 * Returns translated texts in the same order, or null on any failure.
 */
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

    if (response.status === 429) {
      // Rate limited — fall back silently
      return null;
    }

    if (response.status === 456) {
      // Quota exceeded
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as DeepLResponse;

    if (!data.translations || data.translations.length !== texts.length) {
      return null;
    }

    return data.translations.map((t) => t.text);
  } catch {
    // Network error, timeout, parse error — fall back silently
    return null;
  }
}

// ── Keyword Fallback Translation ───────────────────────────────

const REPLACEMENTS: Array<[RegExp, string]> = [
  // ── Places ──
  [/\bUAE\b/gi, 'ОАЭ'],
  [/\bUnited Arab Emirates\b/gi, 'ОАЭ'],
  [/\bAbu Dhabi\b/gi, 'Абу-Даби'],
  [/\bDubai\b/gi, 'Дубай'],
  [/\bSharjah\b/gi, 'Шарджа'],
  [/\bRas al-Khaimah\b/gi, 'Рас-эль-Хайма'],
  [/\bFujairah\b/gi, 'Фуджейра'],
  [/\bAjman\b/gi, 'Аджман'],
  [/\bSaudi Arabia\b/gi, 'Саудовская Аравия'],
  [/\bIran\b/gi, 'Иран'],
  [/\bIsrael\b/gi, 'Израиль'],
  [/\bMiddle East\b/gi, 'Ближний Восток'],
  [/\bStrait of Hormuz\b/gi, 'Ормузский пролив'],
  [/\bGCC\b/g, 'ССАГПЗ'],
  [/\bGulf\b/gi, 'Залив'],

  // ── People / titles ──
  [/\bSheikh\b/gi, 'Шейх'],
  [/\bPresident\b/gi, 'Президент'],
  [/\bPrime Minister\b/gi, 'Премьер-министр'],
  [/\bCrown Prince\b/gi, 'Наследный принц'],
  [/\bTop official\b/gi, 'Высокопоставленный чиновник'],
  [/\btop official\b/gi, 'высокопоставленный чиновник'],

  // ── Military / security ──
  [/\bair defences?\b/gi, 'ПВО'],
  [/\bair defenses?\b/gi, 'ПВО'],
  [/\bballistic missiles?\b/gi, 'баллистические ракеты'],
  [/\bmissiles?\b/gi, 'ракеты'],
  [/\bdrones?\b/gi, 'БПЛА'],
  [/\bUAVs?\b/gi, 'БПЛА'],
  [/\bintercepted\b/gi, 'перехватили'],
  [/\bengage[ds]?\b/gi, 'перехватили'],
  [/\bair attack\b/gi, 'воздушная атака'],
  [/\bair strikes?\b/gi, 'авиаудары'],
  [/\bsanctions?\b/gi, 'санкции'],
  [/\bthreat\b/gi, 'угроза'],
  [/\bterrorist network\b/gi, 'террористическая сеть'],
  [/\bterrorist\b/gi, 'террорист'],
  [/\bHezbollah\b/gi, 'Хезболла'],
  [/\bfunded by\b/gi, 'финансируемый'],

  // ── Real estate / economy ──
  [/\bproperty sector\b/gi, 'рынок недвижимости'],
  [/\bproperty market\b/gi, 'рынок недвижимости'],
  [/\bproperty prices?\b/gi, 'цены на недвижимость'],
  [/\bproperty\b/gi, 'недвижимость'],
  [/\breal estate\b/gi, 'недвижимость'],
  [/\bhousing\b/gi, 'жильё'],
  [/\brent(?:al)?s?\b/gi, 'аренда'],
  [/\bmarket\b/gi, 'рынок'],
  [/\beconomy\b/gi, 'экономика'],
  [/\binvestment\b/gi, 'инвестиции'],
  [/\binvestors?\b/gi, 'инвесторы'],
  [/\bgrowth\b/gi, 'рост'],
  [/\binflation\b/gi, 'инфляция'],
  [/\boil prices?\b/gi, 'цены на нефть'],
  [/\boil\b/gi, 'нефть'],
  [/\bstock\b/gi, 'акции'],
  [/\btrade\b/gi, 'торговля'],
  [/\bexports?\b/gi, 'экспорт'],
  [/\bimports?\b/gi, 'импорт'],
  [/\bGDP\b/g, 'ВВП'],

  // ── Transport / aviation ──
  [/\bairspace\b/gi, 'воздушное пространство'],
  [/\bairport\b/gi, 'аэропорт'],
  [/\bflight status\b/gi, 'статус рейсов'],
  [/\bflights?\b/gi, 'рейсы'],
  [/\bpassengers?\b/gi, 'пассажиры'],
  [/\bshipping\b/gi, 'судоходство'],
  [/\broads?\b/gi, 'дороги'],
  [/\btraffic\b/gi, 'движение'],
  [/\bmetro\b/gi, 'метро'],

  // ── Weather ──
  [/\bheavy rain\b/gi, 'сильный дождь'],
  [/\brain\b/gi, 'дождь'],
  [/\bflooding\b/gi, 'наводнение'],
  [/\bflood\b/gi, 'наводнение'],
  [/\bweather\b/gi, 'погода'],
  [/\bunstable\b/gi, 'нестабильная'],
  [/\btemperature\b/gi, 'температура'],
  [/\bheatwave\b/gi, 'аномальная жара'],
  [/\bsandstorm\b/gi, 'песчаная буря'],
  [/\bdust storm\b/gi, 'пылевая буря'],
  [/\bfog\b/gi, 'туман'],

  // ── Law / governance ──
  [/\bgovernment\b/gi, 'правительство'],
  [/\blaw\b/gi, 'закон'],
  [/\bregulation\b/gi, 'регулирование'],
  [/\bresident(?:s)?\b/gi, 'резиденты'],
  [/\bexpat(?:riate)?s?\b/gi, 'экспаты'],
  [/\bcitizens?\b/gi, 'граждане'],
  [/\bvisa\b/gi, 'виза'],
  [/\bgolden visa\b/gi, 'золотая виза'],
  [/\btravel advisory\b/gi, 'предупреждение для путешественников'],
  [/\bfines?\b/gi, 'штрафы'],

  // ── Education / social ──
  [/\bschools?\b/gi, 'школы'],
  [/\beducation\b/gi, 'образование'],
  [/\bstudents?\b/gi, 'ученики'],
  [/\buniversit(?:y|ies)\b/gi, 'университет'],
  [/\bhospitals?\b/gi, 'больницы'],
  [/\bworkers?\b/gi, 'рабочие'],
  [/\bfirms?\b/gi, 'компании'],
  [/\bcompan(?:y|ies)\b/gi, 'компании'],
  [/\bbusinesses?\b/gi, 'бизнес'],
  [/\bjobs?\b/gi, 'рабочие места'],
  [/\bsalaries\b/gi, 'зарплаты'],
  [/\bsalary\b/gi, 'зарплата'],

  // ── Verbs / phrases ──
  [/\bshows early signs of weakness\b/gi, 'показывает первые признаки слабости'],
  [/\breopens?\b/gi, 'открывают'],
  [/\bcloses?\b/gi, 'закрывают'],
  [/\blaunches?\b/gi, 'запускают'],
  [/\bannounces?\b/gi, 'объявляют'],
  [/\breports?\b/gi, 'сообщают'],
  [/\burges?\b/gi, 'призывают'],
  [/\bwarns?\b/gi, 'предупреждают'],
  [/\bplans?\b/gi, 'планируют'],
  [/\bapplies to\b/gi, 'подаёт заявку на'],
  [/\bapproves?\b/gi, 'одобряют'],
  [/\bbans?\b/gi, 'запрещают'],
  [/\bsays\b/gi, 'заявляет'],
  [/\bsaid\b/gi, 'заявил'],
  [/\bnew\b/gi, 'новый'],
  [/\bafter\b/gi, 'после'],
  [/\bbefore\b/gi, 'до'],
  [/\bprotect\b/gi, 'защитить'],
  [/\bsafeguard\b/gi, 'обеспечить безопасность'],
  [/\bhigh praise\b/gi, 'высокую оценку'],
  [/\bresponse\b/gi, 'реагирование'],
  [/\b(?:got|received)\b/gi, 'получило'],
  [/\bexplains? why\b/gi, 'объясняет почему'],
  [/\bcome[s]? first\b/gi, 'на первом месте'],
  [/\b'People come first'\b/gi, '«Люди на первом месте»'],
  [/\bSee\b/, 'Смотрите'],

  // ── Connectors ──
  [/\bas\b/gi, 'когда'],
  [/\bamid\b/gi, 'на фоне'],
  [/\bfrom\b/gi, 'из'],
  [/\bhits?\b/gi, 'обрушивается'],
  [/\bdrives through\b/gi, 'проезжает по'],
  [/\bdesert outskirts\b/gi, 'окрестностям пустыни'],
  [/\bin the\b/gi, 'под'],
  [/\bsome\b/gi, 'некоторых'],
  [/\bfor\b/gi, 'для'],
  [/\bwhy\b/gi, 'почему'],
  [/\bhow\b/gi, 'как'],
  [/\bto\b/gi, 'чтобы'],
  [/\bat\b/gi, 'на'],
  [/\bon\b/gi, 'на'],
  [/\bwith\b/gi, 'с'],
  [/\band\b/gi, 'и'],
  [/\bbut\b/gi, 'но'],
];

/** Keyword-based fallback translation (no API needed). */
export function translateTitleRu(title: string): string {
  let output = title;
  for (const [pattern, replacement] of REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  output = output.replace(/\s+-\s+/g, ' — ');
  output = output.replace(/\s{2,}/g, ' ').trim();
  return output;
}

// ── Render ─────────────────────────────────────────────────────

/**
 * Render digest to text.
 * @param items Digest items
 * @param translations Optional map of original title → translated title (from DeepL).
 *   If provided, uses DeepL translations; missing entries fall back to keyword translation.
 */
export function renderDigest(items: DigestItem[], translations?: Map<string, string>, targetLang: string = 'RU'): string {
  if (items.length === 0) {
    return '🇦🇪 UAE Latest News Digest\n\n• No significant news in the check window.';
  }

  const lines = ['🇦🇪 UAE Latest News Digest', ''];
  for (const item of items) {
    const translated = translations?.get(item.title)
      ?? (targetLang === 'RU' ? translateTitleRu(item.title) : item.title);
    lines.push(`${emojiFor(item.title)} ${translated} (${item.source})`);
  }
  return lines.join('\n');
}

export function mergeSeenKeys(seenKeys: Set<string>, digest: DigestItem[]): Set<string> {
  return new Set([...seenKeys, ...digest.map((item) => item.key)]);
}

/**
 * Run the full digest pipeline: parse → filter → translate → render.
 * Now async to support DeepL translation.
 */
export async function runDigest(options: RunDigestOptions): Promise<{ digest: DigestItem[]; output: string; nextSeenKeys: Set<string> }> {
  const items = parseRss(options.xml);
  const digest = buildDigest(items, {
    seenKeys: options.seenKeys,
    hours: options.hours,
    limit: options.limit,
    now: options.now,
  });

  let translations: Map<string, string> | undefined;

  // Attempt DeepL translation if enabled and key is available
  const shouldTranslate = options.translate !== false;
  if (shouldTranslate && options.deeplAuthKey && digest.length > 0) {
    const titles = digest.map((d) => d.title);
    const targetLang = options.targetLang ?? 'RU';
    const translated = await translateDeepL(titles, options.deeplAuthKey, targetLang, options.fetchFn);
    if (translated) {
      translations = new Map();
      for (let i = 0; i < titles.length; i++) {
        translations.set(titles[i]!, translated[i]!);
      }
    }
    // If translateDeepL returned null, translations stays undefined → keyword fallback
  }

  return {
    digest,
    output: renderDigest(digest, translations, options.targetLang ?? 'RU'),
    nextSeenKeys: mergeSeenKeys(options.seenKeys, digest),
  };
}

// ── State file I/O ─────────────────────────────────────────────

export async function readSeenKeys(stateFile: string): Promise<Set<string>> {
  const file = Bun.file(stateFile);
  if (!(await file.exists())) return new Set();
  const text = await file.text();
  return new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

export async function writeSeenKeys(stateFile: string, seenKeys: Set<string>): Promise<void> {
  await Bun.write(stateFile, `${[...seenKeys].sort().join('\n')}\n`);
}
