# Spec Delta

## Purpose

Let maintainers validate and publish an exact zmem2 source version through GitHub Actions, providing the version identity and checksummed downloadable source required by downstream package managers.

## ADDED Requirements

### Requirement: Explicit release request and preview
The release workflow SHALL accept a manually selected full source commit SHA and an explicit publication choice that defaults to false. A preview SHALL validate and prepare the release inputs without creating or modifying remote tags or GitHub releases. Publication SHALL run only from the repository's default-branch workflow.

#### Scenario: Preview is the default
- **WHEN** a maintainer dispatches a valid source SHA without enabling publication
- **THEN** validation and artifact preparation run and no tag or GitHub release is created

#### Scenario: Publishing from another workflow ref is rejected
- **WHEN** publication is requested from a workflow ref other than the default branch
- **THEN** the request fails before creating a tag or release

### Requirement: Release identity matches one eligible source commit
The selected source MUST resolve to the requested full commit SHA in the default branch's history. Its package metadata, lockfile version declarations, and built CLI MUST agree on a stable `MAJOR.MINOR.PATCH` version. The release tag SHALL be `v<VERSION>`. Invalid identity MUST prevent publication.

#### Scenario: Consistent version identity
- **WHEN** the eligible source, package metadata, lockfile, and CLI identify version `0.1.1`
- **THEN** release preparation identifies the exact source SHA and tag `v0.1.1`

#### Scenario: Metadata or CLI versions disagree
- **WHEN** package metadata, lockfile, or the built CLI reports a different version
- **THEN** preparation fails without creating a tag or release

#### Scenario: Invalid or ineligible source
- **WHEN** the requested commit is malformed, unavailable, or outside the default branch's history
- **THEN** the workflow rejects it without substituting a moving branch or another commit

### Requirement: Existing validation matrix gates publication
Publication SHALL require successful dependency installation, type checking, formatting checks, tests, and package preparation for the selected source across Node 24 and 26 on macOS, Ubuntu, and Windows. Existing ordinary CI triggers and matrix coverage SHALL remain available. Failed, cancelled, or skipped required validation MUST block publication.

#### Scenario: All required jobs pass
- **WHEN** every required source-validation job succeeds for the selected commit
- **THEN** the publication stage can proceed if publication was requested

#### Scenario: A required platform fails
- **WHEN** any required platform/runtime job fails, is cancelled, or is skipped
- **THEN** no new release tag or published GitHub release is created by that run

### Requirement: Versioned source assets are verifiable
Release preparation SHALL produce `zmem2-<VERSION>-source.tar.gz`, `SHA256SUMS`, and `release.json` from the selected commit. The source archive MUST include package metadata, the committed lockfile, TypeScript source, and build configuration. The manifest MUST identify the version, tag, source SHA, archive filename, and archive SHA-256. Checksums MUST verify the delivered archive and manifest bytes.

#### Scenario: A package manager consumes the source release
- **WHEN** a consumer downloads the source asset and checksum file
- **THEN** the archive verifies successfully and contains the files needed for a locked source build

#### Scenario: Local or generated files are present during preparation
- **WHEN** the preparation workspace contains untracked files, dependencies, or generated build output
- **THEN** the source archive still represents the selected committed tree without those workspace additions

#### Scenario: Delivered bytes are corrupted
- **WHEN** the source archive or manifest differs from its recorded checksum
- **THEN** verification fails and publication does not proceed with those bytes

### Requirement: Source archives are validated outside the checkout
Before publication, the prepared source archive SHALL be extracted into an isolated directory and built using its committed dependencies. The resulting installed CLI SHALL report the release version and recall a known annotation from a temporary Git repository without requiring the original checkout.

#### Scenario: Archive is a usable source distribution
- **WHEN** an isolated consumer builds and installs the prepared archive with supported Node and Git
- **THEN** `zmem --version` reports the declared version and recall returns the test annotation

### Requirement: Publication binds assets and tag to validated source
An explicitly requested publication SHALL bind `v<VERSION>` to the validated commit and publish a GitHub release containing the verified assets. Release notes or the run summary SHALL identify the source SHA, version, source URL, and archive SHA-256. Publication MUST NOT rely on a subsequent tag-triggered CI run to supply its validation gate.

#### Scenario: First publication
- **WHEN** publication is enabled, all gates pass, and the version has no conflicting remote state
- **THEN** the workflow creates or verifies the matching tag and publishes the verified assets under that tag

### Requirement: Retries preserve published version identity
The workflow MUST NOT move an existing tag or overwrite published release assets. A conflicting tag, manifest, or asset MUST fail explicitly. An interrupted draft with the same source identity SHALL be resumable by verifying existing assets and adding missing matching assets. A fully matching published release SHALL be reported as already complete.

#### Scenario: A tag already points elsewhere
- **WHEN** the version tag resolves to a different source commit
- **THEN** publication fails without moving or deleting the tag

#### Scenario: Retry an interrupted upload
- **WHEN** a prior attempt left a matching tag and draft release with only some expected assets
- **THEN** the retry verifies existing assets, supplies missing ones, and publishes only when the expected set verifies

#### Scenario: Retry a completed publication
- **WHEN** the published version already has the same source identity and matching expected assets
- **THEN** the workflow reports completion without replacing those assets

### Requirement: Release writes are isolated from source validation
Only the publication job SHALL receive repository-content write permission. Preview and source-validation jobs MUST NOT receive release-write credentials. The publication job MUST consume verified artifacts without installing dependencies or executing application code from the selected source. This workflow MUST NOT write to npm or downstream tap repositories.

#### Scenario: Validation fails before publication
- **WHEN** selected source code fails during tests or archive verification
- **THEN** it has no release-write credentials and publication is not invoked

### Requirement: Release operations and consumer handoff are documented
Maintainer documentation SHALL describe prerequisites, preview and publish inputs, version consistency, failure recovery, and the source URL/checksum handoff. It SHALL distinguish a validated preview, an implemented workflow, and an actually published release. Existing platform failures MUST remain visible release blockers.

#### Scenario: Prepare a release for the Homebrew tap
- **WHEN** a maintainer follows the release instructions
- **THEN** the instructions identify how to obtain a matching tag, source URL, commit SHA, and checksum without implying that a preview or workflow merge published them
