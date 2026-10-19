# Annotation computation

The compiler accepts an explicit Git repository, persistent state map, and
registered expansion surface. It computes entry/relationship changes, scores,
cancellation, typed metadata, diagnostics, and source provenance at construction
time. Reading its state requires no stored-operation replay. Verify the isolated
boundary with `node --test dist/tests/compiler.test.js` after building.

Each annotation emits validated core operations through an immutable context.
Handlers return nothing and receive no database handle. A rejected compound
annotation rolls back all its changes and contributes a diagnostic. An oversized
construction fails explicitly. Built-in meanings cannot be silently replaced.

DECISION and LESSON_LEARNT begin valid with score 1. DECAY multiplies a reachable
entry's score by a finite factor from zero through one. CANCEL invalidates an
earlier reachable DECISION and keeps its score zero. Entries use full commit
identity and one-based annotation ordinal, including malformed annotation lines.

META applies typed owner, tags, and affected-area patches over complete inclusive
ancestry ranges. Source identities distinguish common and branch-only effects;
concurrent metadata assignments remain conflicts until a descendant resolves
them. Intrinsic affected areas include both rename endpoints.

See [extensions](extensions.md) for the versioned DSL inventory, declarative
manifests, trusted JavaScript registration seam, fingerprints, and side effects.
The expansion identity includes effective package content and captured inputs;
uncaptured ambient behavior is ineligible for central sharing.
