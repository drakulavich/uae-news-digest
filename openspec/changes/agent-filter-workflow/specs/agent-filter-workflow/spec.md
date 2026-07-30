## ADDED Requirements

### Requirement: Collect a broad agent candidate Digest
The system SHALL let Sana obtain a machine-readable candidate Digest with
`uae-news-digest agent collect`. The result SHALL contain a run identifier,
candidate identifiers that are valid only for that run, the requested lookback
period, the requested candidate limit, and the enriched Item fields used by the
Agent filter prompt. The default candidate limit SHALL be 200; an explicit
limit SHALL remain an upper bound rather than an assertion about the number of
Items available from Google News RSS. Collecting SHALL NOT modify the Seen-item
state.

#### Scenario: Collect a weekly candidate Digest
- **WHEN** Sana invokes `uae-news-digest agent collect --hours 168` and Google News RSS provides 77 eligible Items
- **THEN** the system returns one JSON document containing a run identifier and 77 identified Items, declares 200 as the requested candidate limit, and leaves the Seen-item state unchanged

#### Scenario: Reject an invalid candidate limit without consuming Items
- **WHEN** Sana invokes `uae-news-digest agent collect --limit 0`
- **THEN** the system exits nonzero with a human-readable validation error, creates no completable run, and leaves the Seen-item state unchanged

### Requirement: Provide composable agent filtering instructions
The system SHALL include the built-in Agent filter prompt in every collected
candidate Digest. It SHALL append persistent custom rules from
`$XDG_CONFIG_HOME/uae-news-digest/filter.md` (falling back to
`~/.config/uae-news-digest/filter.md`) and each repeated `--filter-rule` value
in that order. The JSON result SHALL identify each instruction source so Sana
can apply the complete criterion without a second CLI invocation.

#### Scenario: Combine built-in, persistent, and per-run rules
- **WHEN** Sana collects candidates with a readable persistent rules file and two `--filter-rule` values
- **THEN** the JSON result lists the built-in Agent filter prompt first, the persistent rules second, and the two per-run rules in command-line order

#### Scenario: Continue when no persistent rules file exists
- **WHEN** Sana collects candidates and the default persistent rules file does not exist
- **THEN** the system returns candidates with the built-in prompt and any provided `--filter-rule` values, without treating the absent optional file as an error

### Requirement: Commit an agent filtering decision explicitly
The system SHALL let Sana complete a collected run with
`uae-news-digest agent commit --run-id <id>` and zero or more repeated
`--keep <item-id>` values. A successful commit SHALL validate every supplied
candidate identifier against the run, report the kept Items, and only then
update the Seen-item state. By default it SHALL record every candidate from the
completed run as reviewed, so future Digests do not require the model to
reassess Items it already rejected.

#### Scenario: Commit selected Items after filtering
- **WHEN** Sana commits a valid run with identifiers for two of its candidates
- **THEN** the system reports those two Items as kept, records all candidates from that run in the Seen-item state, and makes the run unavailable for another commit

#### Scenario: Reject an unknown candidate without changing state
- **WHEN** Sana commits a valid run with a candidate identifier that was not returned by that run
- **THEN** the system exits nonzero with a human-readable error, preserves the Seen-item state, and leaves the run available for correction

### Requirement: Expire incomplete agent runs safely
The system SHALL make a collected run available to `agent commit` only for a
documented finite retention period. An expired or already completed run SHALL
not modify the Seen-item state and SHALL report how Sana can start a new
collection.

#### Scenario: Commit a live run
- **WHEN** Sana commits a collected run within its retention period
- **THEN** the system accepts the run subject to candidate validation

#### Scenario: Attempt to commit an expired run
- **WHEN** Sana commits a run after its retention period has elapsed
- **THEN** the system exits nonzero, leaves the Seen-item state unchanged, and instructs Sana to run `agent collect` again

### Requirement: Preserve existing CLI compatibility and discoverability
The system SHALL expose the agent workflow in `--help` and `manifest`. Layla's
existing default Digest command and Sana's existing `--prompt` command SHALL
retain their current behavior; the agent workflow SHALL be additive.

#### Scenario: Discover the agent workflow
- **WHEN** Omar runs `uae-news-digest manifest`
- **THEN** the manifest identifies both `agent collect` and `agent commit` and their required inputs

#### Scenario: Use the legacy prompt command
- **WHEN** Sana runs `uae-news-digest --prompt`
- **THEN** the system prints the built-in Agent filter prompt and exits successfully without creating an agent run or changing the Seen-item state

## Technical Notes

| Requirement | Current traceability |
| --- | --- |
| Collect a broad agent candidate Digest | `src/index.ts:48-61` defines the current global CLI options; `src/index.ts:317-388` validates options and runs the Digest; `src/pipeline.ts:38-74` returns selected Items and next Seen-item state. |
| Provide composable agent filtering instructions | `src/importance.ts:40-43` defines `FILTER_PROMPT`; `src/index.ts:310-315` currently prints it as a separate command. |
| Commit an agent filtering decision explicitly | `src/index.ts:328-329` loads the Seen-item state and `src/index.ts:280-283` / `src/state.ts:14-27` persist it; collection must not use this write path. |
| Expire incomplete agent runs safely | No current run-record capability exists; this requirement introduces it. |
| Preserve existing CLI compatibility and discoverability | `src/index.ts:62-141` is the help contract and `src/index.ts:145-180` builds `manifest`; `test/cli.test.ts:322-327` covers `--prompt`. |

## Open Issues

- The finite retention period for a collected run is not yet chosen. The design
  proposes 24 hours, but the final value must be confirmed before implementation.
- This change deliberately records all candidates of a completed run as reviewed.
  If a future workflow needs rejected Items to reappear, it requires a separate
  state-policy proposal rather than weakening this default silently.
