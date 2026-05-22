# Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tag-triggered release pipeline that publishes `@drakulavich/uae-news-digest` to npm with provenance and creates a GitHub Release from changelog notes.

**Architecture:** The release process is driven by a new GitHub Actions workflow at `.github/workflows/release.yml`. Release notes come from a new `CHANGELOG.md`; the workflow extracts the matching `## [x.y.z]` section for the pushed `vX.Y.Z` tag and fails before publishing if notes are missing.

**Tech Stack:** GitHub Actions, Bun 1.3.14, Node 20, npm provenance, GitHub CLI.

---

## File Structure

- Create: `CHANGELOG.md`
  - Keeps release notes in Keep a Changelog format.
  - Provides `[Unreleased]` and `[0.0.3] - 2026-05-22` sections.
- Create: `.github/workflows/release.yml`
  - Runs on pushed `v*` tags.
  - Runs install/typecheck/test/build/pack smoke before publishing.
  - Publishes to npm using `NPM_TOKEN`.
  - Creates the GitHub Release from extracted changelog notes.
- Modify: none.

---

### Task 1: Add Changelog

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create `CHANGELOG.md`**

Create `CHANGELOG.md` with this content:

```markdown
# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.3] - 2026-05-22

### Added
- CI now type-checks, tests, and package-smoke-tests on Linux and macOS.
- Package metadata is read from `package.json` for the CLI manifest.
- Packed package smoke coverage verifies the binary and public core export.

### Fixed
- Seen-item state writes are atomic.
- Items with missing or malformed publication dates are skipped.
- DeepL fallback warnings are reported in text and JSON output.
```

- [ ] **Step 2: Verify the changelog section exists**

Run:

```bash
awk -v ver="0.0.3" '
  BEGIN { inblock = 0 }
  /^## \[/ {
    if (inblock) exit
    if ($0 ~ "\\["ver"\\]") { inblock = 1; next }
  }
  inblock { print }
' CHANGELOG.md
```

Expected: prints the `### Added` and `### Fixed` notes for `0.0.3`.

- [ ] **Step 3: Commit changelog**

Run:

```bash
git add CHANGELOG.md
git commit -m "docs: add changelog"
```

Expected: commit succeeds with `CHANGELOG.md` created.

---

### Task 2: Add Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

Create `.github/workflows/release.yml` with this content:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun test
      - run: bun run build
      - run: bun run smoke:pack

      - name: Extract release notes from CHANGELOG
        run: |
          version="${GITHUB_REF_NAME#v}"
          awk -v ver="$version" '
            BEGIN { inblock = 0 }
            /^## \[/ {
              if (inblock) exit
              if ($0 ~ "\\["ver"\\]") { inblock = 1; next }
            }
            inblock { print }
          ' CHANGELOG.md > release-notes.md

          if [ ! -s release-notes.md ]; then
            echo "::error::CHANGELOG.md has no notes for ${version}. Add a matching ## [${version}] section before tagging."
            exit 1
          fi

      - name: Publish to npm
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm publish --access public --provenance

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            --title "${GITHUB_REF_NAME}" \
            --notes-file release-notes.md
```

- [ ] **Step 2: Validate workflow trigger and permissions by inspection**

Run:

```bash
sed -n '1,140p' .github/workflows/release.yml
```

Expected:
- `on.push.tags` contains `v*`.
- `permissions.contents` is `write`.
- `permissions.id-token` is `write`.
- publish uses `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

- [ ] **Step 3: Verify release notes extraction failure path locally**

Run:

```bash
version="9.9.9"
awk -v ver="$version" '
  BEGIN { inblock = 0 }
  /^## \[/ {
    if (inblock) exit
    if ($0 ~ "\\["ver"\\]") { inblock = 1; next }
  }
  inblock { print }
' CHANGELOG.md > /tmp/uae-news-release-notes-missing.md
test ! -s /tmp/uae-news-release-notes-missing.md
```

Expected: command exits `0`, proving a missing version produces an empty notes file that the workflow guard will reject.

- [ ] **Step 4: Commit workflow**

Run:

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow"
```

Expected: commit succeeds with the release workflow created.

---

### Task 3: Verify And Open PR

**Files:**
- Read: `CHANGELOG.md`
- Read: `.github/workflows/release.yml`
- Read: `package.json`

- [ ] **Step 1: Run the full local verification matrix**

Run:

```bash
bun test
bun run typecheck
bun run build
bun run smoke:pack
```

Expected:
- `bun test` reports `81 pass` and `0 fail`.
- `bun run typecheck` exits `0`.
- `bun run build` exits `0`.
- `bun run smoke:pack` exits `0`.

- [ ] **Step 2: Confirm the implemented files match the spec**

Run:

```bash
rg -n "NPM_TOKEN|--provenance|release-notes.md|CHANGELOG.md|bun-version: 1.3.14|smoke:pack" .github/workflows/release.yml CHANGELOG.md
```

Expected: output shows all release workflow requirements and the changelog path.

- [ ] **Step 3: Push the branch**

Run:

```bash
git push -u origin docs/release-pipeline-design
```

Expected: branch is pushed to GitHub.

- [ ] **Step 4: Open the PR**

Run:

```bash
gh pr create \
  --base main \
  --head docs/release-pipeline-design \
  --title "ci: add release pipeline" \
  --body "## Summary
- Add CHANGELOG.md as the source of release notes.
- Add tag-triggered release workflow for npm publish with provenance and GitHub Release creation.

## Test Plan
- [x] bun test
- [x] bun run typecheck
- [x] bun run build
- [x] bun run smoke:pack"
```

Expected: GitHub returns the PR URL.

- [ ] **Step 5: Watch PR checks**

Run:

```bash
gh pr checks --watch
```

Expected: macOS and Ubuntu CI checks pass. Greptile may also report a review check; if it comments with actionable feedback, address it before merge.
