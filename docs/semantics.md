# Computed results, identity, and recovery

Entries use full commit identity and one-based annotation ordinal. Lines mentioning
`zmem(` consume an ordinal even when malformed. DECISION and LESSON_LEARNT start
valid at score 1.0. DECAY multiplies a reachable entry score by a finite factor in
[0,1]; CANCEL targets only earlier reachable DECISION entries and permanently sets
validity false and score zero within that history. Neither effect creates an entry.
Unsupported or rejected annotations produce diagnostics.

META supports `key=value`, `key+=value`, and `key=null` over complete inclusive
ancestry ranges preceding the effect. Keys are affected_areas, owner, and tags;
owner cannot be appended. Metadata cannot overwrite content, type, score, or
validity. Incomparable assignments conflict; a descendant assignment resolves them.
Changed paths supply conservative intrinsic areas: root files become `<root>`,
each top-level folder reduces to its common changed directory, rename sources and
destinations both participate, and more than three areas become null/global.

## Stored computation

Local SQLite catalogs publish immutable JSON payloads with integrity identities.
Each payload owns a bounded range and its changed content-addressed state pages;
it references a computed base and records ancestry-frontier and checkpoint roots.
It does not duplicate the full history prefix. A persistent radix map supports
bounded-depth effective-state lookup. A namespace root separates entries,
relationships, commits, effects, and diagnostics, so a type-specific scan skips
unrelated records. Leaves split by key count and encoded size.
Storage compaction combines already-computed pages rather than executing an action
journal. Different branches and merge contexts cannot blindly union final rows.
Common effects have stable source identities and are counted once.

Repository, base, covered range, effective attention, expansion identity, captured
inputs, and evaluator version identify a result. Different numeric attention limits
that select the same actual state can publish a new view identity referencing the
existing computation. A changed selected window can require different computation;
a narrower view is never reported as complete wider history.

Default payload limits are 256 commits and 16 MiB of owned uncompressed encoded
data, including checkpoints, indexes, provenance, and manifests. Construction
also bounds accumulated encoded pending pages. These byte counts are not a claim
that JavaScript heap usage equals serialized size. Dependencies are accounted for
separately in cache residency. An indivisible oversized result returns
`segment_too_large`; no partial effects are published as that result.

## Central sharing and references

The user catalog observes successful computation at verified locations, counts
the original completion, deduplicates delivery, and qualifies only stable results.
A stable frontier must be reachable from a configured ref/boundary; ref existence
and ancestry are rechecked before publication. Profiles are bounded and expire;
at most 64 recent locations are retained per profile. Per-location high-water
marks reject duplicate or delayed old events. Dropping advisory observations can
delay promotion but cannot change memory or authorize hook retries.
The user catalog records the resolved stable boundary and promotion-policy
fingerprint in the same transaction that makes each adopted payload ready.

Catalog lookup happens before uncovered local work. A claim is never a ready
result. Busy/unavailable central coordination permits independent local work.
Qualified missing shared results use exclusive rebuild claims. Claims whose
owners die are marked failed, and retries require an explicit reset.

Pointer handoff verifies payload/dependency integrity, acquires protection, commits
the local pointer, and then reclaims duplicates once readers release them.
Repeated adoption is idempotent. Unique local tails stay local. Readers lease
their complete dependency closure and expose either one complete result or an
explicit unavailable outcome. Release snapshots in `finally` when using low-level
APIs; ordinary engine queries manage this automatically.

LRU uses actual demand recency and deterministic ties. Production, polling, and
promotion do not refresh demand. Idle references are rebuildable, not permanent
pins. Active read/publication dependencies are protected. If only protected data
remains, capacity pressure is reported rather than deleting active payloads.
Central admission is serialized across processes. Existing dependencies are
leased before space is reclaimed; eviction and unlink share the catalog writer
lock so a new reader cannot lease a file between removal and visibility changes.

Eviction leaves reconstruction descriptors. Demand restores surviving compatible
coverage or recomputes the recorded recipe from Git and compatible inputs. It
verifies the resulting root before publication and skips historical hooks. If
objects or required code are unavailable, recovery reports an error instead of
empty or alternate memory. Payload corruption is detected before use; known
sealed results can be reconstructed and repaired.

## Isolation and restart

Catalog handles are short-lived and SQLite writes are transactional. Decoded
payloads have an eight-item/32-MiB encoded-size LRU. At most eight distinct pending
computations are admitted per engine instance; no worker or watcher remains open
after a query. Local indexes are scoped by platform/architecture. A catalog from
another environment is refused rather than sharing live Windows/WSL locks.
Executable modules use Node's process-lifetime module cache; dispose a library
host process to unload previously imported extension generations. The CLI exits
after its command and does not start a daemon. Captured extension sources and
durable receipts are semantic inputs/state, outside evictable payload accounting.

Publication uses staged, flushed payloads and atomic catalog visibility. Writer
records and leases protect files from recovery cleanup. Restart reclaims orphaned
unpublished files after dead ownership is detected, marks interrupted claims
failed, and preserves hook-delivery records. Temporary protected disk overage is
visible through byte accounting; eviction never acts as retry authorization.

Use an isolated `--home` when recovering or testing. The new `v2` catalog and data
do not open the old `db/entries.db`, execute old Python extension files, or replace
the old service runtime. Rollback selects the old executable and its untouched
state. There is no reverse schema migration.
