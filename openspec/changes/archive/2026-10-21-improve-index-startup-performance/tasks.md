# Tasks

## 1. Startup policy and complete coverage

- [x] 1.1 Implement configurable 64-commit foreground startup, complete-base reuse and 90-second default deadline; reconcile overlapping specs and guides; verify fresh/default/explicit/configured limits, complete ancestor extension, cancellation and old snapshots with focused tests before checkpointing.

## 2. History access and worker continuation

- [x] 2.1 Batch bounded Git metadata reads and verify semantic equivalence for multiline Unicode messages, merges, ordering and attention boundaries, including a bounded process-count regression check; document and checkpoint the verified access layer.
- [x] 2.2 Persist and reuse pinned private selection plans within the staging budget; verify replacement-worker reuse, corruption recovery, incompatible inputs, budget exhaustion and successful cleanup; document and checkpoint worker integration.

## 3. Installed integration and pilot

- [x] 3.1 Run required build/typecheck/format/spec checks, the full Windows suite and focused Node 24 tests; package into the isolated pilot runtime and rerun fresh 64-commit startup, default backfill, warm reuse and incremental cancellation against the large pilot; record measured results and limitations, validate commit messages, and leave owned services stopped or idle.

## Evidence

Checkpoints: `03538e0` startup policy/complete reuse, `41bc669` batched metadata, `8692093` persisted worker plans and private claim recovery. All 75 tests passed on Windows Node 26.8.2; all 23 focused tests passed on Windows Node 24.22.0. Typecheck, formatting, strict spec validation and installed query-skill validation passed.

The installed 546-commit pilot returned 64 commits in 2.59 s, completed default backfill in 27.43 s without retries, reused warm full memory in 0.462 s with zero computation, and computed a single new old-target cancellation in 3.15 s with default complete attention. The original snapshot stayed unchanged; the saved plan was reused across three workers; staging was reclaimed and the isolated test service stopped. Evidence: `~/.zmem-pilots/test-pilot/performance-64-e1636e6a/evidence/summary.json`. These are single-run Windows measurements; Linux/macOS remain unexecuted in this session. No change was archived.
