# unified-memory-engine Specification

## Purpose

Provide one consistent repository-memory interface for querying Git annotations and checking proposed commits, independent of whether computed results are local or centrally shared.

## Requirements

### Requirement: One public engine contract
The product SHALL expose one configuration, error, and semantic contract to its command and library callers. Normal repository operations SHALL NOT require users to install or coordinate separate Python-client and Rust-service releases. Internal background workers SHALL preserve the same public behavior.

#### Scenario: Query through different entry points
- **WHEN** command and library callers request the same repository, resolved commit, attention, and expansion surface
- **THEN** their effective entries, effects, relationships, diagnostics, and provenance agree

### Requirement: Repository initialization and synchronization
The installed executable SHALL be named `zmem`. The CLI SHALL expose `init [path]`, `sync [path]`, and `status [path]`, with the current repository as the default and `--repo PATH` as an alternative. Initialization SHALL register the location, create missing repository configuration, ensure an index-directory rule in `.zmem/.gitignore`, and synchronize initial committed history. A newly added rule SHALL be `/index/`, relative to `.zmem/`, and SHALL cover all platform index directories. Initialization SHALL NOT create or modify the root `.gitignore`, including legacy zmem rules already present there. It SHALL preserve existing configuration and nested ignore content and newline style, remain idempotent, recognize existing `/index/` or `index/` rules, and leave configuration, extension sources and `.zmem/.gitignore` trackable by the generated rule. An unborn repository SHALL complete setup without inventing a commit or computed result. Synchronization SHALL use the common computed-segment engine to adopt compatible shared coverage and compute uncovered local work. The existing `index` command SHALL remain a synchronization alias.

#### Scenario: Initialize then synchronize
- **WHEN** a user initializes a committed repository and later synchronizes after one new commit
- **THEN** initial history is computed or adopted during initialization, only uncovered compatible work is computed during synchronization, and generated index data is ignored

#### Scenario: Repeated initialization preserves user files
- **WHEN** initialization runs more than once over existing configuration and ignore rules
- **THEN** user content is preserved and the generated-index rule is not duplicated

#### Scenario: Initialize without a root ignore file
- **WHEN** initialization runs in a repository with no root `.gitignore`
- **THEN** it creates `.zmem/.gitignore` containing `/index/`, leaves the root ignore file absent, ignores generated indexes and leaves configuration and extension sources trackable

#### Scenario: Preserve root and nested custom rules
- **WHEN** the root ignore file includes custom or legacy zmem rules and `.zmem/.gitignore` contains custom content without a final newline
- **THEN** the root file remains byte-for-byte unchanged and initialization appends the missing index rule within `.zmem` using the nested file's existing newline style without replacing user content

#### Scenario: Initialize before the first commit
- **WHEN** the repository has an unborn HEAD
- **THEN** initialization creates configuration and ignore rules without a computed result, and synchronization after the first commit builds the index

### Requirement: Repository memory operations
The command surface SHALL provide recall, search, show, links, and check operations, structured JSON results by default, and explicitly requested human-readable output. Recall and search SHALL exclude invalid entries by default and expose an explicit way to inspect invalid historical entries. Results SHALL distinguish result-count truncation from history-attention truncation, and errors SHALL distinguish invalid requests, repository or target failures, semantic validation failures, and unavailable computation.

#### Scenario: Cancelled decision remains inspectable
- **WHEN** a decision is cancelled in the selected history
- **THEN** default recall excludes it while explicit historical inspection can show its identity, invalid state, score, and provenance

#### Scenario: Missing computation is not empty memory
- **WHEN** the requested result cannot yet be computed or resolved
- **THEN** the caller receives a structured unavailable or pending outcome rather than a successful empty result

### Requirement: Built-in annotation semantics
The engine SHALL preserve DECISION and LESSON_LEARNT as text entries identified by repository, full commit identity, and one-based annotation ordinal, initially valid with score 1.0. DECAY SHALL multiply an earlier reachable entry's score by a finite factor in [0,1]. CANCEL SHALL invalidate an earlier reachable DECISION and set its score to zero without allowing later DECAY to restore it. Invalid, ambiguous, forward, or disallowed targets SHALL produce diagnostics without applying the rejected effect. Effect annotations SHALL NOT themselves become queryable entries.

#### Scenario: Effects are evaluated into state
- **WHEN** a decision receives DECAY factors 0.5 and 0.4 and subsequently a valid CANCEL
- **THEN** its successive computed scores are 0.5, 0.2, and 0.0, with the final state invalid and no extra entries created for the effects

#### Scenario: Invalid target does not mutate state
- **WHEN** CANCEL targets a LESSON_LEARNT entry or an ambiguous commit prefix
- **THEN** the target remains unchanged and the result contains an effect diagnostic

### Requirement: Typed metadata and ancestry semantics
META SHALL support replace, unique-set addition, and reset operations for affected_areas, owner, and tags over a complete inclusive reachable ancestry range preceding the META commit. It SHALL reject edits to canonical content, type, score, or validity and invalid operator/key combinations. Descendant assignments SHALL take precedence over ancestor assignments; incompatible assignments on incomparable branches SHALL remain explicit conflicts until resolved by an appropriate descendant. Intrinsic affected areas SHALL map root-level files to <root>, reduce changed paths within each top-level folder to their deepest common parent, include both rename endpoints, retain at most three compact areas, and use null/global applicability for broader changes.

#### Scenario: Concurrent assignments conflict
- **WHEN** two incomparable branch commits assign different owners to the same affected historical entry and are merged
- **THEN** the merged result reports the conflict instead of choosing whichever branch was indexed last

#### Scenario: Incomplete range cannot be partially patched
- **WHEN** selected attention omits part of a META range
- **THEN** the engine reports incomplete history and applies no partial metadata patch

### Requirement: Live reference selection and bounded attention
Repository requests SHALL resolve their selected Git reference live, defaulting to the checkout's HEAD, and bind results to the observed commit identity. A ref race SHALL produce a stale-reference outcome or an explicitly restarted observation, never an undisclosed alternate snapshot. Default fresh foreground attention SHALL use a user-configurable 64-commit initial window and 400 syntactically valid annotations; compatible complete coverage SHALL remain available and extend as history advances. Explicit attention SHALL retain positive overrides and -1 disabling a dimension. Preview checks SHALL retain 500-commit and 400-node defaults. This startup policy is specified by improve-index-startup-performance. Selection SHALL preserve whole commits and report limits, usage, and incompleteness. A narrower computed state SHALL NOT masquerade as a complete or wider state.

#### Scenario: Branch advances during selection
- **WHEN** the observed branch changes before its result is selected
- **THEN** the caller does not receive a result silently attributed to the original observation

#### Scenario: Attention boundary cuts through a commit
- **WHEN** including the next commit would exceed annotation attention
- **THEN** none of that commit's annotations are partially applied and the boundary is reported

### Requirement: Proposed commit checks use isolated state
Check SHALL accept a proposed message, resolve a compatible real-history base, and compute only the proposal against isolated state. It SHALL report projected entries and effects, before/after target state, diagnostics, attention, and success. Ordinary annotation-free messages SHALL be accepted unless annotation presence is explicitly required. Hypothetical outcomes SHALL NOT modify Git, published memory, central demand counters, or hook-delivery state. Any explicit fresh audit mode SHALL be distinguished from normal computed-segment reuse and SHALL remain isolated.

#### Scenario: Cancellation preview does not persist
- **WHEN** a proposed cancellation is checked against an existing computed segment
- **THEN** check reports the projected invalid decision while a subsequent query still sees the unchanged published state and no hooks were dispatched

#### Scenario: Default preview does not replay its base
- **WHEN** a compatible computed base is already available
- **THEN** check evaluates the proposed annotations without replaying annotations inside the base
