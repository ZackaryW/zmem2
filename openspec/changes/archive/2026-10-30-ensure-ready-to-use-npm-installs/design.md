# Design

## Context

The reported launcher resolves to dist/src/cli/main.js in a source checkout lacking build output. The intended installation source is always Git. Earlier registry publication planning was based on an incorrect interpretation and is superseded by this scope correction.

## Goals / Non-Goals

Provide a working command after a lifecycle-enabled direct Git installation or prepared checkout link. Support current main and pinned commits. Retain explicit build recovery when scripts are disabled.

Registry publishing, npm channels, publication credentials, new release workflows, and changes to repository memory behavior are out of scope.

## Decisions

- Add `prepare: npm run build`; retain the existing `prepack` build.
- Read the CLI version from installed package.json.
- Select npm 12.2.1 explicitly using `npm exec --yes --package=npm@12.2.1 -- npm install ...` and document `--allow-git=root`. The host npm may be 11.20.0; do not rely on users separately upgrading their global npm. Isolated npm 11.20.0 and 11.21.1 attempts failed during nested Git preparation; npm 12.2.1 passed without a package-specific workaround.
- Use a clean temporary Git fixture, private npm prefix/cache/config, and real npm launchers. Keep the user's global installation and memory untouched.
- Use `#main` for the newest main source and a full commit SHA for reproducibility. Keep lifecycle scripts and build dependencies available.
- Preserve the existing GitHub source-release implementation without introducing a registry release pipeline.

## Verification

Run the focused source-install harness from the host npm 11.20.0, selecting npm 12.2.1 through the documented bootstrap. Also exercise real GitHub main installation and repeated installation in an isolated prefix. Verify clean checkout preparation, linking/local installation, direct pinned Git installation, and explicit scripts-disabled builds. Windows verification uses both cmd and PowerShell launchers. Retain application type/version regression checks and formatting checks. Report local runtime evidence separately from unrun platforms.
