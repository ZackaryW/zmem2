# background-backfill Specification

## Purpose

Complete repository memory through bounded detached work while preserving responsive foreground operations, coherent computed results and explicit user control.

## Requirements

### Requirement: Automatic durable admission accompanies results
Successful init, sync, recall, search, show and links operations SHALL automatically attempt background admission and return its outcome together with the foreground result and separate coverage information. Admission SHALL return accepted, already_pending, already_fulfilled, ineligible, queue_full or failed, with a job identifier where applicable and a reason for rejection. Acceptance SHALL mean a durably stored request and SHALL NOT wait for computation or a free worker. Admission failure SHALL NOT discard usable foreground results. Preview checks SHALL NOT schedule background work.

#### Scenario: Recent memory is usable
- **WHEN** a foreground operation completes a bounded recent selection
- **THEN** it returns that result and the admission outcome without waiting for full-history computation

#### Scenario: User disables scheduling
- **WHEN** background execution is disabled by user/repository policy or command option
- **THEN** the result includes ineligible with a reason and no new work is queued

### Requirement: Capacity and duplication are enforced across callers
The selected user profile SHALL allow at most two running background workers and eight waiting logical targets. Duplicate and fulfilled checks SHALL precede capacity checks. Equivalent requests SHALL reuse one job; different semantic inputs SHALL NOT be conflated. A logical target SHALL own its sequential segment continuation without pre-enqueuing all segments.

#### Scenario: Queue is full
- **WHEN** eight targets are waiting and an unrelated eligible target is submitted
- **THEN** admission returns queue_full and does not store a pending request

#### Scenario: Duplicate arrives at capacity
- **WHEN** equivalent work is already queued or running while the queue is full
- **THEN** admission returns already_pending and the existing job identifier

### Requirement: Detached execution is bounded and supervised
Background work SHALL survive the initiating CLI exiting and run under a per-user supervisor. Each worker SHALL have a finite configurable deadline and termination grace. The supervisor SHALL enforce concurrency, observe progress, terminate owned unresponsive workers, and fence obsolete owners from publishing. A worker SHALL process at most one newly sealed segment per invocation. Repeated interruptions without sealed progress SHALL end in visible failure after a bounded number of attempts.

#### Scenario: Caller exits
- **WHEN** an accepted request outlives its calling CLI
- **THEN** the detached supervisor continues it within the configured resource limits

#### Scenario: Worker times out
- **WHEN** a worker exceeds its deadline and grace
- **THEN** it is terminated, unsealed work is not exposed, and recovery resumes from sealed progress or reports an exhausted retry limit

### Requirement: Private construction publishes coherent memory
Backfill SHALL pin a commit and expansion surface, preserve deterministic whole-commit segmentation, and construct separate staged state. Publication SHALL validate dependencies and current ownership. A complete target view SHALL become visible atomically; incomplete construction SHALL NOT replace the usable foreground view. Existing readers SHALL retain coherent snapshots. Changes to effective semantic inputs SHALL make the old job ineligible or failed rather than silently changing its target.

#### Scenario: Old history changes newer effects
- **WHEN** recent indexing lacked an older effect target
- **THEN** backfill computes the complete compatible base and dependent outcomes before publishing the full target view

#### Scenario: Worker loses ownership
- **WHEN** an obsolete worker attempts publication after cancellation or replacement
- **THEN** publication is rejected and the current visible view remains intact

### Requirement: Recovery preserves sharing and side-effect rules
Workers SHALL consult compatible available coverage before computing missing history. Only stable eligible computed segments SHALL be centrally promoted. Staged/provisional work SHALL NOT produce duplicate computation credit or deliver external hooks. Publication SHALL preserve existing durable hook receipts and SHALL NOT implicitly retry failed or uncertain external effects. Local staging SHALL have a finite storage budget with an explicit failure on exhaustion.

#### Scenario: Stable boundary is absent
- **WHEN** an eligible local backfill has no configured stable promotion boundary
- **THEN** it can complete locally without promoting its segments

#### Scenario: Shared payload was evicted
- **WHEN** completed coverage is evicted without active demand
- **THEN** an idle background queue does not repeatedly reconstruct it merely to refill the cache

### Requirement: Lifecycle control is durable and observational
Job/service status SHALL not create repository indexes or start execution. Pause and cancel SHALL persist across process restarts and automatic admissions; explicit resume SHALL be required to reactivate those targets. Service stop SHALL disable automatic dispatch until explicit start and stop active workers safely. Status SHALL report target identity, state, progress and failure reason without claiming unknown totals or complete coverage.

#### Scenario: Paused job is encountered again
- **WHEN** another foreground call requests a paused target
- **THEN** admission reports ineligible and does not resume it

#### Scenario: Status on an untouched home
- **WHEN** a user inspects job or service status before any initialization
- **THEN** it reports absence without creating state or launching a process
