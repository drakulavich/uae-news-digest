# Signal Filter — Design

**Date:** 2026-06-01
**Status:** Approved (pending implementation plan)

## Problem

The digest currently surfaces too much noise. Two concrete pains:

1. **Keyword imprecision.** Google News RSS treats a query loosely and returns
   articles that match only some of the keywords. The tool has no control over
   how many query terms actually appear in a result.
2. **Signal vs noise.** The output mixes high-impact news (threats, money,
   rules/visas, logistics) with PR fluff ("Dubai unveils world's tallest…",
   railway-launch puff pieces). Importance is currently judged by a single
   coarse regex (`PRIORITY_RE`), and fluff is not penalized at all.

The user wants the tool to **filter noise and surface signal** — only what
materially affects the life of an expat family in the UAE.

## Goal

Surface, at the top of every digest, a `🚨 Important` section
containing only items that materially affect a UAE expat family across four
impact categories:

- **Safety / threats** — war, missiles/drones, airspace or airport closures,
  evacuations, weather emergencies (floods, storms), attacks.
- **Money / daily life** — rent/housing prices, fuel, tariffs, taxes, banking,
  FX, inflation.
- **Rules / visas / documents** — visa & residency changes, laws, fines,
  driving rules, schools, healthcare.
- **Logistics / infrastructure** — flights, airports, road closures, outages
  (but **not** PR about "we launched something shiny").

## Non-Goals

- No embedded LLM API key or new runtime dependency (see Section 3).
- No `--signal-only` hard-filter mode in this iteration (YAGNI). The section
  approach is enough; a threshold flag is left as a future hook.
- No parsing of Google News boolean query syntax (fragile — see Section 2).

## Architecture Decision

A **separate `importance` dimension** layered on top of the existing scoring,
**not** a rewrite of `scoreItem`.

- The existing `score` keeps its job: source quality and dedup tie-breaking.
- A new, independent `importance` measure (plus a human-readable reason) drives
  the `🚨 Important` section.

This keeps "how good is the source" and "how important is this for the family"
as distinct, separately testable concerns and preserves backward compatibility.

Mechanism: **hybrid**. A deterministic heuristic runs in-tool and always works.
The "smart" pass is performed **externally by the agent** (the Claude session
the user is already in) consuming enriched JSON — no API key, no network call
from the tool itself.

```
RSS (Google News)
  → parseRss → RssItem[]
  → match post-filter (Section 2, optional)
  → buildDigest (existing dedup/window/limit)
  → scoreImportance (Section 1) → importance + signals + tier
  → render: 🚨 Important section on top (Section 4)
  → --json: enriched output for an external agent to refine (Section 3)
```

---

## Section 1 — Importance layer (`src/importance.ts`)

Pure function, no side effects, trivially unit-testable:

```ts
scoreImportance(title: string, source: string): {
  importance: number;
  signals: string[];          // which markers fired, e.g. ["airspace","breaking"]
  tier: "breaking" | "impact" | "neutral" | "fluff";
}
```

Three lexicons aligned to the four impact categories:

- **BREAKING** (highest weight): `breaking, urgent, evacuat, killed, attack,
  missile, drone, airspace closed, airport closed, banned, alert, warning,
  storm, flood, recall`.
- **IMPACT** (medium weight, by category):
  - money/daily: `rent, fees, tax, fuel, fine, salary, subsidy`
  - rules/visa: `visa, residency, law, permit, licence, school, insurance`
  - logistics: `flight, road closed, outage, metro`
- **FLUFF** (penalty, negative): `unveils, launches, celebrates, award, vision,
  milestone, world's first, world's tallest, world's largest, ranked,
  inaugurat, honoured, festival`.

`importance` = Σ(weighted hits) − fluff penalty. `tier` is derived from the
resulting bands. `signals` records which markers fired, for transparency,
rendering, and debugging.

Lexicons live as named, exported constants so they are easy to review and tune.

## Section 2 — Keyword post-filter

Do **not** parse the Google query (boolean `OR` queries would break under a
blind "all words" rule). Instead, give explicit control in the topic config:

```jsonc
{
  "slug": "schools",
  "query": "school fees Dubai",
  "match": ["school", "fees"],   // new, optional
  "matchMode": "all"             // "all" | "any" | <number N of M>; default "all"
}
```

Behavior:

- `match` absent → current behavior, nothing changes (backward compatible).
- `match` present → after `parseRss`, before scoring, drop an item whose title
  does not contain the required number of terms (case-insensitive, word-level
  normalization consistent with `extractWords`).
- Also available for the non-topical region digest via `--match` / `--match-mode`
  flags.

Lives in `digest.ts` as `BuildDigestOptions.match` / `.matchMode` so both
`runDigest` and `runTopicalDigest` reuse it. Items dropped by `match` are
**counted and reported** in `warnings` (e.g. "3 items dropped: missing
keywords") — no silent loss.

## Section 3 — Agent mode instead of an API key

No embedded LLM, no `ANTHROPIC_API_KEY`, no new dependency. The tool stays
deterministic; the "smart" pass is external and free.

Enrich the **existing `--json` output**. Each item carries:

- `importance` — number from the heuristic (Section 1)
- `signals` — markers that fired
- `tier` — `"breaking" | "impact" | "neutral" | "fluff"`
- `topic` / section provenance (which topic it came from)
- `matchedTerms` — which keywords actually matched (from Section 2)

The tool can also print a ready-made **filter prompt** (a `--prompt` flag,
and/or a documented snippet in the README) so the external pass is
reproducible. Reference criterion:

> "You are a news filter for an expat family in the UAE. Keep only what
> materially affects safety, money, rules/visas, or logistics. Drop PR,
> launches, awards, rankings, and 'world's first/tallest/largest'."

Flow:

```
uae-news-digest --json | <hand to Claude with the prompt> → agent drops noise → final digest
```

The hybrid is preserved exactly as chosen: the heuristic lives in the tool and
always runs (including the text `🚨 Important` section from Section 4); the LLM
pass is external, via the agent, with no keys. If the user never invokes an
agent, the heuristic digest still stands on its own.

## Section 4 — Rendering the `🚨 Important` section

- A `🚨 Important` block appears at the very top, before the normal sections/topics.
- It contains items with `importance ≥ IMPORTANCE_THRESHOLD` (heuristic).
- **Cross-topic**: in the topical digest, important items are gathered from
  **all** topics into the single top block (so a missile buried in the "real
  estate" topic is not missed). Each item is tagged with its source topic.
- **Dedup**: an item promoted into `🚨 Important` is **not** repeated in its normal
  section below.
- Next to each headline, a short reason marker — the heuristic `signals`
  (e.g. `[airspace]`) — rendered unobtrusively on one line.
- If there is nothing important, the block is not printed at all (no empty
  header).
- Threshold is a default constant `IMPORTANCE_THRESHOLD`, with a future
  `--min-importance N` flag hook. `--signal-only` is intentionally out of scope.

## Section 5 — Testing (per Dodds / Zakharchenko / Rossi)

Guiding principles:

- **Kent C. Dodds (Testing Trophy):** the more tests resemble real usage, the
  more confidence. Center of gravity is **integration tests** through the real
  pipeline and the CLI binary, asserting on what the user sees (text digest +
  JSON), not on internal function returns. No testing of implementation details.
- **Artem Zakharchenko (MSW):** test at the boundary with the outside world; do
  not mock our own modules. RSS is fed through the existing fixture seam
  (`UAE_NEWS_DIGEST_TOPIC_FIXTURE`) — the tool's natural network boundary.
  `parseRss` / `scoreImportance` / render run for real.
- **Luca Rossi (pragmatism / ROI, refactor-resistant):** don't over-unit-test;
  assert **behavior, not magic numbers**, so re-tuning weights does not break
  tests.

**Integration (bulk):** one RSS fixture with a realistic mix (missile + rent
spike + "world's tallest" PR build + off-topic) → run real
`runTopicalDigest` / `runDigest` → assert observable outcomes:

- breaking/impact items surface in the `🚨` block;
- the PR build is demoted / absent;
- `match` drops off-keyword items and emits the warning;
- JSON carries `importance` / `signals` / `tier` / `matchedTerms` / provenance;
- cross-topic: an important item from "real estate" rises to the top block and
  is not duplicated below.

**CLI level (`cli.test.ts`):** invoke the real binary with the fixture +
`UAE_NEWS_DIGEST_NOW`, assert on stdout — closest to real use.

**Thin unit layer:** only `scoreImportance` — assert `tier` / relative ordering /
presence of `signals`, **without exact scores** (re-tuning weights must not
break tests).

**Boundary & determinism:** external RSS via fixture, no network, no mocking of
internal modules; time via `UAE_NEWS_DIGEST_NOW`.

**Gates:** `bun test` green + `bun run typecheck`.

## Files Touched

- `src/importance.ts` — **new**: `scoreImportance`, lexicons, `IMPORTANCE_THRESHOLD`.
- `src/digest.ts` — add `match` / `matchMode` post-filter; attach importance to items.
- `src/topics.ts` — parse/validate optional `match` / `matchMode` on a topic.
- `src/pipeline.ts` — thread match + importance through both digest flows;
  collect cross-topic important items; surface dropped-item warnings.
- `src/render.ts` — render the `🚨 Important` block and per-item signal markers.
- `src/index.ts` — `--match` / `--match-mode` / `--prompt` flags; enrich `--json`.
- `test/unit/importance.test.ts` — **new**.
- `test/unit/digest.test.ts` — `match` cases.
- `test/integration/` — mixed-fixture signal/noise + cross-topic + JSON shape.
- `test/cli.test.ts` — end-to-end stdout assertions.

## Open Questions

None blocking. Exact lexicon contents and `IMPORTANCE_THRESHOLD` band values are
tuning details to settle during implementation against the test fixture.
