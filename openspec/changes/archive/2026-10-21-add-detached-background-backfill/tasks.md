# Tasks

## 1. Durable admission checkpoint

- [x] 1.1 Add background configuration and a durable queue with two active/eight waiting limits, semantic deduplication, explicit outcomes, persistent controls and ownership fencing; verify capacity, concurrent admissions, restart persistence and read-only status with focused tests and document the contract.

## 2. Staged computation checkpoint

- [x] 2.1 Add bounded segment stepping, private staging, pinned inputs, compatible reuse and fenced complete-view publication; verify multiple segments, interruption/restart, unchanged foreground snapshots, effect correctness, storage limits and hook/receipt behavior with focused tests and document recovery.

## 3. Detached execution checkpoint

- [x] 3.1 Implement on-demand supervisor and worker entry points with singleton ownership, concurrency limits, deadlines, graceful/forced termination and persistent pause/resume/cancel/stop; verify real subprocess survival, timeout, stop, recovery and duplicate-supervisor behavior and document lifecycle controls.

## 4. Foreground integration checkpoint

- [x] 4.1 Wire automatic admission and separate coverage into successful normal CLI results, preserve previews and opt-out, prefer completed full-history views for default queries, and add observational control commands; verify CLI outcomes and foreground failure isolation, update README and skill guidance, and validate packaging.

## 5. Integrated acceptance checkpoint

- [x] 5.1 Run build/typecheck, full regression tests, focused Node 24/26 checks, an isolated installed-package detached end-to-end scenario, skill validation and strict OpenSpec validation; record actual evidence and platform limitations, update installed guidance with backups, and commit the verified rollout.

Each checkpoint includes its relevant verification before the authorized focused commit. Validate proposed commit messages with the explicitly selected TypeScript zmem and inspect committed output. Preserve unrelated work and the prior rebuild's open platform task. Do not push or archive automatically.

## Verification record

- `e04ef04`: durable queue/configuration; build and three focused queue tests, including twelve concurrent admissions and persistent controls.
- `a98e0eb`: private staged computation; focused segment/effect/budget/hook tests and existing engine tests passed.
- `8b2b57d`: detached runtime; real-process caller exit, bounded timeout, supervisor replacement, duplicate startup and two-worker/service-stop tests passed.
- `0cd5a8f`: CLI integration; eight CLI tests passed, query skill validated, formatting and package inclusion checked.
- Final acceptance corrected timestamped promotion receipts, published the shared complete-view reference and added worker process-tree termination. The new three-location backfill test verifies promotion after two completed locations and zero-computation adoption in a third.

Final Windows verification: all 66 tests passed on Node 26.8.2; all 14 background tests passed on Node 24.22.0. Build/typecheck, formatting, skill validation, eleven relative links and strict OpenSpec validation passed. The installed tarball's engine/worker/skill bytes matched source. A fresh five-commit repository returned initial partial coverage with accepted admission, completed detached backfill, returned all five entries, reused warm state with zero computation, reclaimed staging and stopped the service. Evidence: `C:/Users/ZackaryW/AppData/Local/Temp/zmem-backfill-installed-67crqb3n/evidence-final.json`.

Updated three installed query-skill files after backup to `~/.codex/skill-backups/zmem-background-cbb5820841824c0984bb6085283536f2/`; its manifest records original/replacement hashes. Existing invocation metadata and unrelated files were preserved. No global runtime was replaced. Linux/macOS process lifecycle and large-history performance were not measured in this Windows session; the separate rebuild's platform task remains open. Full ancestry selection can require a longer configured deadline on large histories; failures remain explicit and bounded.
