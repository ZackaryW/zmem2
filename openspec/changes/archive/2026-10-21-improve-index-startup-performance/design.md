# Design

## Context

See proposal.md for measured motivation. GitRepo.select currently launches git show for each candidate commit; compilation reads commit metadata again and obtains changed paths separately. Every background invocation repeats full selection. MemoryEngine.computation defaults to 500/400 and upgrades only an exact full-view key. The per-user configuration already owns segment/deadline policy. Existing main specs are empty; implemented contracts remain in unarchived changes.

## Goals / Non-Goals

Goals: implement the accepted 64-commit initial window, remove repeated per-commit metadata process launches, reuse worker selection and compatible complete computed ancestry, and measure the installed result. Preserve merge ordering, annotation/effect identity, explicit attention, immutable snapshots and staging controls.

Non-goals: runtime/language changes, queue redesign, background ref retargeting, larger segment bounds, altered stable promotion, or guaranteed wall-clock latency on arbitrary repositories.

## Decisions

1. Add user `foreground.initial_commits` (positive integer, default 64). In normal engine computation with no explicit attention flags/environment values, use this limit until compatible complete coverage exists. An exact full view or a compatible complete ancestor selects full attention. Explicit limits keep their current dimension defaults (500/400), and check continues using its existing explicit preview defaults. This separates bootstrap policy from deliberate attention and avoids narrowing a completed index after HEAD advances.
2. Reuse complete cross-policy bases only when the full deterministic selected coverage starts with exactly that base's coverage and its attention was not truncated. Surface identity and dependency validation remain mandatory. Divergent/merge ordering that fails this prefix test falls back to correct computation. Existing warm exact views retain their fast path.
3. Read commit metadata in bounded Git batches, preserving Git's decoded message semantics and the current deterministic topological ordering. Cache only a bounded number of metadata records in each GitRepo instance. Changed paths retain existing Git semantics. Avoid replacing selection with a new ordering algorithm unless comparison tests prove the ordering unchanged.
4. Persist the selected header sequence in the private job directory with format version, target fingerprint and checksum. Create it atomically under current ownership; verify compatibility/integrity and shape when reopening it. Supply the loaded selection internally to indexing, with head/attention validation. A malformed/incompatible saved plan is replaced; oversized plans fail against the staging budget. The plan is not a shared computed segment, carries no promotion credit and is removed with successful staging cleanup.
5. Set default background timeout to 90000 ms while preserving explicit configured values, 5000 ms grace, three interrupted attempts, 256 commits/16 MiB segments and two/eight queue limits. Raising the deadline alone was rejected as the complete solution because it leaves startup and repeated selection overhead intact.

## Risks / Trade-offs

- Larger batch output or histories -> bounded metadata batches/cache, existing Git operation limits and finite staging budget; tests include multiline Unicode messages and merges.
- Saved-plan corruption or stale ownership -> target/checksum/shape validation, current-job fencing and atomic publication; test corruption, reuse and storage failure.
- Reusing complete state across attention policies -> require full-history semantics and exact coverage prefix; test old CANCEL, explicit bounded calls and old-snapshot immutability.
- Sixty-four commits need more time than the earlier measured 32 -> report measured pilot timing; do not promise the earlier three-second result.

## Migration Plan

No catalog format change. Missing user settings pick the new defaults; explicit deadlines and attention values remain authoritative. Reconcile unarchived overlapping specs and update guides. Package into the existing isolated runtime, test on fresh pilot clones/home, retain prior evidence and leave the global executable untouched. Rollback restores prior code; private plans are disposable and existing computed segments remain valid.
