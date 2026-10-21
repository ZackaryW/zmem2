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

User `background` configuration defaults to enabled, a 30000-ms worker deadline,
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
