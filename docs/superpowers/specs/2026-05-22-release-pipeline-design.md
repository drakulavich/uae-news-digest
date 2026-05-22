# Release Pipeline Design

## Purpose

Add a tag-driven release pipeline for `@drakulavich/uae-news-digest` that matches the sibling `drakulavich/oura-cli` release workflow. A release tag should publish the package to npm with provenance and create a GitHub Release with notes extracted from `CHANGELOG.md`.

## Current State

The project already has CI coverage on pull requests and pushes to `main`. CI runs on Linux and macOS with Bun 1.3.14 and verifies:

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `bun test`
- `bun run smoke:pack`

The repository does not yet have a release workflow or changelog. The latest GitHub release is `v0.0.3`, but npm still shows `0.0.2` because local npm credentials were unavailable during the manual release.

## Approach

Add two release-facing files:

- `CHANGELOG.md`, following Keep a Changelog style with `[Unreleased]` and versioned release sections.
- `.github/workflows/release.yml`, triggered by pushed tags matching `v*`.

The release workflow should:

1. Check out the tagged source.
2. Install Bun with the same pinned version used by CI.
3. Set up Node 20 with `registry-url: https://registry.npmjs.org`.
4. Run the same package quality gates as CI, plus build:
   - `bun install --frozen-lockfile`
   - `bun run typecheck`
   - `bun test`
   - `bun run build`
   - `bun run smoke:pack`
5. Extract the changelog section for `${GITHUB_REF_NAME#v}` into `release-notes.md`.
6. Publish to npm with `npm publish --access public --provenance`.
7. Create the GitHub Release with `gh release create "${GITHUB_REF_NAME}" --title "${GITHUB_REF_NAME}" --notes-file release-notes.md`.

## Changelog Rules

The changelog must include a section for every version tag before that tag is pushed. If no matching section is present, the release workflow should fail before npm publishing or GitHub Release creation.

Initial changelog content should include:

- `[Unreleased]`
- `[0.0.3] - 2026-05-22` documenting the release pipeline catch-up context and recent hardening already included in the current package version.

## Authentication And Permissions

The release workflow needs:

- `permissions.contents: write` so `GITHUB_TOKEN` can create the GitHub Release.
- `permissions.id-token: write` so npm provenance works.
- Repository secret `NPM_TOKEN` with permission to publish `@drakulavich/uae-news-digest`.

If `NPM_TOKEN` is missing or invalid, the workflow should fail at publish time with npm's authentication error. No custom fallback publish path is needed.

## Error Handling

The changelog extraction step should validate that extracted notes are non-empty. If the version section is missing or empty, it should exit non-zero with a human-readable message explaining that `CHANGELOG.md` needs a matching `## [x.y.z]` section.

The npm publish and GitHub Release steps can rely on their standard CLI failures. Their commands should remain direct and visible in logs.

## Testing

Implementation verification should run locally before opening the PR:

- `bun test`
- `bun run typecheck`
- `bun run build`
- `bun run smoke:pack`

Workflow syntax should also be reviewed by reading the generated YAML. The full npm publish path can only be proven after merging and pushing a tag with a valid `NPM_TOKEN`.

## Release Procedure After Merge

For future releases:

1. Update `package.json` version.
2. Move changelog entries from `[Unreleased]` into a matching version section.
3. Merge the release PR to `main`.
4. Push tag `vX.Y.Z`.
5. Confirm the GitHub Actions release workflow publishes npm and creates the GitHub Release.
