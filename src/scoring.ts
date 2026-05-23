const TIER_1_RE = /(reuters|\bap news\b|associated press|bbc|new york times|nytimes|washington post|the economist|financial times|\bft\.com\b|bloomberg|wall street journal|\bwsj\b|the guardian)/i;
const TIER_2_RE = /(al jazeera|deutsche welle|\bdw\.com\b|france 24|france24|cnbc|cnn|anadolu)/i;
const TIER_3_RE = /(gulf news|khaleej times|the national|zawya)/i;

const UAE_RE = /(UAE|Dubai|Abu Dhabi|Sharjah|Ras al-Khaimah|Fujairah)/i;
const PRIORITY_RE = /(weather|rain|missile|drone|airspace|defence|defense|property|market|flight|shipping|Hezbollah|Iran|airport|Hormuz)/i;

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

function extractWords(title: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'it', 'its', 'by', 'from', 'with', 'as', 'after', 'that', 'this', 'new', 'amid', '_skip']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .map(w => SYNONYMS[w] ?? w)
    .filter(w => w.length > 1 && !stop.has(w));
}

export function titleSimilarity(a: string, b: string): number {
  const wa = new Set(extractWords(a));
  const wb = new Set(extractWords(b));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}

export { TIER_1_RE, TIER_2_RE, TIER_3_RE };

export function scoreItem(title: string, source: string): number {
  let score = 0;
  if (TIER_1_RE.test(source)) score += 5;
  else if (TIER_2_RE.test(source)) score += 3;
  else if (TIER_3_RE.test(source)) score += 2;
  if (UAE_RE.test(title)) score += 2;
  if (PRIORITY_RE.test(title)) score += 2;
  return score;
}
