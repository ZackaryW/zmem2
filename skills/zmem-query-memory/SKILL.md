---
name: zmem-query-memory
description: Retrieve computed zmem repository memory when investigating prior decisions, constraints, lessons, or superseded choices, and verify its applicability against current repository evidence.
---

# Query zmem memory

Use memory to recover recorded rationale and lessons. Its effective score, validity,
and metadata are already computed; do not reconstruct cancellation or decay from
raw commit prose. Current code, tests, and specifications still determine whether
a remembered decision applies.

## Select the runtime

These instructions target the TypeScript/Node engine. Inspect the executable
location, `zmem --version`, and `zmem --help` once per selected installation. Its
help includes `init`, `sync`, and `check --file PATH | --stdin`. The command name
or version alone does not identify the engine. If the selected binary is the old
Python/service product, report that mismatch and use an explicitly selected new
executable if available. Do not replace PATH or migrate data to answer a query.

## Bootstrap missing memory

When memory is relevant and the repository index is missing, run `zmem init PATH`
with the selected runtime, home and snapshot/attention options, then continue the
query. This is encouraged by default and needs no separate permission request.
Read [setup-and-recovery.md](references/setup-and-recovery.md) for this path.
A missing index alone is not a reason to skip memory and fall back to Git.

Honor an explicit user instruction not to bootstrap until the user changes it.
Do not evade it through a cold query, check or status call: these can create
state too. Use available repository evidence when the operation would bootstrap,
and explain that computed memory was not checked. If init fails, report its
error and continue with available evidence; do not loop on the same failure.

## Retrieve and interpret

1. Identify the repository and intended snapshot (`--ref` when different from
   HEAD). Read [query-contract.md](references/query-contract.md) for exact options
   and response fields before constructing queries.
2. Start with bounded `recall`, adding event, scope, area, or a known recency
   boundary when relevant. Do not assume `HEAD~50` exists in a short repository.
   Use `recall --events` only when the available vocabulary is unclear.
3. Use `search "literal terms"` for topical matching. Results are newest-first,
   not ranked by semantic relevance; gather enough candidates before applying a
   small result limit. Prefer direct relevance, snapshot applicability and area
   overlap, then effective score and recency.
4. Inspect useful origins with `show COMMIT` under the same selected snapshot;
   use `links` when relationships matter. Check attention coverage, diagnostics,
   and result truncation before concluding that memory is absent or complete.
5. Report the relevant SHA/annotation index and any material coverage limit or
   conflict with current evidence. Invalid entries are historical evidence only.

Normal CLI results include `backfill` admission status and `memory_coverage`.
Automatic admission needs no separate agent command. Return the available memory
and scheduling outcome together; queued/running work does not make partial
coverage complete. Do not loop on `queue_full`, `ineligible` or `failed`.
Honor a user no-background instruction with `--no-background`; it does not make
foreground queries read-only. `jobs`, `backfill status` and `service status` are
observational and do not bootstrap. Use the setup reference for lifecycle controls.

Queries may build missing derived state. They are not a request to change user
policy, grant extension trust, associate repositories, or retry external hooks.
If the engine is unavailable, say so and continue with current repository/Git
evidence without claiming memory validation.

For automatic or requested initialization, promotion diagnosis, eviction, or recovery, read
[setup-and-recovery.md](references/setup-and-recovery.md). Ordinary retrieval does
not require that reference. Commit authoring and extension development have their
own skills: `zmem-author-commits` and `zmem-design-extensions`.
