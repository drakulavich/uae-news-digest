## 1. Agent workflow contract

- [ ] 1.1 Add failing CLI integration tests for the complete `agent collect` JSON contract, default candidate limit, Seen-item filtering, region-only behaviour, and no Seen-item state write.
- [ ] 1.2 Implement the collection command and its self-describing JSON response.
- [ ] 1.3 Add failing tests for persistent and repeated custom rule composition, absent rules, unreadable rules, then implement their loading and validation.

## 2. Commit and state safety

- [ ] 2.1 Add failing tests for a valid commit, zero kept Items, invalid candidate IDs, missing or unknown runs, expired runs, duplicate commits, and an intervening Seen-item state update.
- [ ] 2.2 Implement private run-record storage, expiry cleanup, and run-scoped identifier validation.
- [ ] 2.3 Implement a shared serialized read-merge-write Seen-item state update and use it for commit-time persistence before emitting success.

## 3. Discovery and verification

- [ ] 3.1 Update CLI help, `manifest`, and README with the agent protocol and custom-rule configuration.
- [ ] 3.2 Verify the legacy default command and `--prompt` behavior remain unchanged.
- [ ] 3.3 Run `bun test`, `bun run typecheck`, and `openspec validate --strict agent-filter-workflow`.
