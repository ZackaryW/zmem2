# extension-execution Specification

## Purpose

Allow repositories to define annotation types and deterministic custom behavior through declarative definitions, DSL operations, and one executable extension seam while preserving safe computed-result reuse.

## Requirements

### Requirement: Declarative types require no executable module
An enabled declarative type SHALL be able to define accepted input, entry production, defaults, and supported engine behavior without supplying an executable handler. Definitions SHALL be validated before their results are published. Unsupported or malformed definitions SHALL produce explicit diagnostics rather than silently selecting another type.

#### Scenario: A repository adds a simple risk type
- **WHEN** an enabled definition declares a text RISK entry with default score 1.0
- **THEN** a valid RISK annotation materializes through engine behavior without loading a custom executable module

### Requirement: Executable modules have an explicit registration entry point
An executable extension SHALL declare an API version and a JavaScript module entry point exporting register(registry). TypeScript-authored extensions SHALL supply compatible executable JavaScript artifacts. Registration SHALL associate supported annotation types with expansion handlers. Handlers SHALL emit typed operations through the supplied context and SHALL NOT receive direct storage access or supply arbitrary database mutations. Registration and expansion SHALL NOT be required to read an already-published compatible result.

#### Scenario: A custom handler is invoked for new work
- **WHEN** new annotations require an enabled executable extension
- **THEN** its module is loaded, its registration is validated, and its handler emits operations that the engine validates and computes

#### Scenario: Shared result is read without executing its producer
- **WHEN** a location has accepted the required surface identity and resolves a compatible published segment
- **THEN** it reads computed results without invoking registration, expansion, or publication hooks solely to serve that read

### Requirement: Repository configuration selects the effective surface
Repository configuration SHALL explicitly select local or user-installed extensions and their resolved definitions and versions. User installation alone SHALL NOT enable an extension in every repository. Executable repository code SHALL require explicit trust. Conflicting type registrations and unsupported API versions SHALL fail surface resolution deterministically rather than using discovery order. Built-in meanings SHALL not be silently overwritten.

#### Scenario: Global installation does not alter an unrelated repository
- **WHEN** a user installs a new extension that a repository has not selected
- **THEN** that repository's effective expansion identity and computed outcomes remain unchanged

#### Scenario: Repository code is untrusted
- **WHEN** a selected repository extension has not been trusted
- **THEN** its executable module is not imported and the unresolved or disabled behavior is reported explicitly

### Requirement: DSL operations share the engine execution contract
Supported DSL functions SHALL declare their input contract and emit validated operations through the same semantic boundary used by executable handlers. DSL computation SHALL happen during segment construction, not during reads of completed results. The function inventory SHALL be explicitly documented and versioned; examples named during design SHALL NOT implicitly become supported commands. Invalid operations SHALL not publish partial canonical effects.

#### Scenario: Declarative and executable behavior agree
- **WHEN** a supported DSL definition and an executable handler emit equivalent validated operations against the same computed base
- **THEN** they produce equivalent semantic outcomes

#### Scenario: An illustrative function is not implemented
- **WHEN** a definition requests an operation absent from the supported DSL inventory
- **THEN** validation rejects it rather than guessing semantics from its name

### Requirement: Computed reuse respects effective expansion identity
The expansion identity SHALL include enabled definitions, executable content, resolved dependencies, relevant configuration, permission-dependent behavior, captured inputs, and evaluation semantics. Installation location alone SHALL NOT distinguish equivalent surfaces. Different effective behavior SHALL produce distinct computed identities. Behavior dependent on uncaptured ambient inputs SHALL be ineligible for central sharing and SHALL not be represented as deterministic merely because it receives a restricted context object.

#### Scenario: Local and user installations are equivalent
- **WHEN** a repository-local extension and a user-installed extension have identical effective inputs and behavior
- **THEN** their location alone does not prevent sharing a computed segment

#### Scenario: Two locations use different extension behavior
- **WHEN** the same commits are processed with different enabled handlers or relevant configuration
- **THEN** computed outcomes remain separate even if immutable raw commit facts can be reused

### Requirement: Side effects are separate from computed results
External side effects SHALL be dispatched separately from canonical expansion and SHALL have durable execution or failure records outside evictable shared payloads. Reading, copying, promoting, consolidating, or rebuilding a computed segment SHALL NOT implicitly retry uncertain or failed side-effect work. Proposed-commit checks SHALL skip external hooks.

#### Scenario: Promotion reuses a hook-bearing result
- **WHEN** a completed local segment is promoted or adopted elsewhere
- **THEN** its historical hooks do not execute again merely because storage ownership changed

#### Scenario: Cache eviction follows uncertain hook execution
- **WHEN** evictable data is reclaimed after a hook has failed or its completion is uncertain
- **THEN** the durable record still prevents an implicit retry of that side effect
