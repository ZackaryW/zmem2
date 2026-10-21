# Query contract

Use the selected TypeScript CLI throughout. Examples use `zmem`; for a development
checkout substitute `node /absolute/path/to/zmem2/dist/src/cli/main.js`. Use
`--repo PATH` for the target and `--home PATH` for an isolated user store. JSON is
the default; `--human` pretty-prints the same JSON.

## Queries

```console
zmem --repo PATH recall
zmem --repo PATH recall --event DECISION --event LESSON_LEARNT
zmem --repo PATH recall --ref feature/storage --area src/core --scope storage
zmem --repo PATH recall --since 2026-01-01 --min-score 0.5 --limit 20
zmem --repo PATH search "SQLite" --event DECISION
zmem --repo PATH show COMMIT --ref feature/storage
zmem --repo PATH links --min-score 0.5 --limit 20
```

`--since` accepts a Git ref or date. Verify a relative ref exists before using it;
omit it or choose a meaningful date for short history. A Git boundary selects
descendant entries and excludes the boundary commit itself.

- Recall/search omit invalid entries unless `--include-invalid` is requested.
  `recall --events` returns unique types from the selected, filtered results.
- Search matches a case-insensitive literal substring of entry content. It is
  neither regex nor semantic search. Try separate synonyms when needed.
- Recall/search sort by descending commit time, with entry identity as a stable
  tie-breaker. Scores filter candidates; they do not set output order.
- Repeatable `--area` filters are ORed; they combine with the other filters by
  AND. Equal, parent and child paths overlap. Null areas apply globally; `<root>`
  denotes root-level paths. Quote `<root>` in a shell.
- `show` returns commit data, parsed annotations and that commit's entries as
  visible in the selected snapshot. It includes invalid entries. An origin can
  be displayed while its entries fall outside selected attention; that is not
  proof that it never had memory. Avoid a small `--limit` when inspecting it.
- `links` currently supports snapshot/attention selection, `--min-score` and
  `--limit`; it does not implement source/target endpoint filters.

The new CLI has no `--regex`, `--diff-content`, `--trail`, `--timeout-ms`, or
`zmem-svc` command flow. Use Git separately when you need a source diff.

## Coverage and provenance

Recall/search return `results`, `count`, `truncated`, `attention`, `diagnostics`
and `trail`. `trail.head` is the resolved selected head, `trail.id` is the computed
segment identity, and `trail.surface` identifies the effective expansion surface.
No extra flag is needed. Show and links do not return this same trail object;
retain the matching recall response when that provenance matters.

Entries include `sha`, one-based `index`, `type`, `content`, `valid`, `score`,
`commit_time`, `scope`, `affected_areas`, `owner`, `tags`, and `metadata_conflicts`.
Use the actual returned JSON when writing filters. Cancellation, decay and META
appear as their computed outcomes, not extra memory entries.

Two limits have different meanings:

- `truncated` describes matches omitted by the result `--limit`.
- `attention.truncated` and `attention.reached` describe bounded history
  selection. Initial defaults are 64 commits and 400 syntactically valid annotations,
  including supported effects and unsupported types. Selection keeps whole
  commits; ordinary prose does not become a node.

Use `--commit-limit N` and `--node-limit N` to broaden relevant coverage. Their
environment equivalents are `ZMEM_COMMIT_LIMIT` and `ZMEM_NODE_LIMIT`; explicit
flags win. `-1` disables one dimension. With an explicit attention override, unspecified dimensions retain 500-commit / 400-node defaults; the configurable 64-commit startup policy applies only without attention overrides. Reserve unbounded history for a request
that needs it, rather than treating it as the default query mode.

## Availability

The CLI returns foreground results and automatically admits detached backfill;
agents need not manually start a service or wait for background completion.
Responses include `backfill.status`: accepted, already_pending, already_fulfilled,
ineligible, queue_full or failed, with job/state/reason fields as applicable.
`memory_coverage` reports the returned answer's target, completeness and commit
count independently of scheduling. A default query can reuse a completed
full-history view; explicit attention flags/environment limits retain their
bounded meaning. No-bootstrap and no-background are distinct controls.

A query can compute missing state, adopt shared results, or reconstruct evicted
payloads. Compatible warm reads reuse computed outcomes. A failed reconstruction
is an error, not an empty answer or permission to choose another snapshot.

Errors are structured JSON on stderr. Exit 2 means input/configuration failure,
3 a repository failure, 4 computation/storage/internal unavailability, and 5 a
completed unsuccessful proposal check. Read `code` and `message`; diagnose before
retrying. For unavailable source inputs or failed claims, consult
[setup-and-recovery.md](setup-and-recovery.md) when recovery is requested.
