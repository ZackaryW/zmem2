# Proposal

## Why

Initial memory operations currently compute a bounded recent selection and never fill older history automatically. A detached, supervised backfill should complete repository memory without holding the caller open or exposing unfinished computation.

## What Changes

- Automatically admit full-history backfill after successful init/sync/recall/search/show/links and return admission status alongside the foreground result.
- Add a durable per-user queue with at most two running workers and eight waiting targets; return accepted, already_pending, already_fulfilled, ineligible, queue_full or failed promptly.
- Run pinned repository targets as sequential, time-bounded segment workers under an on-demand detached supervisor. Keep private construction state until validated publication and resume committed checkpoints.
- Add observational job/service status and persistent pause/resume/cancel/stop controls, worker ownership fencing, deadlines and bounded failure recovery.
- Reuse compatible local/shared results, preserve stability-only central promotion, and expose coverage independently of scheduling status. Completed full-history views become available to ordinary queries while explicit attention limits remain supported.

## Capabilities

### New Capabilities

- `background-backfill`: Durable admission, detached execution, staged computation, monitoring and automatic foreground integration.

### Modified Capabilities

None in the main spec store (currently empty). This change extends the computed-segment and reference contracts in the active rebuild change without changing stable promotion or hook retry authorization.

## Impact

Touches TypeScript CLI/core, user/repository configuration, tests, documentation and packaged agent guidance. Uses Node child processes and SQLite already available in the runtime. No login startup registration, remote service, Rust component or global executable replacement. Preview checks do not enqueue work. Existing Linux/macOS lifecycle evidence remains separate.
