# Design

## Context

See `proposal.md` for the motivation and `specs/versioned-source-releases/spec.md` for the contract.

The checkout is `ZackaryW/zmem2` on `main`, initially at `d20cc09c4fc228c1ec477c1572f10e761ea884eb`. Package and lockfile metadata identify `0.1.1`; the CLI currently reports that version from its entrypoint. The only workflow, `.github/workflows/test.yml`, runs dependency installation, type checking, formatting, tests/build, and `npm pack --ignore-scripts` across six OS/Node combinations. It does not retain release assets or publish tags/releases.

The Homebrew change needs tagged source and a checksum, not npm registry publication. A source asset must retain `package-lock.json`, TypeScript source, and build configuration. An npm package alone is insufficient for this chosen source-build contract because the package's `files` list primarily ships compiled application output, documentation, and skills.

The last inspected remote CI run had both macOS jobs passing but failed on Ubuntu Node 24 and both Windows jobs. A release workflow must run its own gates for its selected SHA; this plan does not diagnose or waive those failures. Existing engine specifications remain unchanged.

## Goals / Non-Goals

**Goals:**

- Give maintainers one manual workflow for a verifiable preview or an explicitly requested source release.
- Bind validation, assets, tag, and consumer instructions to one full commit identity.
- Recover safely from interrupted publication using the same version and artifacts.

**Non-Goals:**

- npm publishing, precompiled executables, Homebrew bottle generation, or automatic tap updates.
- Version bumping, fixes to engine behavior or existing platform test failures, or changes to CLI/data semantics.
- Publishing a release merely because the workflow was implemented or merged.

## Decisions

### 1. Manual dispatch with an exact source and preview default

Add `.github/workflows/release.yml` with `source_sha` (required full 40-character commit SHA) and `publish` (Boolean, default false). Require publication to execute from the default-branch workflow ref. Accept source only when its commit belongs to the fetched default-branch history, and preserve that SHA throughout the run even if the branch advances.

Derive the candidate version from source metadata; accept stable numeric `MAJOR.MINOR.PATCH` for this milestone. Verify the package name is `zmem2`, both lockfile version declarations match, and the built CLI reports the same version. The tag is `v<VERSION>`. Reject inconsistent metadata instead of rewriting it during release.

This resolves the first-release bootstrap problem without asking maintainers to create a tag before the workflow can run. Ordinary pushes and pull requests do not publish. Tag-push-only automation would still require a separate first-tag action; npm publication would add an unrelated credential and distribution channel.

### 2. Reuse CI for the selected source

Add `workflow_call` support and an optional source-SHA input to `test.yml`, while preserving its existing push, pull-request, and manual events. Ordinary CI retains its event-selected checkout; a release call explicitly checks out the preflight-validated source SHA. Preserve all six matrix combinations and existing validation commands.

Use read-only credentials and `persist-credentials: false` in source-validation jobs. The release workflow must depend on successful completion of the whole reusable matrix, with no `continue-on-error`, reduced platform list, or publication condition that accepts skipped/cancelled validation. Run release-helper checks against the trusted workflow checkout separately from the application source being released.

Do not rely on pushing the new tag to trigger CI: events produced with `GITHUB_TOKEN` generally do not trigger another workflow. The required validation is a dependency in the release run itself.

### 3. Prepare one checksummed source distribution

Use small Node helper modules under `scripts/release/`, with Node's built-in filesystem, crypto, child-process, and test APIs. Keep archive preparation and publication responsibilities separate and testable without real repository writes.

Create the archive from `git archive` of the exact source commit with prefix `zmem2-<VERSION>/`, then apply deterministic gzip metadata. Do not archive the working directory: dependencies, generated output, or local changes must not leak into the asset. Name the result `zmem2-<VERSION>-source.tar.gz`.

Generate `release.json` with a schema version, package name/version, tag, full source SHA, archive filename, and archive SHA-256. Avoid timestamps and run-specific identifiers in these version-identity bytes so a retry can compare them. `SHA256SUMS` covers the source archive and manifest; it does not checksum itself. A run summary can carry the run URL independently.

Extract the prepared archive into a fresh directory on macOS Node 24, install its locked dependencies with lifecycle scripts disabled, and run the build explicitly. Pack and install the resulting application in an isolated prefix, then check version/help and recall of a known annotation in a temporary Git repository with an isolated zmem home and background admission disabled. This catches source archives that work only because the original checkout supplied missing files. Keep all test state disposable.

Upload the prepared assets as a single, specifically named workflow artifact. The publication job downloads that artifact from the same run and rechecks its expected filenames, version/SHA identity, and hashes before any remote mutation.

### 4. Isolate the publication job

Default workflow permissions are `contents: read`; only the publication job uses `contents: write` and receives its job token for GitHub operations. It runs only when `publish` is true and preflight, all source-validation jobs, archive verification, and helper checks succeed.

Keep the trusted workflow/helper checkout pinned to the workflow execution SHA and the selected application-source checkout separate. The write-enabled job runs publication helpers from the trusted checkout, not scripts extracted from the candidate archive. It never installs candidate dependencies, runs candidate code, or evaluates the manifest as executable input. Pass inputs through environment variables or structured arguments, validate them, and avoid untrusted expression interpolation into shell code.

Use the existing job-scoped `GITHUB_TOKEN` and GitHub CLI/API. No personal token or tap write credential is needed. Failure caused by repository permissions or rulesets remains explicit; this change does not alter those settings.

### 5. Publish with conservative retry behavior

Serialize publication per version with `cancel-in-progress: false`. Immediately before writes, recheck the version tag's resolved commit and the release's existing state. If the tag is absent, create it at the validated full SHA; if it exists at another commit, fail without replacement. The GitHub CLI can create a tag at an explicit `--target`, but an explicit tag check/create followed by release creation with `--verify-tag` makes unintended default-branch fallback easier to exclude.

Create a draft GitHub release for the verified tag, upload the three expected assets, download/verify their delivered identities and checksums, and publish the draft only after the complete set matches. Existing matching draft assets are verified rather than overwritten; missing expected assets can be added. Conflicting or unexpected draft assets fail for maintainer review. A matching completed release is a no-op; a published release with missing or mismatching assets is an error, not an invitation to replace files. Do not delete tags or releases automatically after a partial failure.

The resulting download URL is `https://github.com/ZackaryW/zmem2/releases/download/v<VERSION>/zmem2-<VERSION>-source.tar.gz`. Notes and summary report that URL, version, full SHA, and archive checksum. The tap maintainer verifies those inputs before updating the formula; this workflow performs no downstream writes.

### 6. Verify release logic without requiring a live release

Test identity/version validation against temporary Git fixtures, including an ineligible commit and mismatching CLI version. Test archive contents, checksum rejection, reproducibility, and building the archive outside the source checkout. Stub the GitHub API boundary to exercise first publication, wrong-commit tags, partial drafts, corrupted assets, completed-release retries, and write failures.

Validate workflow syntax and dependency/permission wiring, especially preview with no publication call and failure/skipped validation preventing writes. Wire helper tests into development/CI checks while preserving the existing source-validation matrix. Add an end-to-end local preview with simulated publication responses; do not call this a successful live release.

Document actual remote workflow acceptance and public asset verification as follow-up after the workflow reaches the default branch and a publishing dispatch is separately authorized. Current cross-platform test failures are a prerequisite for a successful live release, not a reason to skip implementing and locally validating the release tooling.

## Risks / Trade-offs

- [Current platform tests fail] --> Preserve the full gate; resolve failures separately before a real publication can succeed.
- [A release is interrupted between tag creation and asset upload] --> Leave recognizable tag/draft state and resume only with matching source/assets; never force-move or overwrite.
- [GitHub-generated source archives change representation] --> Publish and checksum an explicitly generated source asset used by the tap.
- [Workflow inputs or candidate scripts reach write credentials] --> Validate inputs, separate trusted helpers from candidate source, and keep application execution in read-only jobs.
- [Tests pass locally but hosted settings block release creation] --> Record that local validation is not remote acceptance; surface permission/ruleset failures without changing settings.
- [Only source assets are published] --> Users still need the documented build/runtime prerequisites; Homebrew handles those through its formula.

## Migration Plan

1. Implement helpers and their focused tests, then reuse the existing CI matrix and add the release workflow with preview as default.
2. Run local fixture, archive-consumer, workflow, and simulated-publication checks; document the tested environment and outstanding platform failures.
3. Review and land the workflow through the normal repository process. Creating commits, pushing, and triggering publication remain separate actions subject to the user's authorization.
4. Once present on the default branch, run an authorized preview for a selected full SHA. Resolve any required source-validation failures before a publication request.
5. For an authorized publishing dispatch, verify the resulting remote tag, release assets, and downloaded checksum. Hand the release inputs to the existing tap change and resume its task 1.1.
6. If a workflow regression occurs, disable further publication and fix the workflow through review. Preserve existing versions; publish a new version for corrected source rather than rewriting an existing release.

## References

- [Existing CI](https://github.com/ZackaryW/zmem2/blob/d20cc09c4fc228c1ec477c1572f10e761ea884eb/.github/workflows/test.yml)
- [Package metadata](https://github.com/ZackaryW/zmem2/blob/d20cc09c4fc228c1ec477c1572f10e761ea884eb/package.json)
- [GitHub workflow triggering and token behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub manual dispatch events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)
- [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create)
