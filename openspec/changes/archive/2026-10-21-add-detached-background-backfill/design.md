# Design

## Context

See proposal.md for motivation. `MemoryEngine.index` selects bounded history, builds deterministic whole-commit segments and publishes a view only after the target is complete. Catalog claims are process-owned and interrupted work currently becomes a durable failure. There is no background runtime. Existing SQLite catalogs, immutable payloads, leases, hook receipts and shared adoption remain the computation foundation.

## Goals / Non-Goals

**Goals:** Detached bounded execution, prompt durable admission, accurate coverage, private staging, resumable sealed segments, persistent controls and observable failures.

**Non-Goals:** OS login integration, remote control, changes to extension APIs, unlimited local storage, automatic retries of uncertain hooks, or modifying the previous change's platform completion evidence.

## Decisions

1. A separate versioned SQLite control database under the selected user home stores logical targets and supervisor ownership. Transactions enforce two running targets and eight waiting targets, deduplicate before capacity checks, and acknowledge only committed admission. Queue entries describe pinned repository location/identity, commit, surface, engine version and segment bounds; they do not contain every future segment. Paused/cancelled/failed targets reject automatic reactivation until an explicit resume. Monitoring opens an existing database read-only and never constructs an engine.
2. An on-demand hidden detached Node supervisor uses the same packaged runtime. It polls the durable queue, launches at most two child workers, tracks owned child processes and deadlines, and exits when idle. A singleton lease/nonce and generation-fenced jobs reject obsolete publication. Workers check the lease between bounded operations. Stop persists a disabled service state, pauses active jobs, and terminates owned workers; start explicitly re-enables dispatch. No shell-built worker commands or public TCP listener are needed.
3. Each worker executes at most one sealed segment before returning its slot. Defaults (reconciled by improve-index-startup-performance) are a 90-second worker timeout, five-second termination grace, three interrupted attempts without progress and a 512-MiB per-target staging budget; finite positive user configuration controls these values. Segmentation depends on commit/byte bounds, never elapsed time. A killed worker resumes from sealed checkpoints; an indivisible operation repeatedly exceeding its deadline becomes a visible failure rather than spinning forever. Soft cancellation is checked between commits; forced termination handles stuck code. Worker continuations remain attached to their logical request and cannot exceed waiting capacity.
4. Construction uses a private catalog below the repository's ignored platform index. Workers pin the requested commit and effective expansion surface and use full-history attention. They adopt compatible local/shared bases, compute oldest-to-newest, and stage results without dispatching hooks or counting provisional promotion receipts. Complete validated segments are imported under current ownership; the complete full-history view is published atomically only when its target is covered. Promotion receipts use stable job/segment identities and obey existing stable-boundary eligibility. Hook receipts remain authoritative; background publication never clears failed/uncertain hooks.
5. Ordinary CLI init/sync/recall/search/show/links finish foreground work, admit backfill and return `backfill` plus `memory_coverage` without replacing existing result fields. `--no-background`, user/repository background disablement, paused targets, service stop, unborn history and preview checks produce explicit ineligibility. Queue or launch failure does not discard a successful foreground result. A complete compatible local/shared view gives already_fulfilled before capacity is considered. Fulfilled but later evicted coverage is reconstructed only on actual demand, not by an idle queue.
6. Default foreground operations prefer an already published complete full-history view. Explicit attention limits retain bounded semantics and remain visible in the result. Backfill state is independent of answer coverage. Full materialization does not falsely label a deliberately bounded result complete. Changed refs/configuration never retarget a running job silently.
7. `jobs`, `backfill status/pause/resume/cancel`, and `service status/start/stop` expose lifecycle controls. Status is observational; pause/cancel preserve committed results. No-bootstrap remains an agent instruction; `--no-background` controls scheduling only and is not a read-only engine switch.

## Risks / Trade-offs

- Session-bound nondeterministic extension surfaces cannot preserve identity across replacement workers: return explicit ineligibility while retaining foreground support. Deterministic captured surfaces remain eligible even without stable promotion boundaries.

- Initial full ancestry selection still scans Git history; improve-index-startup-performance batches metadata reads and reuses a pinned selection between workers. Finite deadlines and explicit timeout failures continue to bound work. The original background change did not claim large-history throughput improvements; the later change records its own measurements.
- Full-history state may differ from the recent preview: publish a separate complete view, retain old immutable readers and report coverage.
- A worker can be stopped during extension execution: retry only staged computation under existing declared execution trust; never reset external-hook receipts. Supervisor termination uses processes it owns rather than blindly killing a persisted PID.
- Cross-process race and crash behavior: use real child-process tests, queue transactions and publication fencing; report actual platform coverage separately.

## Migration Plan

Add the control database independently of existing memory catalogs. Ship the supervisor and worker in the same npm package; no global service installation is required. Disable background scheduling and stop the service to roll back execution while preserving foreground operation and completed segments. Validate each implementation checkpoint and commit within existing authorization. Finish with an isolated packaged end-to-end backfill and updated agent guidance.
