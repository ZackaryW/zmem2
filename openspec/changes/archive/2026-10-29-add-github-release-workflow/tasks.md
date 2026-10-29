# Tasks

## 1. Prepare verifiable release inputs

- [x] 1.1 Add release identity helpers under `scripts/release/` that validate a full source SHA, default-branch ancestry, package name, stable version, and lockfile agreement; verify temporary Git fixtures accept an eligible source and reject malformed/missing commits, out-of-history commits, and inconsistent metadata without substituting another ref.
- [x] 1.2 Generate the committed-tree source archive, deterministic manifest, and `SHA256SUMS`; verify repeat preparation yields matching bytes, expected source/build/lockfile paths exist, untracked/generated files are excluded, and corrupted archive or manifest bytes fail verification.
- [x] 1.3 Add an isolated archive-consumer check that builds from the extracted source, packs/installs the application outside the checkout, checks CLI version/help, and recalls a known annotation with an isolated home and background admission disabled; verify success for a valid archive and failure for a mismatching CLI version or incomplete archive.
- [x] 1.4 Document the local preparation/preview command and artifact contract in `docs/releases.md`, linked from the README; verify the documented local procedure produces the expected filenames, full source identity, and verifiable checksums without remote writes.

## 2. Connect the release preview to existing validation

- [x] 2.1 Add reusable invocation support to `.github/workflows/test.yml` with an explicit source-SHA input for release calls; verify workflow validation and checkout-selection tests preserve existing push/pull-request/manual behavior, all six OS/Node combinations, read-only permissions, and existing validation commands.
- [x] 2.2 Add `.github/workflows/release.yml` with required `source_sha`, Boolean `publish=false`, default-branch publication checks, and dependencies on preflight, the complete reused matrix, helper checks, and archive-consumer validation; verify preview invokes no publication operation and failed/cancelled/skipped required jobs cannot enable writes.
- [x] 2.3 Wire the release-helper tests into development/CI checks using the trusted workflow checkout and transfer prepared assets as one named artifact within the same run; verify source/manifest identity and hashes are checked after transfer and candidate code is never given release-write credentials.
- [x] 2.4 Document manual preview inputs, the full validation gate, and current source-test failures as publication prerequisites; verify examples distinguish workflow ref from source SHA and never imply that a successful local check or merged workflow has published a release.

## 3. Publish and resume releases safely

- [x] 3.1 Add a publication helper with an injectable GitHub boundary that verifies or creates the exact version tag, creates a draft release, uploads verified assets, checks delivered bytes, and publishes the draft; verify first publication through a fake API records the selected full SHA and exact expected assets without any unvalidated ref fallback.
- [x] 3.2 Add retry/conflict handling for wrong-commit tags, matching partial drafts, conflicting/unexpected assets, completed matching releases, and remote write failures; verify focused tests reject conflicts, resume only matching drafts, and never move tags, delete versions, or overwrite published assets.
- [x] 3.3 Connect the helper to the explicit publish-only job with job-scoped `contents: write`, per-version serialization, a trusted helper checkout, and no candidate dependency installation or application execution; verify workflow lint and integration fixtures demonstrate preview/read-only jobs cannot publish and no npm or downstream-tap write is performed.
- [x] 3.4 Document publication, interrupted-draft recovery, source URL/checksum handoff to the tap, and correction through a new version; verify generated release notes/summary contain version, tag, full SHA, source URL, and archive checksum and that the documented recovery path performs no force replacement.

## 4. Verify the integrated release tooling

- [x] 4.1 Run the documented local preview and archive-consumer check plus an end-to-end simulated publication/retry; verify metadata, artifact checksums, fake remote state, and failure paths agree with the spec, with no real tags or releases created.
- [x] 4.2 Run relevant helper tests on available supported Node versions, project type/format checks, workflow validation, and appropriate regression checks; record actual OS/Node coverage, source identity, results, known unrelated platform failures, and hosted checks not run, keeping local tooling completion separate from a live published release.

## Workflow follow-up

- Review the completed change before archive. Commits and pushes remain subject to the user's authorization; keep temporary change artifacts out of source commits unless explicitly requested.
- After the workflow is on the default branch, run an authorized preview for the selected source SHA and resolve every required platform failure before publication.
- Run a publishing dispatch only with explicit authorization. Verify the public tag, release asset, manifest, and checksum, then hand those inputs back to `pathverse-tap` and resume `add-zmem2-cli-formula` task 1.1.
