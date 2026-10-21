# Tasks

## 1. Everyday guidance and package ownership

- [x] 1.1 Add the canonical query skill, UI metadata, current query contract and linked setup/recovery reference; validate skill structure, links and short-history query examples against the built CLI.
- [x] 1.2 Add a concise repository agent guide and README/CLI-help discovery, and ship skills in the package; verify build, existing CLI tests, formatting and package inclusion before committing this checkpoint.

## 2. Specialist workflows

- [x] 2.1 Add canonical authoring guidance and vocabulary with computed checks, explicit audits and valid target selection; validate a proposed cancellation in an isolated repository and confirm preview does not mutate its memory.
- [x] 2.2 Add canonical extension guidance, updated UI metadata and declarative/DSL/JavaScript references; validate skill structure and execute the documented examples plus existing focused compiler/extension tests before committing this checkpoint.

## 3. Installation and integrated evidence

- [x] 3.1 Inspect the final tarball and all skill/reference links, back up the three installed skills outside skill discovery, copy only the maintained files and verify byte equality while preserving unrelated files and invocation policy.
- [x] 3.2 Record checkpoint verification and installation/rollback evidence, validate OpenSpec and final formatting, and commit the record; leave the separate rebuild change and runtime installation unchanged.

## 4. Automatic bootstrap clarification

- [x] 4.1 Reconcile guidance and local OpenSpec context so missing indexes trigger initialization by default, preserve explicit user opt-out including indirect creation by queries/checks/status, and distinguish bootstrap failure from unavailable runtime; validate affected skills, links, formatting, artifacts and an isolated missing-index init/recall flow before committing.
- [x] 4.2 Back up and update only changed installed skill files, verify installed and packaged bytes, record scenario review and deployment evidence, and commit the rollout record.

## Verification record

Checkpoint 1: `npm run build`, `node --test dist/tests/cli.test.js` (4 passed), query skill `quick_validate.py`, five relative-link checks, `npm run format:check`, strict OpenSpec validation, and npm pack dry-run inclusion all passed. A temporary one-commit Git repository exercised init, filtered recall, literal case-insensitive search, a date boundary, show, links and zero-expansion warm sync through the absolute built CLI with an isolated home. No live-agent A/B performance claim is implied by fixture verification.

Checkpoint 1 commit: `dd59f7b`. Its complete message passed computed checking and the resulting commit was inspected through the new CLI with an isolated user home.

Checkpoint 2: both specialist skills passed `quick_validate.py`; all nine relative links resolved; formatting passed. `node --test dist/tests/compiler.test.js dist/tests/extensions.test.js` passed all 9 tests. Additional isolated fixtures extracted the actual YAML/JavaScript examples from the extension reference and verified declarative entries, atomic SUPERSEDE/invalid-target rollback, execution trust, warm reuse, changed-code surface identity and typed metadata. Computed and deep cancellation previews both passed and left existing memory unchanged. Typed metadata uses the engine's `add` operator, not prose shorthand.

Checkpoint 2 commit: `dcffad3`. Its message passed computed checking and post-commit show inspection succeeded.

Checkpoint 3: `npm pack --ignore-scripts --json` produced the final tarball from the already verified build; all 10 maintained skill files matched source bytes, and every relative guide/skill link resolved inside the archive. All three installed skills passed `quick_validate.py` after copying and matched the canonical sources byte-for-byte. Existing invocation policy and unrelated files were preserved. Final formatting and strict OpenSpec validation passed. The 13 focused existing tests and the documented-example fixtures above are the relevant verification for this guidance-only change; the full engine suite and Linux/macOS lifecycle matrix were not rerun.

Installed copies: `~/.codex/skills/zmem-query-memory`, `zmem-author-commits`, and `zmem-design-extensions`. Backup: `~/.codex/skill-backups/zmem-guidance-20261021-17bcaf30/`. Its `manifest.json` records overwritten/new paths and original/replacement hashes. To restore guidance, copy backed-up files to the corresponding skill directories and remove only the manifest's previously absent files after confirming they still match the installed hashes. No runtime/data restoration is required.

The bare `zmem` executable still resolves to the predecessor uv shim; this session used the absolute built TypeScript CLI with an isolated user home for checks and fixtures. No executable replacement, push, archive, global AGENTS.md edit, or modification to the separate rebuild's pending platform task was performed. This completion record is the third checkpoint.

Bootstrap clarification checkpoint: `b8b0f31`. Query/author skills, setup reference, agent guide, README and local OpenSpec context now encourage missing-index init by default and preserve a persistent user opt-out. Both affected skills passed structural validation, all 11 guide/skill links resolved, formatting and strict OpenSpec validation passed. A fresh one-commit Git fixture used the explicit TypeScript CLI and isolated home, retaining ref and attention limits: init computed one commit, recall returned its valid decision, and warm sync computed zero commits/expansions. It created `.zmem/.gitignore` without a root ignore file. Evidence: `C:/Users/ZackaryW/AppData/Local/Temp/zmem-bootstrap-guidance-l6rdhwzx/evidence.json`.

Scenario review covered missing index (init then resume), an existing index (reuse), user opt-out (avoid indirect bootstrap through cold query/check/status), unborn history (setup without repeated empty indexing), and failed init/missing runtime (report and fall back without a retry loop). This is a guidance review and real CLI fixture, not a live-agent behavioral test or a new runtime opt-out switch. No runtime code changed; the full engine test suite was not rerun.

The refreshed tarball and installed copies match source bytes for the three changed skill files. Both installed skills passed validation. Originals and a hash manifest are backed up at `~/.codex/skill-backups/zmem-bootstrap-296e181cf8c447418e6b45358237b6c5/`; restore those three paths to roll back this guidance update. Unrelated files and invocation metadata were preserved. The implementation commit passed computed message checking and post-commit inspection; this record completes the guidance-only rollout.
