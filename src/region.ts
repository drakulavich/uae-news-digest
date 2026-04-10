export type RegionPreset = {
  q: string;
  hl: string;
  gl: string;
  ceid: string;
  flag: string;
  name: string;
};

export const REGION_PRESETS: Record<string, RegionPreset> = {
  uae: { q: 'UAE OR "Abu Dhabi" OR Dubai', hl: 'en', gl: 'AE', ceid: 'AE:en', flag: '🇦🇪', name: 'UAE' },
  us:  { q: 'USA OR "United States"', hl: 'en', gl: 'US', ceid: 'US:en', flag: '🇺🇸', name: 'US' },
  uk:  { q: 'UK OR "United Kingdom" OR London', hl: 'en', gl: 'GB', ceid: 'GB:en', flag: '🇬🇧', name: 'UK' },
  de:  { q: 'Deutschland OR Berlin OR München', hl: 'de', gl: 'DE', ceid: 'DE:de', flag: '🇩🇪', name: 'Germany' },
  ru:  { q: 'Россия OR Москва', hl: 'ru', gl: 'RU', ceid: 'RU:ru', flag: '🇷🇺', name: 'Russia' },
};

export function buildRssUrl(region: string): string {
  const preset = REGION_PRESETS[region.toLowerCase()];
  if (!preset) {
    const available = Object.keys(REGION_PRESETS).join(', ');
    throw new Error(`Unknown region "${region}". Available: ${available}`);
  }
  const q = encodeURIComponent(preset.q);
  return `https://news.google.com/rss/search?q=${q}&hl=${preset.hl}&gl=${preset.gl}&ceid=${preset.ceid}`;
}
