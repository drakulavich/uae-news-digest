## 1. Agent workflow contract

- [ ] 1.1 Add failing CLI integration tests for `agent collect` JSON, default candidate limit, and no Seen-item state write.
- [ ] 1.2 Implement the collection command and its self-describing JSON response.
- [ ] 1.3 Add failing tests for persistent and repeated custom rule composition, then implement their loading and validation.

## 2. Commit and state safety

- [ ] 2.1 Add failing tests for a valid commit, zero kept Items, invalid candidate IDs, expired runs, and duplicate commits.
- [ ] 2.2 Implement private run-record storage, expiry cleanup, and run-scoped identifier validation.
- [ ] 2.3 Implement commit-time Seen-item state updates only after validation succeeds.

## 3. Discovery and verification

- [ ] 3.1 Update CLI help, `manifest`, and README with the agent protocol and custom-rule configuration.
- [ ] 3.2 Verify the legacy default command and `--prompt` behavior remain unchanged.
- [ ] 3.3 Run `bun test`, `bun run typecheck`, and `openspec validate --strict agent-filter-workflow`.
