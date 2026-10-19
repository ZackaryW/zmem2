# Core storage contracts

The internal core layer defines typed operations and errors, validated repository
and user policy, live Git selection, immutable state pages, and the SQLite
catalog. It depends on portable helpers and does not require the CLI or public
engine. Verify this boundary with `node --test dist/tests/primitives.test.js`
after building.

`StateMap` stores content-addressed namespace/radix pages and applies changes by
copying paths. An inherited key lookup follows its hashed index rather than a
history of overlays. Namespace scans skip unrelated records. Retained roots
preserve whole-commit computed checkpoints for later repartitioning.

`Catalog` seals immutable encoded payloads with integrity identities, publishes
their catalog rows transactionally after staging/flushing files, and bounds
payload bytes. Database handles close after every operation. Read leases protect
resident payloads from eviction until released; callers own closure acquisition.
Eviction retains descriptors, failures, and hook-attempt receipts. Reopening
recovers dead ownership and orphan files without authorizing failed hooks again.

Catalog versions and platform/architecture ownership are checked on open.
Configuration parsing and policy validation happen before computation. Repository
policy selects behavior while user policy owns shared resource limits. Git
selection resolves live refs, preserves whole commits, and reports attention.
