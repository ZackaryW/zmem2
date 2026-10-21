# local-shared-references Specification

## Purpose

Let local indexes adopt compatible central computed coverage safely, avoid duplicate indexing, and recover transparently from shared payload eviction without corrupting repository memory.

## Requirements

### Requirement: Indexing consults user-level coverage first
At indexing startup and before scheduling uncovered work, a local index SHALL consult the user-level catalog for compatible computed coverage and active indexing claims. Complete published coverage SHALL be reusable; a claim alone SHALL not count as available data. Catalog unavailability SHALL be bounded and reported without requiring central availability for independent local computation. Lookup SHALL use the current repository and computation identity, not a path or ref label alone.

#### Scenario: Compatible shared coverage exists at launch
- **WHEN** a local index starts and resolves an available compatible central segment
- **THEN** it adopts a reference instead of recomputing that covered history

#### Scenario: Only an unfinished claim exists
- **WHEN** another worker claims matching indexing work but has not published a complete result
- **THEN** local indexing can join bounded coordination but does not create a ready pointer or delete local materialization on that basis

### Requirement: Local-to-central handoff preserves readability
Replacing local materialization SHALL verify the central segment and its required dependency closure, protect that closure during the handoff, and atomically publish a local reference before local duplicate data is reclaimed. Existing local readers SHALL retain access until they finish. Only compatible covered materialization SHALL be removed; unique history and incompatible results SHALL remain local. The local manifest SHALL retain sufficient identity, coverage, and provenance to resolve or rebuild the referenced result.

#### Scenario: Handoff is interrupted before local reference publication
- **WHEN** the process stops after central verification but before publishing the local pointer
- **THEN** the previously usable local materialization remains recoverable

#### Scenario: Handoff is interrupted after pointer publication
- **WHEN** the process stops after publishing the pointer but before reclaiming the duplicate
- **THEN** restart can safely reclaim the duplicate later without repeating historical effects

### Requirement: References identify immutable results
A local pointer SHALL identify immutable computed state and payload generation or integrity identity, not merely a mutable central repository/range label. Resolution SHALL verify compatible evaluation identity and integrity before reading results. Central replacement, incompatible schema, corruption, or an extension change SHALL not silently substitute different memory.

#### Scenario: A central payload is corrupt
- **WHEN** integrity verification fails for a referenced payload
- **THEN** the payload is treated as unavailable and no partial or unverified result is returned

### Requirement: Evicted shared state is rebuilt on demand
Inactive local references SHALL remain rebuildable without permanently retaining their shared payloads. A lookup SHALL distinguish ready, pending, evicted, incompatible, and failed states. When required payloads are evicted, the engine SHALL reacquire compatible available coverage or rebuild the missing result from available Git and pinned semantic inputs, computing only missing compatible work. Recovery SHALL not trigger eager rebuilding of every reference. Missing source objects or extension inputs SHALL return structured unavailable diagnostics rather than an empty or stale success.

#### Scenario: Demand follows eviction
- **WHEN** a local reference points to evicted coverage and the original inputs remain available
- **THEN** demand initiates bounded recovery and eventually resolves an equivalent computed result without changing its semantic identity

#### Scenario: Rebuilding is impossible
- **WHEN** referenced source commits or the required extension inputs are unavailable
- **THEN** the caller receives an explicit unrecoverable-input outcome and no fabricated memory result

### Requirement: Dependency leases and publication are coordinated
Readers SHALL acquire protection for the complete set of payloads needed for a coherent response before exposing results. Failure to protect a dependency SHALL cause bounded retry or an unavailable outcome. Indexing and promotion claims SHALL have recoverable ownership, explicit completion/failure states, and duplicate suppression across local and central coordination. Expired claims SHALL not imply successful publication or authorize retry of uncertain side effects.

#### Scenario: Eviction races a reader acquiring dependencies
- **WHEN** one dependency disappears before the reader has protected the required closure
- **THEN** the reader retries resolution or reports unavailability instead of returning a mixture of available and missing entries

#### Scenario: A worker dies while holding a claim
- **WHEN** claim ownership is lost before publication
- **THEN** recovery classifies the incomplete work explicitly and does not advertise a ready segment
