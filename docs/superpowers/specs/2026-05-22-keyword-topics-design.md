# Keyword Topics

## Problem

The current digest is a single Google News query per region (`UAE OR "Abu Dhabi" OR Dubai`). The output is a liquid mix of everything UAE — politics, sports, culture, business — with no way to focus on the signals a specific reader cares about.

Concrete user need: get separate per-topic digests in one run — for example UAE **economy**, **real estate**, and the **Iran conflict as it affects the UAE** — instead of one undifferentiated list.

## Design

### One run, sections per topic

A single CLI invocation produces one output containing N labelled sections, one per topic. Each topic is its own Google News query, fetched in parallel, run through the existing `runDigest` pipeline, then rendered as a section under a topic heading.

The mode activates automatically when a topics config file is found; otherwise the CLI behaves exactly as today.

### Topics config (JSON)

JSON, not TOML — Bun reads JSON natively via `Bun.file().json()` (zero new dependency).

Resolution order (first hit wins):

1. `--topics-config <path>` (explicit override)
2. `./digest.config.json` (cwd; for project-local configs in dotfiles or repos)
3. `$XDG_CONFIG_HOME/uae-news-digest/topics.json` (falls back to `~/.config/uae-news-digest/topics.json`)

Example file:

```json
{
  "locale": { "hl": "en", "gl": "AE", "ceid": "AE:en" },
  "topics": [
    {
      "slug": "economy",
      "name": "Экономика ОАЭ",
      "emoji": "💰",
      "query": "(UAE OR Emirates) AND (economy OR GDP OR inflation OR \"central bank\" OR ADNOC OR non-oil)",
      "limit": 5
    },
    {
      "slug": "realty",
      "name": "Недвижимость",
      "emoji": "🏠",
      "query": "(Dubai OR \"Abu Dhabi\") AND (\"real estate\" OR property OR Emaar OR Aldar OR \"off-plan\" OR rent)",
      "limit": 4
    },
    {
      "slug": "iran",
      "name": "Иран → ОАЭ",
      "emoji": "⚠️",
      "query": "(Iran OR Tehran OR \"Strait of Hormuz\") AND (UAE OR Dubai OR Emirates OR oil OR shipping OR sanctions)",
      "limit": 4
    }
  ]
}
```

The query strings above are **starter examples**, not optimal queries. Users edit them.

Topic fields:

| field | required | purpose |
|---|---|---|
| `slug` | yes | id for JSON output and logs; must be unique within file |
| `name` | yes | section heading in text output |
| `emoji` | no | section prefix (mirrors region flags today) |
| `query` | yes | passed verbatim to Google News `q` param |
| `limit` | no, default 5 | per-topic cap on items |
| `locale` | no | overrides top-level locale for this topic only |

Top-level `locale` provides the default `{hl, gl, ceid}` for every topic. Default for the file as a whole is the existing UAE locale (`hl=en, gl=AE, ceid=AE:en`).

### Validation

Config load fails fast with a human-readable error including the file path:

- File parses as JSON.
- `topics` is a non-empty array.
- Every topic has non-empty `slug`, `name`, `query`.
- No duplicate `slug` values within the file.
- `limit`, when present, is a positive integer.

### Fetch strategy

Topics are fetched in parallel using `Promise.allSettled`. If one topic's fetch fails (timeout, HTTP error, parse error), the other sections still render and the failure is recorded in `warnings`. The whole command does not exit non-zero just because one topic broke — only if **all** topics fail.

Each topic is independently subject to `--timeout-ms`.

### Global dedup, first topic wins

Topics are processed in the order they appear in the config. Each topic's `runDigest` is given a `seenKeys` set that includes the persisted state file **plus** every key already chosen by earlier topics in this run.

Consequence: an article matching both `economy` and `iran` queries lands in `economy` (the earlier one), and `iran` simply does not see it. Users control priority by reordering the config.

Implementation: fetch all topic RSS in parallel (`Promise.allSettled`), then walk the parsed results sequentially in config order to apply dedup. Fetch is the slow part; dedup is in-memory and effectively free.

```ts
const fetched = await Promise.allSettled(
  config.topics.map((t) => fetchTopicRss(t)),
);

const seen = new Set(persistedSeenKeys);
const sections: Section[] = [];

for (const [i, topic] of config.topics.entries()) {
  const result = fetched[i];
  if (result.status === "rejected") {
    sections.push({ topic, items: [], error: result.reason });
    continue;
  }
  const items = buildDigest(parseRss(result.value), {
    seenKeys: seen,
    hours,
    limit: limitOverride ?? topic.limit,
  });
  for (const it of items) seen.add(it.key);
  sections.push({ topic, items });
}
```

### CLI flags in topics mode

| flag | behaviour |
|---|---|
| `--hours` | applies to all topics |
| `--limit` | when set, overrides every topic's `limit` |
| `--target-lang` | translates all sections; one DeepL batch over all titles together (cheaper than N batches) |
| `--region` | **ignored** with stderr warning — only when user passed it explicitly, not when commander supplied the `uae` default (use commander `getOptionValueSource` to distinguish) |
| `--rss-url` | **ignored** with stderr warning (no default; presence = explicit) |
| `--topics-config <path>` | **new**: explicit config path |
| `--no-topics` | **new**: force legacy region mode even if a config file exists |
| `--state-file`, `--dry-run`, `--json` | unchanged |

### Output

**Text mode** — sections in config order, each prefixed by emoji + name. Empty sections still print their heading with a placeholder so users can tell the topic is alive but quiet:

```
🇦🇪 UAE digest — 2026-05-22

💰 Экономика ОАЭ
  • [4h] Reuters — UAE central bank holds rates as Fed pauses
  • [9h] The National — Non-oil GDP growth accelerates in Q1

🏠 Недвижимость
  • [2h] Arabian Business — Emaar launches new off-plan tower in Dubai Marina

⚠️ Иран → ОАЭ
  (нет новых материалов)
```

**JSON mode** — extends the existing shape; the legacy `items` array stays sorted by topic order so old consumers keep working:

```json
{
  "tool": "uae-news-digest",
  "version": "...",
  "mode": "topics",
  "query": { "hours": 36, "targetLang": null },
  "topics": [
    { "slug": "economy", "name": "Экономика ОАЭ", "count": 2 },
    { "slug": "realty",  "name": "Недвижимость",  "count": 1 },
    { "slug": "iran",    "name": "Иран → ОАЭ",    "count": 0 }
  ],
  "count": 3,
  "warnings": [],
  "items": [
    { "topic": "economy", "title": "...", "source": "...", "score": 0, "publishedAt": "...", "hoursAgo": 4 }
  ]
}
```

`mode` is a new field: `"topics"` in topics mode, `"region"` in the legacy single-region mode. Old JSON consumers ignore the unknown field; new consumers can switch on it to decide whether to group by `item.topic`. In legacy mode the `topics` array is omitted entirely.

### Warnings

Stderr warnings (also surfaced in JSON `warnings`):

- `--region <X> ignored: topics config in use (<path>)`
- `--rss-url <X> ignored: topics config in use (<path>)`
- `Topic "<slug>" returned 0 items — check the query syntax` (only when the fetch succeeded but produced nothing; helps debug malformed queries Google silently truncates)
- `Topic "<slug>" failed: <message>` (one per failed topic in `Promise.allSettled`)
- The existing DeepL warning continues to work.

## Files Changed

| file | action | what |
|---|---|---|
| `src/topics.ts` | new | `loadTopicsConfig(path?)`, `resolveTopicsConfigPath()`, types `TopicConfig` / `TopicsConfig`, validation |
| `src/pipeline.ts` | modify | add `runTopicalDigest({ config, seenKeys, hours, limitOverride, deeplAuthKey, targetLang, now })`; reuses `runDigest` per topic; one batched DeepL call across all titles |
| `src/render.ts` | modify | add `renderTopicalDigest(sections, translations, now, locale)`; existing `renderDigest` untouched |
| `src/region.ts` | modify | overload `buildRssUrl` so it accepts either a region code (existing) or a raw `{q, hl, gl, ceid}` object (new) |
| `src/index.ts` | modify | resolve topics config (3-path lookup), branch to `runTopicalDigest` vs `runDigest`; add `--topics-config` and `--no-topics`; warnings for `--region` / `--rss-url` in topics mode; add `mode` field to JSON output |
| `src/lib.ts` | modify | re-export topics types and `loadTopicsConfig` |
| `src/core.ts` | modify | re-export topics types and `loadTopicsConfig` for the public API |
| `test/unit/topics.test.ts` | new | config load: valid file, missing file, malformed JSON, missing required field, duplicate slug, non-positive limit, locale inheritance |
| `test/integration/topical-digest.test.ts` | new | three topics over fixture RSS bodies; verifies section order, global dedup (article appears in earlier topic only), per-topic limits, empty-section placeholder, warning when one topic's fetch fails |
| `test/cli.test.ts` | modify | auto-detect config from cwd; `--no-topics` forces legacy mode; warning when `--region` is passed alongside a config; JSON output has `mode: "topics"` and `item.topic` |
| `test/fixtures/` | modify | add small per-topic RSS fixtures |
| `README.md` | modify | document topics config, flags, file resolution order |

## Out of Scope

- Per-topic state files (single global seen-set is sufficient).
- Relevance-scoring across topics (`first-in-config wins` is good enough; user controls priority by ordering).
- Hot reload or watch mode for the config file.
- Per-topic `skipRe`. Existing `DEFAULT_SKIP_RE` in `digest.ts` applies uniformly. Revisit if real usage shows topic-specific noise.
- A semaphore for concurrent fetches. Three or four parallel requests to Google News RSS is fine; bound it only if topic lists grow past ~10.
- TOML support. JSON keeps the code dependency-free.

## Risks

- **Google News silently truncates long boolean queries.** Mitigation: the "topic returned 0 items" warning lets users notice when their query is being mishandled instead of just seeing an empty section.
- **Starter queries in the example are illustrative**, not tuned. Users will iterate. Documented as such in the README.
- **Default `skipRe` may misfire on a niche topic** (e.g. an opinion piece about Iran sanctions that has real signal). Acceptable for now — fix forward if it bites.
