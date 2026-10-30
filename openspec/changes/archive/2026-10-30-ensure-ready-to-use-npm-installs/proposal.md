# Proposal

## Why

The global zmem launcher can point to a source checkout without its compiled CLI. The user intends npm to install zmem2 directly from Git, including the current main branch. npm is the installer; zmem2 is not being distributed through the npm registry.

## What Changes

- Prepare clean source automatically during lifecycle-enabled installation.
- Report the installed package version rather than a hardcoded CLI version.
- Verify direct global Git installation, prepared checkout linking, and explicit scripts-disabled builds with isolated prefixes.
- Document Git main and pinned-commit installation, prerequisites, updates, and missing-build recovery.

## Capabilities

### New Capabilities

- `npm-distribution`: Ready-to-use installation of Git source using npm.

### Modified Capabilities

None. The existing GitHub source-release workflow is unchanged.

## Impact

Package lifecycle, CLI version reporting, focused source-install checks, and README setup. Remove docs/development.md at the user's request. No registry publishing, release channels, OIDC, public publication, or global installation changes are included. Registry-related work from the earlier misinterpretation has been removed at the user's request.
