# Tasks

The user corrected the scope to Git-source installation only. Registry release work and its earlier completion claims are superseded and removed.

- [x] 1. Add source preparation while preserving the existing prepack build; verify preparation and type checking.
- [x] 2. Read the installed CLI version from package metadata and verify the entrypoint regression tests.
- [x] 3. Preserve the focused isolated checkout and direct Git source-install harness without dependencies on removed registry helpers; rerun it on Windows with npm 12.2.1.
- [x] 4. Remove the unintended registry workflow/helpers/docs, make Git the README installation source, reconcile planning, and verify formatting and scope. Keep existing GitHub source-release files unchanged.
- [x] 5. Delete docs/development.md as requested and remove its README links.

## Boundaries

The user subsequently requested incremental commits. Implementation checkpoints 44e134c and dd19e07 were created after staged-snapshot verification, zmem message validation, and pspec index checks; post-commit zmem inspection passed. Active planning was excluded from those checkpoints. No pushes, publication, or changes to the user's global npm installation were performed. Hosted cross-platform source-install execution has not run in this session.

## Host npm correction

The documented command now selects npm 12.2.1 through npm exec rather than assuming the user has upgraded npm. Real GitHub main install, cmd/PowerShell version checks, init/sync/recall and repeat install passed with host npm 11.20.0 on Windows Node 26.12.1. The updated source-install harness also passed from that host version. These checks used isolated prefixes; they do not claim the user global installation has been repaired.
