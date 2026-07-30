## Why

Omar and Sana currently have to compose `--json`, `--limit`, `--dry-run`, and a
separate `--prompt` invocation before an external model can filter a broad
Digest. This makes the intended workflow difficult for an agent to discover and
can mark Items as seen before the agent has finished its decision.

## What Changes

- Add an agent-oriented two-step CLI workflow: `agent collect` prepares a broad
  candidate Digest and its filtering instructions; `agent commit` records the
  completed agent decision.
- Make `agent collect` return a self-describing JSON contract, including the
  built-in Agent filter prompt, active custom rules, stable candidate IDs, and
  the command shape needed to complete the run.
- Set the agent workflow's candidate limit to 200 by default, while preserving
  the upstream feed's actual availability as the upper bound.
- Load persistent custom rules from a documented configuration file and accept
  additional per-invocation rules.
- Defer Seen-item state changes until `agent commit`, so an external model can
  make its selection before Items become unavailable to later runs.

## Non-goals

- Calling an LLM, selecting a model, managing credentials, or interpreting an
  LLM response inside the CLI.
- Guaranteeing that a single Google News RSS feed contains 200 Items.
- Changing the Core API, Layla's default Digest command, or Sana's existing
  `--prompt` command.
- Providing a UI for editing custom filtering rules or a Topics-mode agent
  result in this first release.

## Capabilities

### New Capabilities

- `agent-filter-workflow`: A machine-oriented collection and commit contract for
  an external model to filter a broad Digest using the Agent filter prompt and
  custom rules.

### Modified Capabilities

- None. The baseline `agent-surface` capability has not yet been extracted into
  `openspec/specs/`, so this change introduces its own complete capability spec.

## Impact

- Affects the public Commander CLI and its `manifest` / help discovery surface.
- Adds a temporary agent-run record and changes when the Seen-item state is
  written for the new workflow only; the existing default command and `--prompt`
  remain compatible.
- Requires CLI integration tests and documentation; no model SDK, API key, or
  runtime dependency is introduced.
