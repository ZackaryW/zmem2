# Design

## Context

See proposal.md for motivation and the five capability deltas for observable behavior. Before this change, zmem2 contained repository metadata, a README, OpenSpec configuration, and the source-directory scaffold. The implementation now supplies the unified TypeScript engine, CLI/library, and isolated integration fixtures.

Relevant predecessor evidence:

- `../zmem/src/zmem/ext/expander/__init__.py` provides a typed action context and deterministic registration. Built-ins and `../zmem/openspec/specs/annotation-vocabulary/spec.md` establish entry, DECAY, CANCEL, and META semantics.
- `../zmem-cache/crates/zmem-store/src/lib.rs` combines shared facts, immutable trails, projection overlays, and source-time retention in one user database. The new architecture deliberately replaces this storage ownership and retention model rather than preserving the database format.
- `../zmem-cache/openspec/specs/cache-retention/spec.md` separates speculative usage from durable failure state. Valid recalled memory at `d6c0f6ab`, annotation 3, corroborates that reclamation must not authorize uncertain hook retries.
- `../codegraph/src/directory.ts`, `src/mcp/project-lifecycle.ts`, and `src/mcp/tools.ts` show project-local databases, canonical project identity, writer ownership, shared pending work, and LRU resource release. No existing indexes were available for these repositories during exploration, so findings were checked through source and specifications.
- The old extension discovery hashes absolute paths as well as source bytes. Copying that identity contract would defeat sharing equivalent extensions installed in different locations; zmem2 uses logical package paths and captured semantic dependencies instead.

## Goals / Non-Goals

**Goals:**

- Give CLI and library callers one TypeScript/Node engine and one versioned semantic contract.
- Make computed state reusable without executing historical annotations on a compatible hit.
- Keep local indexing independent, while central sharing eliminates proven recurring compatible work across locations.
- Bound individual segments, shared resident storage, open resources, and advisory tracking separately.
- Make extension behavior reproducible, and storage handoff/eviction recoverable.

**Non-Goals:**

- Preserve the Python/Rust wire protocol, database schema, or automatic Python extension compatibility.
- Eagerly centralize all repositories or interpret frequent cache hits as duplicated computation.
- Ship REORDER, UPSERT, or INSERT merely because they were illustrative examples. The initial DSL covers the approved existing effect primitives; additional functions need explicit contracts.
- Migrate active predecessor data or create Git commits without separate authorization. Incremental commits were explicitly authorized during reconciliation.
- Introduce cross-machine synchronization or a remote sharing service. The central coordinator is within the current user's local profile.

## Decisions

### 1. One runtime and explicit module ownership

Use TypeScript compiled to JavaScript on Node.js. CLI, library entry points, local jobs, and the user coordinator call the same core. A worker process is an internal isolation/lifecycle boundary, not a second separately distributed language interface. This retains CodeGraph's common-engine principle while eliminating the predecessor's coordinated Python/native releases.

The executable remains `zmem`; the implementation package is `zmem2`. The repository lifecycle is `init [path]`, `sync [path]`, and `status [path]`. Explicit initialization preserves existing configuration, creates a missing `.zmem/config.yaml`, ensures `/index/` in `.zmem/.gitignore`, and synchronizes initial committed history. The root `.gitignore` is neither created nor changed, even if it already contains a legacy zmem rule. Existing nested ignore content and newline style are preserved; an existing `/index/` or `index/` rule is not duplicated. Repeated initialization is idempotent. Unborn repositories complete setup and synchronize after their first commit. `index` remains an alias for synchronization. Library callers use the same `MemoryEngine.init()` and `sync()` methods; query semantics and central eligibility are unchanged.

This follows CodeGraph's placement of generated-data ignore rules inside its own directory. Zmem ignores only the index subtree because `.zmem/config.yaml`, `.zmem/extensions/`, and `.zmem/.gitignore` are intended to remain trackable. Existing per-environment ignore guards remain compatible. For the user-authorized pilot migration, remove only the exact root rule created by the earlier pilot after the nested rule is verified; ordinary init never edits root rules automatically.

```text
src/
  cli/          commands, formatting, composition/bootstrap
  core/         contracts, Git selection, computation, stores, sharing policy
  ext/
    dsl/        one supported DSL function per file
    tseam/      TypeScript/JavaScript module loading and expansion context
    builtin/    built-in type definitions and handlers
  utils/        domain-independent reusable mechanics
```

Core owns public operation/context contracts and consumes registered handlers. Extension modules depend on these public contracts rather than storage internals. Bootstrap wires the implementations together; core does not import CLI formatting or discover modules as a side effect of a query. Utilities import no zmem models or configuration conventions. A package root entry file can re-export the core API without creating another subsystem directory.

### 2. Local catalogs with immutable computed payloads

Use a SQLite catalog per location and a separate user-level SQLite catalog. Immutable segment payloads contain computed changes, dependency references, provenance, and indexed lookup pages. Catalog transactions publish references only after payloads and integrity metadata are complete. Local and user stores share the payload schema; adoption copies/verifies existing payloads rather than translating or rerunning effects.

Implemented runtime layout:

```text
<repo>/.zmem/
  .gitignore
  config.yaml
  extensions/<package>/extension.yaml
  extensions/<package>/extension.mjs
  index/<platform>-<arch>/catalog.sqlite
  index/<platform>-<arch>/segments/<payload-id>.json

<user-home>/.zmem/
  config.yaml
  extensions/<installed-package>/<version>/...
  v2/catalog.sqlite
  v2/segments/<payload-id>.json
  v2/extensions/<captured-generation>/...
```

Repository configuration and extension sources are version-controlled; generated indexing data is ignored. The versioned user data subtree does not overwrite the predecessor's `db/entries.db`, runtime, or configuration file. Home relocation remains supported for isolated deployments. Repository policy cannot silently override user-wide resource limits.

Claims, profiles, qualifications, read leases, and durable hook receipts live in catalog tables rather than separate state files. Payload eviction does not remove these tables. Node SQLite uses short-lived synchronous handles with a 250-ms busy bound; no background worker or separate service is required.

A segment has two identities: semantic state/coverage identity and immutable payload integrity identity. Semantic identity covers repository, exact covered commit set and deterministic boundary order, base state, attention, expansion identity, captured inputs, and evaluator version. Payload identity also covers serialization/packing. Repacking calculated results need not claim new semantic computation. Distinct bases or expansion surfaces cannot collide merely because a range label is identical.

Use an indexed persistent state map whose pages reference inherited or overridden entry state. Store the new pages and changes owned by each segment; do not copy the entire historical state into every segment. Reading a key follows the indexed state map, not an unbounded chain of segment overlays. Storage compaction copies computed values and provenance, never executes old annotations. New page formats and serializers must have versioned deterministic encodings and integrity checks.

The initial state map uses a namespace root and SHA-256 radix pages, with leaves bounded by count and encoded size. Payloads retain computed checkpoint roots at whole-commit boundaries. Lowered limits can therefore repartition existing pages without replay. Original sealed generations remain available to active readers; repartitioned manifests receive new boundary identities while preserving values and effect provenance.

### 3. Effects are computed once for a compatible context

Retain the existing closed core operations: create entry, create relationship, decay, cancel, typed metadata patch, and diagnostic. DSL functions and executable handlers emit these operations through a validated context. Handler functions return no result payload and cannot mutate a database directly.

The compiler resolves targets against the computed base, validates ancestry and attention, computes results, and publishes them atomically. Effect provenance and composition summaries remain available for later computation and auditing; they are not an instruction stream that every reader must execute.

Attention identity includes actual selected membership and completeness, not just the numeric limits. A sliding attention window that drops old contributors can change base semantics even when the configured limits stay the same. Reuse only the compatible coverage; construct a new result for an incompatible selection and report its attention explicitly. The no-replay guarantee concerns compatible completed work, not a promise that a different semantic selection can always be answered by appending one commit.

Branch merge computation is new work. It reconciles common ancestry and unique contributions once, using stable effect identities to avoid double application, cancellation state, decay contributions, and ancestry-aware metadata assignment provenance. A merge cannot simply union final branch rows or multiply both parent scores. Restrict new DSL primitives to operations with an explicit composition contract; arbitrary user-defined state reducers are not exposed. Test merge summaries against an isolated reference evaluator before implementing central reuse. Queries of the resulting merge state still perform no historical replay.

Normal proposed-message checks use a compatible computed base and an ephemeral overlay, skip hooks, and discard hypothetical outcomes. Any explicitly requested fresh audit computes in isolation and is not a hidden fallback on ordinary warm reads.

### 4. Explicit extension selection and semantic identity

A manifest defines package identity, version, API version, declared types, and an optional `entry` JavaScript module. Executable entry points export `register(registry)` and register `expand(context)` handlers. Declarative packages need no executable entry point. TypeScript is an authoring language compiled to executable JavaScript; Python/Go hosts are not required.

Repositories explicitly select local paths or pinned user-installed packages. Installation is availability, not global activation. Duplicate registrations, unsupported versions, and implicit overwrites fail deterministically. Repository executable code requires trust before import. Separate external observers from canonical expansion and store side-effect receipts/failures outside evictable cache payloads.

Fingerprint the entire enabled effective surface initially: normalized definitions, compiled module content, dependency closure, configuration, behavior-relevant permissions, and captured inputs. Do not include absolute installation paths unless the extension actually consumes the path as a semantic input. Fingerprinting reads manifests/content without executing register or expand. Unknown dynamic dependencies or uncaptured ambient inputs make the result ineligible for central sharing. A context object by itself is not a JavaScript sandbox; trusted code remains trusted code.

Changing the effective surface selects a new computation generation. Old results retain their identities. Query-time reuse requires an accepted compatible surface; accepting a package source in another location is not automatic execution authorization.

### 5. Repository and location identity

The user registry assigns a repository identity and records verified checkout locations. Linked worktrees can share Git common-directory evidence while retaining distinct location identities. Separate clones require explicit association with that registry identity plus verification of the requested immutable Git objects and ancestry; remote URLs are discovery hints, not sufficient equivalence proof. Until association is established, use separate identities and prefer missing reuse over mixing repositories.

Canonical paths prevent spelling aliases of one checkout from becoming multiple demand locations. Recreated or moved locations must be revalidated. Trust/configuration remain location-sensitive inputs even when repository identity is shared. Each payload includes exact commit coverage; a tag, branch name, path, or textual range alone is never the payload key.

### 6. Two completed computations and an explicit stable boundary

The user's settled default is two total completed computations, including the original, across at least two distinct verified locations. Credit each persisted computation event once. Failed work, retries of the same event, polling, hypothetical checking, storage adoption, and warm queries do not increase the counter. Count exact compatible segment coverage and base; large overlapping requests do not automatically count as duplicate work for unrelated ranges.

Eligibility requires all covered commits to be ancestors of at least one configured stable ref's observed commit or explicit full boundary OID. No ref is assumed by branch name; an empty boundary list permits local indexing but no promotion. Record the observed boundary OID, ancestry proof, and policy generation, then revalidate before central publication. If a ref force-moves and invalidates the proof, abandon or requalify that candidate. Already-published immutable computed data remains semantically valid; ref movement cannot rewrite it.

When a candidate qualifies, prefer adoption of a verified local result. If the result was lost, central computation is permitted only for qualified work and under a recoverable exclusive claim. The coordinator does not scan all repositories to populate the cache. Idle startup does not warm all evicted references.

Proposed user configuration schema:

```yaml
promotion:
  enabled: true
  min_computations: 2
  stable_boundaries: []       # entries associate repository ID with ref or full OID
segments:
  max_commits: 256
  max_bytes: 16777216         # 16 MiB, encoded uncompressed owned payload
cache:
  max_bytes: 1073741824       # 1 GiB initial user-wide residency budget
profiles:
  max_entries: 4096
  retention_days: 30
```

The promotion count, boundary kind, rebuildable reference policy, and requirement for size bounds are user decisions. Numeric size/cache/profile budgets above are conservative, configurable implementation defaults selected for this plan, not claimed benchmark results. Invalid/non-positive bounds fail clearly. Policy changes affect admission and retention, not entry scores or semantic validity.

### 7. Finite segment size without partial commits

Start with 256 newly covered commits and 16 MiB of owned encoded bytes per segment. Account for computed rows, diagnostics, provenance, lookup pages, and manifests before publication; compression must not hide an oversized decoded payload. Referenced dependency bytes are separately charged to residency accounting. A small pointer does not make its required closure free.

Within a fixed base, order covered commits deterministically parent-before-child with full OID ties. Form segments at whole-commit boundaries, closing before the next commit would exceed either bound. Use the same versioned partitioning policy across locations so equivalent bounded requests can match. Query aliases point at resulting segment coverage; range overlap is not permission to cut arbitrary contextual results without proving compatible bases.

If a single commit's computed output cannot fit, report `segment_too_large` with the violated limit and required size when known, preserve prior published data, and publish none of that commit's effects. Bound construction buffers and temporary storage as well as final payload size. Users can explicitly raise configured limits; the engine never silently does so. Lowering bounds blocks new adoption of oversized packs until they are repacked into compliant units; existing identities and active readers are preserved.

### 8. Catalog-first startup and a recoverable handoff

Before scheduling local work, query user coverage by exact compatible identities. Distinguish `claimed`, `building`, `ready`, `evicted`, and `failed`, with `incompatible` and corruption reported by resolution. A claim suppresses duplicate work only while its owner is valid; it never substitutes for a complete result. Bound joining a claim, and fall back to independent local work if central coordination is unavailable. Such duplicate computation is acceptable under outage; false successful availability is not.

For adoption: protect the ready segment and required dependency closure, verify integrity and compatibility, publish the local pointer transactionally, then reclaim duplicate local files only after old local readers drain. Interruption before pointer commit preserves the old local result. Interruption afterwards can leave extra files, which recovery reclaims idempotently. Do not reclaim unrelated local tail data or incompatible surfaces.

Pointers contain semantic identity, payload identity/generation, coverage, and reconstruction dependencies. Do not store a mutable central path as authority. Data transfer uses staged payloads and atomic catalog publication; recovery verifies actual resident files before marking coverage ready.

### 9. LRU can evict referenced payloads

The user selected eviction and rebuilding on demand. Inactive local references do not hold indefinite pins. Reads and handoffs obtain short-lived protection for their full dependency closure; eviction removes only unleased payloads. If closure acquisition races eviction, return to resolution or report bounded unavailability before exposing any rows.

Track actual demand reuse separately from promotion/production. Enforce the finite byte budget with deterministic least-recently-demanded reclamation, including unique dependency payload bytes. When protected data prevents reclamation, stop admitting more payloads or report capacity pressure and temporary overage. Open-handle LRU is a separate resource policy.

An evicted reference remains a reconstruction descriptor. On demand, reuse surviving compatible dependencies and compute missing work locally or through an already-qualified central claim. Missing Git objects or pinned extension inputs yield explicit unavailability. Rebuilding does not rerun historical external hooks, and cache eviction never deletes failed/uncertain side-effect records. Closed result identities remain useful even when payload residency changes.

Advisory profiles and event deduplication are bounded. Tie completion receipts to retained profile generations; expire them together and reject stale replayed events instead of counting an old event as new after deduplication metadata was removed. Losing profiles only reduces promotion. Durable failure and side-effect state has a separate lifecycle and is not LRU demand metadata.

### 10. Reusable utility plan

Use `src/utils` only for portable mechanics. Domain identity encoding, stable-history qualification, annotation parsing, effect algebra, and cache policy stay with their application owners. Implement and verify each helper before integrating the callers that depend on it.

**Fingerprinting:** `fingerprint(parts: readonly Uint8Array[]): string` produces a SHA-256 hex digest over a versioned length-framed ordered byte sequence. Empty parts are represented, ordering matters, and no filesystem or application configuration is read. Another use is identifying build artifacts. Reuse Node `createHash('sha256')`; the custom gap is unambiguous component framing, not a new hash algorithm. Verify fixed vectors, repeatability, empty values, differing order, and `[ab,c]` versus `[a,bc]`. Core/tseam supply normalized logical fields and content; the helper does not decide whether paths or trust belong in an identity. Source: https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options.

**Shared pending work:** `createSingleFlight<K,V>({maxPending}).run(key, work): Promise<V>` uses an in-process Map of pending promises. Existing keys join one result/failure; distinct keys beyond the positive bound fail with an explicit capacity outcome; settled promises are removed. It performs no automatic retries, caches no completed values, and does not undo callback effects. Another use is duplicate HTTP fetch suppression. A small Map/Promise implementation is sufficient for this contract, following the shared-gate pattern inspected in CodeGraph rather than adding a completed-result cache dependency. Verify shared success/rejection, independent keys, synchronous throw cleanup, capacity, and later explicit re-execution. Cancellation of one waiter must not silently cancel shared work. Core owns execution lifetime, durable claim ownership, and failed-job retry authorization; this helper is not a cross-process lock.

**Direct reuse rather than another helper:** Evaluate `lru-cache` for bounded in-memory containers; its documented `max`, `maxSize`, `sizeCalculation`, and disposal hooks already cover ordinary value residency. It does not implement persistent segment graph reclamation or active-reader leases. Pin a compatible supported release and inspect its license/Node requirements during package setup. Reuse Node filesystem/path/crypto APIs directly when no extra contract is needed. Source: https://isaacs.github.io/node-lru-cache/.

**Immutable plain data:** `freezeData<T>(value: T): T` recursively freezes plain objects and arrays in place, preserving shared/cyclic references with a WeakSet. Non-data objects are rejected because shallow Object.freeze cannot protect their internal mutation. Cached API JSON is an independent reuse case. Verify nested mutation, cycles, shared references, and unsupported object rejection before using it for decoded packs and extension context data. It does not clone, validate application fields, or promise a compile-time readonly type.

The selected pinned dependencies and their licenses/APIs are recorded in docs/development.md and package-lock.json. No new utility package is published and no filesystem helper is invented in advance of an actual missing contract. Filesystem and process lifecycle correctness belongs in isolated integration tests with real temporary repositories and observed persistent outcomes.

## Risks / Trade-offs

- [Computed summaries can hide merge mistakes] -> Verify common-ancestor deduplication, branch-only cancellation, META conflict resolution, and cross-segment effects against a small isolated evaluator; never claim final-row union is sufficient.
- [A single commit can exceed every useful bound] -> Fail explicitly without partial effects, expose the configured limit, and require an explicit higher bound rather than unbounded publication.
- [Small overlays can have large dependency closures] -> Account unique resident dependencies, lease the closure for reads, and use indexed persistent state maps/compaction without historical handler execution.
- [Evicted data may not be rebuildable after Git garbage collection or extension removal] -> Retain reconstruction identities and return an explicit missing-input result; availability is not promised after the underlying sources disappear.
- [Extension code can observe ambient state] -> Require captured dependencies for central eligibility, keep unknown behavior local, and distinguish a trusted execution seam from a sandbox.
- [Counter inflation or replayed completion events] -> Deduplicate event IDs within bounded profile generations and exclude reads, polling, adoption, and hypothetical work.
- [Coordinator outage permits duplicated local work] -> Preserve local availability with bounded lookup/join waits and accept duplication instead of requiring a permanent central service.
- [SQLite and process ownership differ across hosts] -> Keep local catalogs environment-scoped, verify Windows behavior, and never share writer locks or live SQLite handles across incompatible Windows/WSL runtimes.

## Migration Plan

1. Build zmem2 with isolated local/user data roots and a single package/runtime. Leave both predecessor repositories and active services unchanged.
2. Verify the existing annotation corpus and command outcomes using fixtures; explicitly document changed installation, configuration, and extension APIs. Port extensions to declarative or JavaScript packages rather than executing old Python files implicitly.
3. Rebuild derived state from Git into the new schema. Do not open or mutate the predecessor database with the new writer. Rebuilding canonical state never imports an assumption that external hooks should run again.
4. Exercise local-only indexing first, then two-location promotion, pointer handoff, LRU eviction, and on-demand recovery using temporary roots and the same extension identity.
5. Validate the packaged CLI/library and documented startup flow before opting real repositories into the new runtime. Rollback selects the previous runtime and its untouched data; no reverse schema migration is needed.

## Open Questions

- Node 24 and 26 are the selected runtime lines. Windows execution has been verified locally; Linux/macOS verification is assigned to the committed CI matrix and remains pending until it runs.
- Additional DSL functions beyond the established core operations require a separate explicit semantic decision. No placeholder implementation for the illustrative REORDER/UPSERT/INSERT examples is included in this change.
- Benchmark evidence can tune the configurable size/residency/profile defaults in a follow-up; their finite-bound behavior and the selected promotion/stability/eviction rules are settled here.
