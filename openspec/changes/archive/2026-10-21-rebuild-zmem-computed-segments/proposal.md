# Proposal

## Why

The existing Python zmem client/extension host and Rust zmem-cache service couple repository memory to a shared database and repeated history evaluation. Rebuild them as one TypeScript/Node product whose local indexes reuse computed segment results and whose user-level coordinator eliminates proven duplicate computation across locations.

## What Changes

- **BREAKING**: Replace the separate Python and Rust product interfaces with one engine, CLI, and public extension contract in zmem2. Existing repositories remain reference implementations and are not modified by this change.
- Materialize annotation outcomes in immutable computed segments. New work reads compatible base state and computes only additional work; query hits never replay completed DECAY, CANCEL, META, or custom expansion operations.
- Keep indexing primarily local. Promote compatible segments after two total completed computations across at least two locations by default, with eligibility controlled by user-level configuration. Stability requires coverage by a configured stable Git ref or explicit commit boundary.
- Bound segment commit count and encoded payload size; split larger ranges at whole-commit boundaries and reject an indivisible oversized result explicitly.
- Track central coverage, in-progress claims, complete published results, and bounded usage metadata separately. Check the user catalog before scheduling local work; safely replace duplicated local materialization with references only after central publication is verified. Shared references are rebuildable and do not permanently pin central payloads against LRU eviction.
- Fingerprint the effective expansion surface and semantic inputs so different behaviors cannot share computed outcomes. Support declarative types, JavaScript modules compiled from TypeScript where needed, and engine-owned DSL functions.
- Use the requested source layout: `cli`, `core`, `ext/dsl` (one file per function), `ext/tseam`, `ext/builtin`, and portable `utils`.
- Keep generated-index ignore rules inside `.zmem/.gitignore`, leaving the repository root ignore file untouched and configuration/extension sources trackable.
- Deliver the source structure and runtime through verified dependency-ordered checkpoints. The installed command remains `zmem`; the implementation package is `zmem2`. REORDER, UPSERT, and INSERT remain examples, not an approved DSL inventory.

## Capabilities

### New Capabilities

- `unified-memory-engine`: One product/runtime boundary, repository memory commands, core semantic contracts, and isolated proposed-commit checking.
- `computed-segments`: Immutable precalculated results, context-sensitive identity, incremental computation, coherent reads, and provenance.
- `extension-execution`: Declarative types, the TypeScript extension seam, typed DSL operations, trust, and effective expansion identity.
- `adaptive-segment-sharing`: User-level configuration, cross-location computation accounting, stable-segment promotion, and bounded central residency.
- `local-shared-references`: Catalog-first indexing, claim coordination, atomic local-to-shared handoff, and safe reference resolution.

### Modified Capabilities

None. This repository has no established capability specifications; predecessor specifications are evidence, not modified capabilities in this change.

## Impact

Implements the rebuild in zmem2. Source evidence comes from sibling `zmem`, `zmem-cache`, and `codegraph`, particularly annotation contracts, branch-specific effects, project ownership, and resource lifecycle. Node/TypeScript tooling and dependencies are pinned in the package and lockfile. Existing databases and Python extensions are not silently migrated or executed. The design records the agreed policies and configurable segment-size defaults. Tasks preserve their implementation status and record the authorized reconciliation commits; the missing earlier checkpoint history is not reconstructed. Linux/macOS lifecycle verification remains open.
