import { describe, expect, test } from 'bun:test';
import { renderText } from '../../src/output/text';
import type { DigestItem } from '../../src/pipeline/select';
import { DEFAULT_CONFIG } from '../../src/config/load';
import type { DigestResult } from '../../src/pipeline/run';
import type { DigestConfig } from '../../src/config/schema';
import { parseConfig } from '../../src/config/schema';

const LOCALE = { hl: 'en', gl: 'AE', ceid: 'AE:en' };

function cfg(extra: Record<string, unknown> = {}): DigestConfig {
  const { locale: _l, display: _d, topics: _t, ...heuristics } = DEFAULT_CONFIG;
  return parseConfig({
    locale: LOCALE,
    display: { flag: '🇦🇪', name: 'UAE', timezone: 'Asia/Dubai' },
    topics: [
      { slug: 'economy', name: 'Economy', emoji: '💰', query: 'q' },
      { slug: 'realty', name: 'Realty', query: 'q' },
    ],
    ...heuristics,
    ...extra,
  }, 'test');
}

function item(over: Partial<DigestItem>): DigestItem {
  return {
    score: 1, importance: 0, signals: [], tier: 'neutral',
    publishedAt: new Date('2026-05-22T09:00:00Z'),
    title: 'Title', source: 'Reuters', key: over.title ?? 'k', matchedTerms: [],
    ...over,
  };
}

function result(config: DigestConfig, itemsBySlug: Record<string, DigestItem[]>, warnings: string[] = []): DigestResult {
  return {
    sections: config.topics.map((topic) => ({ topic, items: itemsBySlug[topic.slug] ?? [] })),
    warnings,
    nextSeenKeys: new Set(),
    fetchedTopics: config.topics.length,
  };
}

describe('renderText', () => {
  const now = new Date('2026-05-22T10:00:00Z');

  test('header uses display flag, name, and local date', () => {
    const c = cfg();
    const out = renderText(result(c, {}), c, new Date('2026-05-22T21:30:00Z')); // 01:30 next day in Dubai
    expect(out.startsWith('🇦🇪 UAE digest — 2026-05-23\n\n')).toBe(true);
  });

  test('renders sections in config order with emoji or bullet headings and item lines', () => {
    const c = cfg();
    const out = renderText(result(c, {
      economy: [item({ title: 'GDP up', publishedAt: new Date('2026-05-22T09:00:00Z') })],
      realty: [item({ title: 'Emaar tower sold', source: 'Arabian Business', publishedAt: new Date('2026-05-22T08:00:00Z') })],
    }), c, now);
    expect(out).toBe([
      '🇦🇪 UAE digest — 2026-05-22',
      '',
      '💰 Economy',
      '  • GDP up (Reuters, 1h ago)',
      '',
      '• Realty',
      '  • Emaar tower sold (Arabian Business, 2h ago)',
    ].join('\n'));
  });

  test('empty section prints "(no new items)"', () => {
    const c = cfg();
    expect(renderText(result(c, {}), c, now)).toContain('💰 Economy\n  (no new items)');
  });

  test('promotes important items into a top block tagged with the topic, and shows the all-promoted placeholder', () => {
    const c = cfg();
    const out = renderText(result(c, {
      economy: [item({ title: 'Missile intercepted over Abu Dhabi airspace', importance: 8, signals: ['missile', 'airspace'], tier: 'breaking' })],
    }), c, now);
    // "airspace" matches the ✈️ rule before "missile" reaches the 🛡️ rule (first matching rule wins).
    expect(out).toContain('🚨 Important\n  ✈️ Missile intercepted over Abu Dhabi airspace (Reuters, 1h ago) [missile, airspace] — Economy\n');
    expect(out).toContain('💰 Economy\n  (all items are in 🚨 Important)');
    expect(out.split('Missile intercepted').length - 1).toBe(1);
  });

  test('signal markers never leak into regular body lines (below-threshold item with signals)', () => {
    const c = cfg();
    const out = renderText(result(c, {
      // fluff: carries signals but stays under the threshold, so it renders in the body
      economy: [item({ title: 'Dubai hotel launches AI concierge', importance: -3, tier: 'fluff', signals: ['launches'] })],
    }), c, now);
    expect(out).not.toContain('🚨 Important');
    expect(out).toContain('Dubai hotel launches AI concierge');
    expect(out).not.toContain('[launches');
  });

  test('uses translatedTitle when present and the config emoji rules for the marker', () => {
    const c = cfg();
    const out = renderText(result(c, { economy: [item({ title: 'Heavy rain expected', translatedTitle: 'Ожидается сильный дождь' })] }), c, now);
    expect(out).toContain('  🌧️ Ожидается сильный дождь (Reuters, 1h ago)');
    expect(out).not.toContain('Heavy rain expected');
  });

  test('no importance config means no Important block and bullet emoji', () => {
    const c = parseConfig({ locale: LOCALE, topics: [{ slug: 'a', name: 'A', query: 'q' }] }, 'test');
    const out = renderText(result(c, { a: [item({ title: 'Missile intercepted', importance: 8, tier: 'breaking', signals: ['missile'] })] }), c, now);
    expect(out).not.toContain('🚨 Important');
    expect(out).toContain('• A\n  • Missile intercepted (Reuters, 1h ago)');
    expect(out.startsWith('🌐 News digest — ')).toBe(true);
  });
});
