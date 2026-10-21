# Background backfill

The per-user control database is separate from memory catalogs, under
`HOME/background/control.sqlite`. Admission is a short durable transaction. It
returns `accepted`, `already_pending`, `already_fulfilled`, `ineligible`,
`queue_full`, or `failed`. Equivalent requests are checked before queue capacity.
There are at most two active targets and eight waiting targets. A target owns its
sequential segment continuation; it does not enqueue every future segment.

Pause, cancel and failure persist until explicit resume. Stopping the service
pauses queued/active work and prevents automatic dispatch until explicit start.
An ownership token fences publication after pause, cancellation or replacement.
Status reads existing control state without initializing a repository or service.

User `background` configuration defaults to enabled, a 90000-ms worker deadline,
5000-ms termination grace, three interrupted attempts without progress and a
536870912-byte per-target staging budget. A repository can set
`background: { enabled: false }` without changing its extension surface.

Workers build full-history state below `.zmem/index/PLATFORM-ARCH/backfill/JOB`.
Each invocation seals at most one new deterministic segment. A replacement
worker reuses sealed checkpoints; unsealed work can be repeated. Segment
boundaries do not depend on worker time limits. Repeated timeouts without sealed
progress become a visible failure that may require a longer configured deadline.

Private construction skips hook delivery and promotion receipts. Once the target
is complete, its verified dependency closure is imported and the full view is
published atomically. Stable promotion and durable hook receipts then apply;
failed or uncertain hooks are not reset. Successful publication reclaims private
staging. Old foreground snapshots remain usable throughout construction.

Session-bound, nondeterministic extension surfaces are ineligible for detached
backfill because replacement workers cannot reproduce their evaluation identity.
Foreground indexing remains available for those surfaces.

The detached supervisor starts on demand using the current Node executable and
packaged worker scripts, with hidden windows and no inherited terminal handles.
Each worker has an independent watchdog outside its computation thread. It asks
computation to stop at the deadline, then terminates its process after the grace
period if necessary. This also prevents a stuck extension from blocking timeout
handling. Worker ownership is checked during computation and publication.

The supervisor retains a running target's slot across sequential segment workers;
other repositories can use the second slot. Completed/paused/cancelled targets
release capacity. Idle shutdown and admission coordinate through the same durable
database so a request cannot be lost during shutdown. Reopening a paused job or
starting a stopped service does not implicitly resume paused targets.

## Foreground responses and control

Normal CLI init/sync/index/recall/search/show/links attach `backfill` admission and
`memory_coverage: { target_commit, complete, commits }`. Coverage describes the
returned snapshot, not the queue. Failed admission preserves a successful
foreground result. If dispatcher launch fails after durable admission, its job ID
is retained and the reason says so; it can be inspected and dispatched later.

Default foreground queries use an already published full-history view. Explicit
attention flags or environment limits still select bounded history. Background
targets always pin a concrete commit and full-history attention. Low-level library
`MemoryEngine` calls remain computation-only; library callers can use exported
`withBackfill` to attach the same admission behavior to completed real operations.
Do not attach it to hypothetical checks.

`zmem jobs`, `zmem backfill status` and `zmem service status` only observe control
state. `backfill pause/resume/cancel JOB_ID` controls one durable target. `service
stop` pauses pending/active targets; `service start` enables dispatch without
resuming them. `--no-background` disables admission for a foreground call, not
foreground computation or existing background work. Policy opt-out is available
in user and repository configuration. Automatic admissions never resume paused,
cancelled or failed targets.

A Windows pilot with 546 commits exceeded the prior 30-second default deadline before
its first 256-commit segment sealed. Explicit resume with a 90-second deadline
completed all three segments; the pilot configuration was then restored. See
[verification evidence](verification.md#large-history-pilot-and-default-timeout-limitation).
The default foreground window also took 35.6 seconds in that run. Detached
execution bounds worker lifetime; it does not by itself guarantee fast initial
responses or sufficient time to seal a segment.

Fresh normal memory requests use at most 64 commits and 400 annotations before
returning their result and automatic admission status. Configure the initial
commit window in the user config:

```yaml
foreground:
  initial_commits: 64
background:
  timeout_ms: 90000
```

Compatible complete coverage takes precedence over the initial window, including
extension to a descendant head. Explicit attention flags/environment values
retain their dimension defaults of 500 commits and 400 nodes and override this
automatic policy. Preview checks retain their existing 500/400 defaults. A complete
base is reused only when its coverage is a compatible prefix of the requested
history; divergent history follows ordinary correct recomputation.

Git selection now reads metadata in batches of at most 64 resolved commits,
retaining Git's own decoding and merge-parent semantics. The process-local metadata
cache is bounded to 256 records and 8 MiB. Construction reuses/prefetches those
records while changed-path queries retain existing behavior. Tests compare
multiline Unicode and unusual raw-message decoding with individual Git reads,
preserve deterministic merge ordering, and require only two metadata processes
for a 70-commit selection. This does not change computed-segment identities.
