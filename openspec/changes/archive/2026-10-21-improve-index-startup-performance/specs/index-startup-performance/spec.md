# Index startup performance

## Purpose

Provide useful recent repository memory promptly while completing full history through bounded, resumable computation that reuses existing coverage.

## ADDED Requirements

### Requirement: Fresh foreground indexing uses a configurable initial window
Default real-memory operations without compatible complete coverage SHALL select at most 64 recent whole commits and 400 syntactically valid annotations. Users SHALL be able to configure the initial commit window. Explicit command/library or environment attention limits SHALL take precedence; -1 SHALL continue to disable a dimension. Preview checks SHALL retain their existing 500-commit and 400-node defaults. Results SHALL report actual limits, coverage and automatic backfill outcome separately.

#### Scenario: Fresh large repository
- **WHEN** initialization has no compatible complete memory and no explicit attention overrides
- **THEN** its foreground selection includes at most 64 commits and admits eligible full-history backfill without waiting for it

#### Scenario: Explicit attention
- **WHEN** a caller specifies attention limits
- **THEN** those limits control selection rather than the initial-window policy

### Requirement: Complete coverage remains useful as history advances
Default real-memory operations SHALL prefer compatible complete coverage for the requested head or its ancestor. They SHALL extend complete ancestry with newly reachable work without replaying already computed compatible entries or effects. Unrelated, truncated or incompatible state SHALL NOT qualify as a complete base. Explicit bounded requests SHALL retain bounded semantics.

#### Scenario: One new effect after full backfill
- **WHEN** a new commit cancels an entry in a previously completed ancestor snapshot
- **THEN** default sync computes the new commit and effect against the complete base while preserving the old snapshot

### Requirement: Background continuation reuses bounded history planning
A background target SHALL reuse a persisted history selection across segment-worker replacement while its pinned commit, effective surface, format and segment policy remain compatible. The selection SHALL preserve deterministic DAG ordering, whole-commit attention and ref identity. Corrupt or incompatible planning state SHALL be rebuilt or rejected without publication of incomplete memory. Planning storage SHALL count toward the existing staging budget and be reclaimed with successful staging cleanup.

#### Scenario: Replacement worker
- **WHEN** a worker resumes a target after one segment seals
- **THEN** it reuses the pinned history selection and sealed computation instead of selecting the entire ancestry again

#### Scenario: Invalid plan
- **WHEN** a saved selection is corrupt or belongs to different target inputs
- **THEN** it cannot silently influence the published target and recovery remains bounded

### Requirement: Default deadline accommodates larger segment work
The default background worker deadline SHALL be 90000 milliseconds, with finite positive user overrides, the existing termination grace and bounded retry behavior. Queue limits SHALL remain two active workers and eight waiting logical targets. Default segment bounds SHALL remain 256 commits and 16777216 bytes.

#### Scenario: Explicit short timeout
- **WHEN** a user configures a shorter finite deadline
- **THEN** watchdog termination and visible retry exhaustion still follow that configured deadline
