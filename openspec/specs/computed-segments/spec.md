# computed-segments Specification

## Purpose

Represent repository memory as immutable computed results so completed annotation effects can be reused across incremental indexing and compatible locations without historical replay.

## Requirements

### Requirement: Segments contain materialized outcomes
A published segment SHALL expose computed entry validity, scores, content, metadata, relationships, diagnostics, and provenance for its declared history coverage and base state. Retained operation journals SHALL be audit evidence rather than a required query execution plan. Reading a compatible published segment SHALL NOT execute historical annotation handlers or reapply stored effects.

#### Scenario: Repeated reads of a decayed entry
- **WHEN** a published segment contains an entry whose effective score is 0.5 and is queried repeatedly
- **THEN** every query reads score 0.5 without invoking the prior DECAY or its extension handler

### Requirement: Incremental computation uses compatible base state
New computation SHALL resolve affected target state from a compatible computed base and evaluate only work not already represented by compatible results. Derived changes SHALL preserve the base and become a new immutable result. Identity and target lookup SHALL remain available for earlier entries needed by later effects. A changed selection or missing compatible base SHALL be reported and handled as new computation rather than silently reusing invalid state.

#### Scenario: New cancellation targets an inherited decision
- **WHEN** a new commit cancels a decision inherited from segment A
- **THEN** segment B stores the effective invalid state while segment A remains unchanged and its prior annotations are not replayed

### Requirement: Segment identity includes all semantic dependencies
A computed segment SHALL be identified by verified repository identity, commit coverage and boundary structure, base-state identity, effective attention, effective expansion surface, captured semantic inputs, and evaluation/format version. Equivalent requests SHALL resolve the same identity independent of their checkout path when path has no semantic effect. Different semantic inputs SHALL NOT resolve to the same computed result. Repository identity SHALL NOT be established solely by a matching remote URL or commit-range label.

#### Scenario: Same range has a different base
- **WHEN** two requests contain the same commits but effects observe different computed base states
- **THEN** the requests use distinct computed identities

#### Scenario: Equivalent checkouts reuse an identity
- **WHEN** two verified locations request identical coverage, base, and effective computation inputs
- **THEN** the different checkout locations alone do not prevent computed reuse

### Requirement: Branch and merge outcomes remain context specific
Sharing commit facts or overlapping coverage SHALL NOT union branch-specific effective states blindly. Each merged view SHALL account for common ancestry, unique effects, and concurrent metadata conflicts exactly once, and SHALL publish its reconciled result for direct subsequent reuse. Unavailable dependencies SHALL NOT produce an apparently complete merged view.

#### Scenario: Cancellation occurs on only one branch
- **WHEN** branch B cancels a decision and branch A does not include that cancellation
- **THEN** sharing their common segment does not invalidate the decision in branch A

#### Scenario: Common decay is not applied twice at a merge
- **WHEN** both merge parents share an ancestor containing one DECAY
- **THEN** the merged result includes that effect once and subsequent reads reuse the computed merged result

### Requirement: Publication and reads are coherent
Segment publication SHALL atomically expose complete coverage, computed results, dependency references, and integrity metadata. Readers SHALL observe a coherent published generation. Interrupted or corrupt writes SHALL not appear as ready results. Cleanup SHALL preserve dependencies used by active readers and incomplete atomic handoffs; eviction affecting an inactive shared reference SHALL follow the recoverable-miss contract instead of exposing partial state.

#### Scenario: Publication is interrupted
- **WHEN** a process stops before publication completes
- **THEN** readers continue to see a previously complete result or a structured unavailable outcome, never a partially published segment

### Requirement: Stored inheritance does not become replay
Effective-state lookup SHALL use indexed materialized mappings or equivalent bounded lookup structures rather than executing a growing history of operations. Consolidating storage SHALL preserve computed values, provenance, and semantic identity without invoking historical expansion handlers. The system SHALL report genuine missing coverage rather than fabricating inheritance.

#### Scenario: Long incremental history is consolidated
- **WHEN** many computed descendants require storage consolidation
- **THEN** consolidation combines already-computed data without rerunning cancellation, decay, metadata, or custom handlers

### Requirement: Segment size is bounded
The engine SHALL enforce finite positive user-configured limits on the number of newly covered commits and encoded uncompressed owned payload bytes in each newly published segment. Owned payload SHALL include computed changes, provenance, indexes, and manifests owned by that segment; transitive shared dependencies SHALL be accounted for separately without treating a small pointer as a complete size estimate. Defaults SHALL be 256 commits and 16777216 bytes. Larger ranges SHALL be divided deterministically at whole-commit boundaries while retaining correct base references. Local computation, central promotion, and consolidation SHALL obey the same limits. If one indivisible commit result exceeds the byte limit, the operation SHALL return a structured segment-too-large outcome without publishing partial effects or silently raising the limit.

#### Scenario: Large stable history is segmented
- **WHEN** a stable range contains more commits or owned payload bytes than one segment permits
- **THEN** the engine produces independently bounded segments with explicit base dependencies and correct combined results

#### Scenario: One commit cannot fit
- **WHEN** the complete computed changes for a single commit exceed the configured byte limit
- **THEN** publication fails with the exceeded bound and the prior published state remains intact without being misreported as the requested result

#### Scenario: User lowers the limits
- **WHEN** a previously sealed segment exceeds newly configured admission limits
- **THEN** its historical identity is preserved, new adoption or promotion requires compliant segmentation, and existing readers are not broken by deleting their data mid-read
