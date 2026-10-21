# adaptive-segment-sharing Specification

## Purpose

Eliminate recurring compatible indexing work across repository locations by selectively sharing stable bounded computed segments under user-controlled promotion and residency policies.

## Requirements

### Requirement: Local indexing is primary
Repository locations SHALL perform ordinary indexing locally. The user-level coordinator SHALL observe computation evidence and manage qualified shared coverage without eagerly indexing every registered repository or moving all local history to central storage. Repeated queries answered by existing results SHALL NOT alone justify central computation.

#### Scenario: One location repeatedly queries a local result
- **WHEN** one checkout repeatedly reads an already-computed segment
- **THEN** reads remain local or use existing shared coverage and do not increase its completed-computation promotion count

### Requirement: User configuration controls promotion
User-level configuration SHALL expose promotion enablement and a positive integer minimum completed-computation count, defaulting to enabled and two total completed computations. The first completed computation SHALL count as one. Eligibility SHALL additionally require observations from at least two distinct verified repository locations. Invalid policy values SHALL fail clearly before affected promotion work begins. Policy changes SHALL not alter existing segment semantics or automatically replay annotations.

#### Scenario: Default threshold is reached
- **WHEN** locations A and B each complete a compatible computation of the same segment once
- **THEN** the segment meets the default repetition threshold after B's completion, subject to stability and size eligibility

#### Scenario: Local retries do not establish cross-location recurrence
- **WHEN** one location completes the same computation twice and no other location has completed it
- **THEN** the segment does not qualify for cross-location promotion

#### Scenario: Promotion is disabled
- **WHEN** the user disables promotion
- **THEN** ordinary local indexing continues and no new automatic promotion or speculative central computation is admitted

### Requirement: Computation observations are compatible and idempotent
Promotion counters SHALL be scoped by verified repository, exact covered commit range and boundary structure, computed base identity, and effective evaluation inputs. A completed computation SHALL be credited at most once by durable computation-event identity. Failed work, pending retries, polling, hypothetical checks, adoption of existing results, and coalesced callers for one computation SHALL NOT create extra credits. Different expansion surfaces SHALL have separate counters even when raw Git facts are shared.

#### Scenario: An observation is delivered twice
- **WHEN** the coordinator receives the same completion event more than once
- **THEN** the promotion count increases only once

#### Scenario: Same commits use incompatible expansions
- **WHEN** two locations compute the same range with different effective expansion identities
- **THEN** their observations do not combine to satisfy the threshold for either computed result

### Requirement: Stability is established by an explicit ancestry boundary
Central eligibility SHALL require all commits covered by the candidate segment to be reachable from a user-configured stable Git ref or explicit full commit boundary for that verified repository. The coordinator SHALL resolve the boundary to a commit identity and verify the ancestry proof at admission and before publication. Unconfigured, missing, moved incompatibly, or unverifiable boundaries SHALL prevent new promotion without preventing local indexing. Commit age or hash immutability alone SHALL NOT qualify a segment. Movement of a ref SHALL not change the meaning of an already-published immutable result.

#### Scenario: Active tail is outside the stable boundary
- **WHEN** a frequently recomputed segment includes a commit not reachable from the configured stable boundary
- **THEN** it remains local until an appropriate boundary covers it

#### Scenario: Boundary is force-moved during promotion
- **WHEN** the configured ref no longer proves the candidate stable before publication
- **THEN** promotion is abandoned or requalified against a fresh valid proof and no ready claim is published from the stale proof

### Requirement: Promotion reuses available computed work
For a stable size-compliant candidate whose repetition threshold is met, the coordinator SHALL adopt a verified compatible completed result when available rather than recomputing it solely for promotion. If qualified work must be recomputed because no valid payload remains, it SHALL be coordinated under one active claim for that identity. Overlapping coverage SHALL reuse compatible complete segments and dependencies without blindly merging effective branch states. Adoption SHALL not invoke historical expanders or hooks.

#### Scenario: Second computation supplies the shared result
- **WHEN** the threshold is met and a location has the completed compatible segment
- **THEN** central publication verifies and adopts that payload without a third evaluation of its annotations

### Requirement: Central residency is bounded and demand based
The shared cache SHALL enforce a finite user-configured byte budget and reclaim least recently demanded eligible payloads with deterministic tie-breaking. Accounted bytes SHALL include resident payloads and their dependencies without double-counting shared files. Actual demand reuse SHALL refresh recency; production, promotion, and job polling SHALL NOT. Inactive local references SHALL not permanently pin payloads. Active readers, handoffs, and publication dependencies SHALL be temporarily protected. If only protected payloads remain, admission SHALL pause or return capacity-unavailable rather than delete active data; temporary protected overage SHALL be reported.

#### Scenario: An idle referenced segment is evicted
- **WHEN** cache pressure selects an inactive shared segment that local indexes still reference
- **THEN** its payload can be reclaimed and subsequent resolution follows the explicit rebuild-on-demand path

#### Scenario: Active query overlaps eviction
- **WHEN** a query has acquired the required dependency leases
- **THEN** eviction cannot remove those payloads until the query releases them

### Requirement: Advisory state cannot authorize side-effect retries
Usage profiles and queued observations SHALL have finite limits and expiration. Losing or expiring advisory state SHALL only delay promotion and SHALL NOT change computed outcomes, erase durable failed-job or hook records, or authorize uncertain work to run again. Restart SHALL reconcile claims and abandoned temporary data before publishing availability. Available status SHALL reflect actual verified payload residency.

#### Scenario: Profiles expire after restart
- **WHEN** stale demand profiles are removed during recovery
- **THEN** failed side-effect records remain authoritative and local indexing does not treat expired popularity as a request to warm the cache
