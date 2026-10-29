# Source releases

The `Release` GitHub Actions workflow prepares a versioned source distribution for
consumers such as the Pathverse Homebrew tap. It does not publish to npm or update
another repository. A merged workflow is not a published release.

## Prerequisites

Use Node 24 or 26, npm, Git, and `tar` for local checks. Hosted publication uses the
repository's job-scoped `GITHUB_TOKEN` with `contents: write` only in the publish
job; no personal token or npm credential is required. Repository rules must allow
tag/release creation. The workflow does not change those rules.

Choose a full 40-character lowercase commit SHA from the default branch's history.
The selected source's `package.json`, both root version declarations in
`package-lock.json`, and built `zmem --version` must agree on a stable numeric
`MAJOR.MINOR.PATCH` version. For example, `0.1.1` produces tag `v0.1.1`. The workflow
does not bump versions or rewrite mismatching metadata.

Every release Node 24/26 job on macOS, Ubuntu, and Windows must pass dependency
installation, TypeScript compilation with type checking, and tests. Formatting
and package preparation run once on Ubuntu Node 24. The last inspected
pre-workflow CI run (`39867870570`, source `d20cc09c`) had failures on Ubuntu Node 24
and both Windows jobs. Such failures block publication; they are not waived by a
passing macOS run or by these release-tooling checks.

## Local preview

From the repository root, choose the reviewed source SHA and fetch the default
branch. These examples assume the repository's current default branch, `main`:

```sh
npm ci --ignore-scripts
npm run test:release
git fetch --no-tags origin main
release_sha="$(git rev-parse origin/main)"
release_dir="$(mktemp -d)"
node scripts/release/cli.mjs prepare --source-sha "$release_sha" \
  --default-ref origin/main --out "$release_dir"
node scripts/release/cli.mjs verify --dir "$release_dir" --source-sha "$release_sha"
node scripts/release/cli.mjs consume --dir "$release_dir" --source-sha "$release_sha"
```

Preparation reads the exact committed tree, excluding local changes, dependencies,
and generated output. Output must be outside the checkout. Use a fresh output
directory. `consume` extracts and builds in a temporary directory, installs the npm
package into a private prefix, checks version/help, and recalls a known annotation
in an isolated repository/home. It removes its temporary installation afterward.
It never installs into the user's global npm prefix or initializes the source repo.

The output directory contains:

| File                            | Meaning                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `zmem2-<VERSION>-source.tar.gz` | Committed source tree, including lockfile and build inputs             |
| `release.json`                  | Schema, package/version/tag, full source SHA, archive name and SHA-256 |
| `SHA256SUMS`                    | Checksums of the archive and manifest                                  |

Keep these files together. Verification rejects modified bytes, mismatching source
identity, and missing/unexpected files. Repeating preparation of the same commit
with the same tooling produces the same assets. A preview does not prove that the
entire hosted OS/runtime matrix passes.

## Hosted preview

Once the workflow is present on the default branch, open **Actions > Release > Run
workflow**. Choose the default branch for the workflow ref, supply the reviewed
full SHA as `source_sha`, and leave `publish` unchecked (the default).

The run executes release-helper checks, validates the exact selected source with
the full six-job release matrix, and builds/tests the delivered source archive on
macOS Node 24. The `release-assets` run artifact and summary identify the candidate.
No remote tag or GitHub release is created in preview mode. A workflow run artifact
is temporary validation output, not the permanent source URL for a formula.

## Publish

After reviewing a successful preview and obtaining authorization to publish, run
the same workflow from the default branch with the same `source_sha` and check
`publish`. Validation runs again; publication requires every gate to succeed. A
cancelled, failed, or skipped required gate prevents the publish job from running.

Publication creates or verifies the exact version tag, creates a draft release,
uploads the three assets, verifies their delivered bytes, and then publishes.
Only that job has release-write permission. It uses trusted workflow helpers and
verified data files without installing or running the selected application source.
Transferred assets are also bound to the archive checksum emitted by preparation.
Publication is serialized per version. Tag creation does not need to trigger a
second CI run: this run has already validated its source.

## Retry and recovery

Retry the same SHA/version after an interrupted upload. Matching existing draft
assets are verified and preserved, missing expected assets are added, and the
draft is published only when the complete set verifies. A complete matching
published release is reported as already published with no further writes.

A tag pointing elsewhere, unexpected or corrupt draft assets, or an incomplete or
mismatching published release causes an explicit failure. Investigate that state
before retrying; the workflow never moves a tag, deletes a release, or replaces
published assets. Fix changed application source through a new version rather
than rewriting an existing release. API permission or repository-rule failures
are reported without automatically changing settings.

## Homebrew handoff

After actual publication, obtain the version, full source SHA, source URL, and
archive SHA-256 from the manifest and summary. The permanent source URL is:

```text
https://github.com/ZackaryW/zmem2/releases/download/v<VERSION>/zmem2-<VERSION>-source.tar.gz
```

Download the source, `release.json`, and `SHA256SUMS` from that release into a fresh
directory and verify the checksums, tag commit, and version. The tap maintainer can
then use that exact URL and checksum in the formula and resume its release-input
verification. This workflow does not commit or push the tap update.

## Local implementation verification

Verified on 2026-10-29 on macOS 26.6.2, Apple Silicon:

- Release helper, API-boundary, retry, and workflow-contract tests: 18 passed on
  Node 24.22.2 and 18 passed on Node 26.12.1.
- Application regression suite: 77 passed on Node 26.12.1. Project type checking
  and formatting checks passed.
- Both workflow files passed `actionlint` 1.7.12. ShellCheck integration was
  disabled because ShellCheck was not installed in this validation environment.
- The documented local prepare/verify/consume procedure succeeded for source
  `d20cc09c4fc228c1ec477c1572f10e761ea884eb`, version `0.1.1`, with archive SHA-256
  `147dcc71b9935b74fe0b3fc8d11b0a9d3e2e50a459c9690150d7fa2e7300d9ce`.
  Isolated installation, CLI startup/version, and annotated-commit recall succeeded
  on both Node versions. This archive represents that committed source baseline;
  releasing a later commit containing the new workflow will produce a new checksum.
- Publication, interrupted-upload recovery, completed-release retries, corrupt
  assets, and tag races were exercised against a fake GitHub boundary. No remote
  tag or release was created. The proposed implementation commit message passed
  `zmem check` with no diagnostics in an isolated clone; no commit was created.

Hosted workflow execution, current Ubuntu/Windows release-gate results, repository
write permissions/rulesets, and public release-download acceptance remain
unverified. Earlier hosted platform failures remain publication prerequisites to
resolve. These local checks do not claim a published or publicly installable release.
