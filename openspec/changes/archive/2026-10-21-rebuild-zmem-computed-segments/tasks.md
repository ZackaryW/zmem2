# Tasks

## Archive status

Archived on 2026-10-21 with user approval at 48/49 completed tasks. Task 9.4 remains unchecked: Linux/macOS lifecycle verification has not been executed. Archiving does not represent completion of that verification; the change can be reopened to resume it.

## Checkpoint protocol and reconciliation record

The original implementation was verified in a combined working tree without a
complete incremental checkpoint record. These commits reconcile that existing
work now; they do not claim that the missing earlier checkpoints occurred.
Task checkboxes describe implementation/verification state, not historical
commit boundaries. Existing task IDs are preserved; task 10.5 was reopened for
the user-requested nested-ignore refinement, with rollout tracked by task 10.6.

Each checkpoint depends on the preceding one and includes its implementation,
focused tests, and owned documentation. Review the staged paths/diff and verify
an exported staged snapshot before committing. Validate the focused message
with zmem, create the authorized commit, and report its result before dependent
work continues. Use the full suite for integration or cross-cutting changes;
do not repeat it for a trivial edit without a new verification need. Preserve
unrelated work and never stage generated indexes, build output, or archives.

| Checkpoint | Scope and owned documentation | Verification and commit record |
| --- | --- | --- |
| R1 | Package/build foundation, portable helpers, helper tests, `docs/helpers.md` | `0155dc1`; clean install, typecheck, four utility tests, formatting; fixed LF checkout consistency |
| R2 | Core contracts/configuration, Git selection, state pages/catalog, focused primitive tests, storage documentation | `c312595`; staged-snapshot build, five focused primitive/storage tests, formatting |
| R3 | Annotation compiler, built-ins, DSL and module seam, focused computation tests, extension/computation documentation | `04058d3`; staged-snapshot build, two focused compiler/surface tests, formatting |
| R4 | Coordinator, engine, public exports, `zmem` CLI, integration tests and user documentation | `0f544d7`; staged-snapshot typecheck, 51 tests on Windows Node 24/26, formatting, isolated package/library/extension and installed `zmem` checks |
| R5 | CI, benchmark/report, OpenSpec artifacts and this reconciliation record | Recorded by `docs: reconcile verified checkpoints and acceptance evidence`; final staged-snapshot formatting, benchmark execution, strict OpenSpec validation and scope review; task 9.4 remains open |

The user explicitly authorized incremental commits during this reconciliation.
Linux/macOS lifecycle execution remains open in task 9.4. Archive cleanup applies
only after a successful archive; this change has not been archived.

## 1. Source structure and package foundation

- [x] 1.1 Scaffold `src/cli`, `src/core`, `src/ext/dsl`, `src/ext/tseam`, `src/ext/builtin`, and `src/utils` with tracked placeholders; verify all six leaf directories exist and no illustrative DSL implementations were created.
- [x] 1.2 Establish one TypeScript/Node package, supported runtime version, library export, CLI entry, build/typecheck/test commands, and lockfile; verify a clean install, build, typecheck, and packaged entry-point smoke run under the declared runtime.
- [x] 1.3 Select and pin dependencies for SQLite, configuration validation/parsing, and optional in-memory LRU by inspecting their supported APIs, runtime compatibility, licenses, and packaging costs; record direct reuse versus adapters and verify imports from the built package.
- [x] 1.4 Update generated-data ignores and document the one-runtime source boundaries and isolated development roots; verify extension/configuration sources remain trackable while generated local indexes and build output are ignored.

## 2. Portable helpers before dependent application code

- [x] 2.1 Implement the framed byte-sequence fingerprint helper using Node crypto and document its encoding; verify domain-neutral fixed vectors, empty components, order sensitivity, repeatability, and ambiguous concatenation cases.
- [x] 2.2 Implement bounded in-process single-flight work with no settled-result cache or automatic retry; verify joined success/failure, synchronous throws, distinct-key capacity, cleanup, and explicit subsequent execution using domain-neutral callbacks.
- [x] 2.3 Integrate a standard in-memory LRU container directly if needed, keeping persistent eviction out of utils; verify its selected count/size bounds and disposal behavior with plain values and document why it is not a cross-process lease manager.

- [x] 2.4 Implement recursive plain-data freezing for immutable cached values and context data; verify nested mutation protection, shared/cyclic references, and unsupported mutable objects with domain-neutral fixtures.

## 3. Repository identity, configuration, and semantic contracts

- [x] 3.1 Define typed operation, entry, relationship, diagnostic, selected-history, computed-state, and error contracts in core; verify serialization round trips and rejection of malformed/version-incompatible values without importing extension loaders.
- [x] 3.2 Implement canonical location registration, Git common-directory handling, and explicit verified association of separate clones; verify path aliases do not count as different locations, worktrees remain distinct locations, and remote URL equality alone cannot merge repositories.
- [x] 3.3 Implement repository/user configuration with explicit extension selection, stable boundaries, default two total computations, and finite segment/cache/profile limits; verify precedence, invalid values, missing boundaries, and home overrides, and document runnable configuration examples.
- [x] 3.4 Implement live ref resolution, observed-OID race detection, whole-commit attention selection, and exact membership identity; verify detached refs, moving refs, annotation limits, and sliding windows with temporary Git repositories.

## 4. Extension seam, built-ins, and initial DSL surface

- [x] 4.1 Implement declarative manifests and simple entry types under ext/builtin; verify DECISION, LESSON_LEARNT, and a fixture-only custom RISK type, including invalid definitions and annotation ordinals.
- [x] 4.2 Implement trusted module loading under ext/tseam with `register(registry)` and void expansion handlers; verify trust refusal before import, API/version validation, duplicate registration, and no direct storage access through the context, and document an executable module example.
- [x] 4.3 Implement the approved core-operation DSL adapters with one function per file under ext/dsl and a documented inventory; verify equivalent declarative/JavaScript operations produce the same typed operations and unknown functions fail without inventing REORDER/UPSERT/INSERT semantics.
- [x] 4.4 Implement resolved expansion fingerprints over logical package content, dependencies, configuration, and captured inputs; verify identical local/user installations share identity, changed inputs separate identity, and uncaptured dynamic behavior is not centrally eligible.
- [x] 4.5 Implement side-effect dispatch records separately from canonical expansion and make preview execution skip hooks; verify failures/uncertain completion persist across restart and are not retried by reads, copies, or cache cleanup, and document explicit recovery behavior.

## 5. Computed effects and merge correctness

- [x] 5.1 Implement entry/relationship creation, diagnostic handling, target resolution, and DECAY/CANCEL computation against an explicit base; verify scores, cancellation monotonicity, invalid targets, and cross-boundary target access with focused fixtures.
- [x] 5.2 Implement typed META range operations and intrinsic affected-area derivation; verify complete-range atomicity, rename endpoints, root/global areas, descendant precedence, and concurrent conflicts, and document the resulting metadata contract.
- [x] 5.3 Implement effect provenance and merge-composition summaries for the closed operation set; verify against an isolated small-history evaluator that common decay is counted once, branch-only cancellation stays isolated, and META conflicts resolve correctly before central reuse is integrated.
- [x] 5.4 Implement semantic computation identities including selected membership, boundaries, base, expansion surface, and evaluator version; verify equivalent contexts match while changed bases, attention membership, or extension behavior cannot reuse results.

## 6. Bounded local computed storage

- [x] 6.1 Implement the local SQLite catalog and immutable payload publication with staging, integrity metadata, and writer ownership; verify real-filesystem crash/restart fixtures never expose partial ready segments and document storage/recovery layout.
- [x] 6.2 Implement indexed inherited state pages and local queries without operation replay; verify historical expander/effect counters remain unchanged on warm reads and lookup behavior does not devolve into a linear overlay walk as segment count grows.
- [x] 6.3 Implement deterministic whole-commit segmentation with the default 256-commit and 16-MiB owned-payload limits; verify exact boundaries, byte accounting including metadata/indexes, and consistent partitions for equivalent inputs across locations.
- [x] 6.4 Implement bounded construction buffers and indivisible-result rejection; verify an oversized single commit produces `segment_too_large`, publishes no partial effects, and leaves prior state available under its original identity.
- [x] 6.5 Implement computed-data compaction and compliant repacking after limits change; verify values/provenance remain identical, no historical handlers run, active readers survive, and no new payload silently exceeds configured bounds.

## 7. User catalog and qualified promotion

- [x] 7.1 Implement the separate versioned user catalog, bounded completion profiles, and idempotent computation receipts; verify duplicate delivery, expiry/generation replay, profile capacity, restart, and exclusion of hits/polling/previews/adoption from counters.
- [x] 7.2 Implement eligibility requiring two total compatible completions across at least two verified locations by default; verify alternative positive thresholds and incompatible expansion/base histories, and document the first-computation counting rule.
- [x] 7.3 Implement stable-ref or explicit-boundary ancestry qualification with prepublication revalidation; verify no configured boundary, an active tail, missing refs, and force-moved refs fail closed for promotion while local indexing continues.
- [x] 7.4 Implement qualified adoption of existing computed payloads and exclusive recoverable central computation claims when payloads are absent; verify promotion after the second completion does not execute a third computation or rerun hooks.
- [x] 7.5 Implement bounded catalog lookup/join and independent local fallback during coordinator outage; verify unfinished claims are never reported as ready and dead ownership is recovered without authorizing uncertain side effects.

## 8. Local reference adoption and recovery

- [x] 8.1 Consult central coverage before scheduling local indexing at startup and for uncovered work; verify a third compatible location creates references with zero recomputation while incompatible or unqualified work stays local.
- [x] 8.2 Implement dependency-closure protection, integrity checks, atomic local-pointer publication, and deferred duplicate reclamation; verify crashes before/after pointer publication, active local readers, and preservation of unique local tails with real temporary stores.
- [x] 8.3 Implement immutable pointer resolution and explicit ready/pending/evicted/incompatible/failed outcomes; verify corruption or central generation changes cannot silently substitute results, and document status/error reporting.
- [x] 8.4 Implement on-demand reconstruction from surviving compatible coverage and pinned semantic inputs; verify eviction triggers recovery only on demand, missing Git/extension inputs return explicit unavailability, and rebuilt results match their original semantic identity.

## 9. Persistent LRU and resource lifecycle

- [x] 9.1 Implement byte-accounted persistent LRU using real demand recency and deterministic ties; verify shared dependencies are counted once, idle pointers do not pin forever, and production/promotion/polling do not refresh demand age.
- [x] 9.2 Implement dependency-closure read leases, handoff protection, and capacity-pressure admission; verify concurrent eviction cannot expose partial results and protected-only overage pauses admission with explicit status.
- [x] 9.3 Implement crash recovery and stale-lease/claim reconciliation without expiring durable failure or side-effect receipts; verify restart fixtures preserve failed-job authorization and do not eagerly warm all evicted references.
- [ ] 9.4 Bound open catalogs, workers, and handles independently of disk LRU and document the lifecycle; verify idle release, active-operation protection, and repeated open/close behavior on Windows and supported additional platforms.

## 10. Public operations and pre-author checking

- [x] 10.1 Implement recall/search/show/links through the common engine with filters, provenance, attention, and invalid-entry selection; verify CLI/library semantic parity, branch isolation, and explicit pending/unavailable outcomes, and document examples.
- [x] 10.2 Implement proposed-message checking against an ephemeral computed-base overlay with before/after effect reports and opt-in message policies; verify no Git mutation, hypothetical persistence, promotion credit, or hook dispatch.
- [x] 10.3 Implement any retained explicit fresh-audit option as isolated opt-in computation, distinct from default warm checks; verify normal checks do not replay their base and document the audit cost and isolation behavior.
- [x] 10.4 Wire unified CLI initialization/indexing/configuration/status commands and JSON/human output, including stable boundaries, repository association, size limits, and recovery; verify the documented end-to-end commands in an isolated user home without the predecessor service.
- [x] 10.5 Align repository lifecycle with `init [path]`, `sync [path]`, and `status [path]`; initialize config and `/index/` inside `.zmem/.gitignore` while leaving root ignore files absent or byte-for-byte unchanged, preserve nested custom content/newlines and equivalent rules, retain initial/incremental/no-op sync and the index alias, and verify real Git ignore behavior for all platform indexes plus trackable configuration/extensions on committed and unborn repositories.
- [x] 10.6 Update setup documentation and the installed query-skill reference; rebuild the package and isolated pilot runtime, migrate only the pilot's known generated root rule into the nested file, and verify repeat init, Git ignore provenance, unchanged memory and warm reuse before committing rollout evidence.

## 11. Packaging and integrated acceptance

- [x] 11.1 Package one runtime-facing distribution and document the clean-break extension/configuration migration and rollback; verify installation in a clean environment leaves predecessor databases/runtime untouched and loads packaged extension assets correctly.
- [x] 11.2 Run a three-location acceptance scenario covering two completed local computations, stable bounded promotion, pointer adoption, unique local tails, and different expansion surfaces; verify observable event counts, stored state, and disk ownership against all five capability specs.
- [x] 11.3 Run integrated eviction/rebuild and crash-race scenarios, including missing inputs, lowered limits, oversized commits, merge ancestry, and durable hook failures; verify no partial results, false readiness, implicit effect replay on hits, or unauthorized hook retries.
- [x] 11.4 Measure warm-read handler counts, inherited-state lookup growth, peak construction size, and bounded cache accounting on representative histories; record actual results and run build, typecheck, relevant full tests, package smoke checks, and strict OpenSpec validation before marking implementation complete.

Verification evidence is recorded in `docs/verification.md`. Task 9.4 remains open for Linux/macOS lifecycle execution; the Node 24/26 CI matrix is prepared, but has not run in this Windows session.
