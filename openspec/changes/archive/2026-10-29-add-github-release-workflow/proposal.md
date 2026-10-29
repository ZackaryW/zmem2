# Proposal

## Why

The Pathverse Homebrew tap needs a published zmem2 version with a verifiable source archive. This repository currently builds and tests its package but has no release workflow, tags, or GitHub releases, leaving the tap's first formula blocked on a manual upstream release.

## What Changes

- Add a manually dispatched release workflow that accepts an exact source commit and defaults to a non-publishing preview.
- Derive the release version from package metadata, verify it against the lockfile and built CLI, and require the selected commit to belong to the default branch's history.
- Reuse the existing Node 24/26 test matrix across macOS, Ubuntu, and Windows as a release gate for that exact source commit. A failed required job prevents publication.
- Produce a versioned source archive containing the committed source and lockfile, a SHA-256 checksum file, and a small release manifest identifying the version and commit.
- When publishing is explicitly selected and validation succeeds, create the version tag and GitHub release with those verified assets. Reject conflicting tags/assets and support recovery from an interrupted draft release without overwriting a published version.
- Document preview, publication, failure recovery, and the release URL/checksum handoff to the Homebrew tap.

This change does not publish to npm, modify the tap, bump the package version, repair unrelated engine/test failures, or add automatic releases on ordinary pushes. Planning or implementing the workflow does not itself authorize running a publishing dispatch.

## Capabilities

### New Capabilities

- `versioned-source-releases`: Maintainer-triggered validation and publication of a versioned zmem2 source release with exact commit identity, downloadable artifacts, and checksums.

### Modified Capabilities

None. Existing engine and CLI behavior remains unchanged.

## Impact

- Planned changes: `.github/workflows/release.yml`, reusable invocation support in `.github/workflows/test.yml`, focused release helpers and tests, and release-operation documentation.
- Existing `push`, `pull_request`, and manual test runs retain their current six-job matrix and commands.
- GitHub repository write permission is limited to the publication job; validation and preview use read access. No npm token or cross-repository credential is required.
- A published `v<VERSION>` tag and `zmem2-<VERSION>-source.tar.gz` asset provide the stable source input needed by the tap.
- Known failures in the current upstream test matrix remain a release prerequisite to resolve; this workflow must not hide them or weaken the gate.
