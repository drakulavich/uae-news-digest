## Context

The current Agent filter prompt is a separate `--prompt` output while the
Digest data comes from a different invocation. Sana must construct the shell
pipeline and choose a wide enough `--limit`; `--dry-run` is required to prevent
the Seen-item state from being updated before the external model has filtered
the Items. The model will call the CLI itself, so the public surface must be a
small, self-describing protocol rather than instructions for a human to compose
shell commands.

## Goals / Non-Goals

**Goals:**

- Give Sana one collection command that returns the candidate Digest, complete
  filtering criterion, and continuation data in JSON.
- Make 200 the default upper bound for agent candidates while accurately
  reporting the number of Items that Google News RSS actually supplied.
- Let Omar maintain persistent custom filtering rules and add scoped rules at
  invocation time.
- Prevent any Seen-item state mutation until Sana explicitly commits a completed
  filtering decision.
- Preserve Layla's existing default Digest and the existing `--prompt` output.

**Non-Goals:**

- The CLI does not call an LLM, require an API key, select a model, or parse an
  LLM response.
- The CLI does not guarantee 200 Items from one Google News RSS feed.
- This change does not alter the existing Digest ranking, Signal filter, Core
  API, or human-readable rendering. Version one deliberately excludes a
  Topics-mode agent result.
- This change does not add a UI for editing custom rules.

## Decisions

### Use an explicit `agent collect` / `agent commit` protocol

`agent collect` is a JSON-only command with a default candidate limit of 200.
It creates a short-lived run record and returns:

```json
{
  "runId": "…",
  "mode": "region",
  "query": { "hours": 168, "candidateLimit": 200 },
  "count": 1,
  "instructions": [
    { "source": "built-in", "text": "…" },
    { "source": "config", "text": "…" },
    { "source": "flag", "text": "…" }
  ],
  "items": [{
    "id": "…",
    "title": "…",
    "source": "…",
    "score": 9,
    "publishedAt": "…",
    "hoursAgo": 1,
    "importance": 2,
    "tier": "impact",
    "signals": ["flight"],
    "matchedTerms": [],
    "googleUrl": "…"
  }],
  "next": { "command": "agent commit", "runId": "…" }
}
```

Sana applies `instructions` to `items`, then invokes `agent commit --run-id …`
with zero or more `--keep` values. `count` is the number of post-selection
Items in `items`, after the lookback, Seen-item state, deduplication, and limit
have been applied. A two-step protocol is required because the CLI has no LLM
dependency and therefore cannot make the filtering decision itself. Collection
always uses region mode; auto-detected Topics config is ignored and an explicit
Topics config is rejected until a dedicated shape is specified.

Alternative: extend `--prompt` and document a shell pipeline. Rejected because
it leaves the discovery and state-ordering burden on every calling model.

Alternative: have the CLI call a model. Rejected because model selection,
credentials, billing, and response parsing are outside this package's scope.

### Compose custom rules as ordered text sources

The built-in Agent filter prompt remains authoritative and is always first. A
plain-text file at `$XDG_CONFIG_HOME/uae-news-digest/filter.md`, falling back to
`~/.config/uae-news-digest/filter.md`, provides durable additions; repeatable
`--filter-rule <text>` adds per-run instructions after the file. Absence of the
default file is normal. The JSON labels each source so Sana can preserve the
order and explain the effective criterion.

Alternative: extend `digest.config.json`. Rejected because Topics config has a
different responsibility and a global model policy should not depend on the
current working directory.

### Persist the run record outside the project and commit reviewed candidates

Collection first reads the selected Seen-item state and stores the remaining
candidate IDs, their Seen-item keys, the selected state file, and an expiry
timestamp in a private cache location under
`$XDG_CACHE_HOME/uae-news-digest/agent-runs` (falling back to
`~/.cache/uae-news-digest/agent-runs`). The state-file path is captured at
collection time so commit cannot accidentally update another Digest's state.

Commit validates the run and all supplied `--keep` IDs before writing any state.
The state-update operation must serialize writers for the selected state file,
re-read its current keys after the lock is acquired, union them with every run
candidate key, and atomically persist that union. This prevents a commit from
removing keys written by a default Digest or another agent run after collection.
After the state update succeeds, commit marks the run unavailable and only then
emits its successful JSON response. On success, it records every candidate as
reviewed: the external model has read and rejected the noise, so re-presenting
it wastes later runs. It returns the kept Items as the model's final
machine-readable Digest. A successful commit deletes its record; stale records
are removed during collection and commit.

Alternative: write the Seen-item state during collection. Rejected because an
interrupted or failed model pass would hide Items it never reviewed.

Alternative: retain only kept Items. Rejected because discarded promotional and
irrelevant Items would repeatedly consume model context.

## Risks / Trade-offs

- [A process or model crash leaves a cached run] → Run records expire and are
  pruned; they never change Seen-item state until a successful commit.
- [A model supplies IDs from another run] → Commit validates run-scoped IDs
  before any state write and returns a corrective diagnostic.
- [A default Digest writes Seen-item state while an agent run is pending] → A
  serialized read-merge-write operation preserves both sets of keys.
- [A process stops while holding a state or run lock] → Locks record their
  owner and safely recover dead owners; the brief pre-metadata window expires
  by age instead of blocking later Digests permanently. Agent run records are
  written to a temporary file and atomically renamed, so an interruption cannot
  publish malformed JSON as a completable run.
- [The RSS feed exposes fewer than 200 Items] → The response carries both the
  requested limit and actual count; callers must not treat 200 as guaranteed.
- [A persistent rule is too broad or contradictory] → Source-labelled rules in
  the response make the effective instruction auditable; no hidden prompt
  rewriting occurs.
- [The new protocol adds one model tool call] → The calls replace a brittle,
  multi-flag shell composition and make completion/state handling explicit.

## Migration Plan

1. Add the `agent` command without modifying the default command or `--prompt`.
2. Document the JSON contract, persistent rules file, and two calls in help,
   README, and `manifest`.
3. Add deterministic CLI tests for collection, rule composition, region-only
   behaviour, state concurrency, commit ordering, expiry, and legacy
   compatibility.
4. Roll back by removing the additive `agent` command; incomplete cache records
   can be ignored because collection never writes the Seen-item state.

## Open Questions

- Retention is fixed at 24 hours for version one. A future Topics-mode agent
  result must be proposed separately.
