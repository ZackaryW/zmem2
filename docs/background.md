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
