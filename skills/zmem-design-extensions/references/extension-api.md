# Extension API

Read the package-selection section and the example matching the chosen surface.
Observer details are needed only when external actions are requested.

## Package selection

A repository package lives at `.zmem/extensions/example/extension.yaml` with an
optional JavaScript entry module beside it. Select it in `.zmem/config.yaml`:

```yaml
extensions:
  - path: extensions/example
    inputs:
      replacementType: DECISION
```

Alternatively, select `{ id: example, version: '1.0.0' }` to use the package at
`<home>/extensions/example/1.0.0`. Repository inputs override manifest defaults.
Identical effective packages can share identity across repository/user locations;
an installation path alone does not determine behavior. Keep configuration and
extension sources in Git; generated `.zmem/index/` belongs in ignore rules.

The following manifests are alternatives for this example package, not three
packages to register simultaneously.

## Declarative entry

```yaml
id: example
version: '1.0.0'
api_version: 1
types:
  RISK:
    kind: entry
    content: required
    default_score: 1.0
```

`zmem(RISK): An upstream API may change.` creates a normal valid scored entry.
No executable module or execution trust is needed for a purely declarative type.

## Declarative composition

```yaml
id: example
version: '1.0.0'
api_version: 1
inputs:
  replacementType: DECISION
types:
  SUPERSEDE:
    kind: operation
    operations:
      - function: entry
        type: $inputs.replacementType
        content: $annotation.content
      - function: cancel
        target: $annotation.target
```

`zmem(SUPERSEDE)[TARGET_SHA, 1]: Use SQLite.` emits a new decision and cancels the
earlier reachable decision atomically. An invalid target rejects the annotation
and rolls back its new entry too. The first two bracket arguments populate
`$annotation.target` (SHA and one-based index).

| Function       | Arguments                                   |
| -------------- | ------------------------------------------- |
| `entry`        | type, content, optional score               |
| `relationship` | source, target, optional relation and score |
| `decay`        | target, factor                              |
| `cancel`       | target                                      |
| `metadata`     | from, to, operations (key/operator/value)   |
| `diagnostic`   | message                                     |

Bindings are own-property paths under `$annotation`, `$commit`, `$inputs` and
`$currentEntry`, not arbitrary evaluation. Numeric arguments accept numeric
strings and undergo validation. Scores/factors must be finite and within [0,1].
Each DSL function has its own file under `src/ext/dsl`; REORDER, UPSERT and INSERT
are not supported function names. Library users can import typed builders as
`dsl` from `zmem2`.

## JavaScript entry point

Compile TypeScript authorship into `.mjs` or ESM `.js` before loading. Example
manifest:

```yaml
id: example
version: '1.0.0'
api_version: 1
entry: ./extension.mjs
deterministic: true
types:
  RISK:
    kind: entry
    handler: risk
```

`extension.mjs`:

```javascript
export function register(registry) {
  registry.extend('RISK', {
    expand(ctx) {
      ctx.addEntry({ type: 'RISK', content: ctx.annotation.content });
    },
  });
}
```

The handler field marks the type as executable; `register` explicitly installs
it by type name. `register` and `expand` must return undefined (async may resolve
to undefined). Do not return a result object. Repository executable code requires
explicit trust, recorded via `zmem --repo PATH init --trust-extensions`. Check and
index operations can import this code; skipping hooks does not sandbox expanders.

Context exposes read-only `annotation`, `commit`, `inputs`, and `currentEntry`
(the emitted entry's stable identity). Canonical operations are:

```javascript
ctx.addEntry({ type: 'RISK', content: 'text', score: 0.8 });
ctx.addRelationship({ source: ctx.currentEntry, target: 'FULL_SHA:1', kind: 'relates', score: 1 });
ctx.decay({ sha: 'TARGET_SHA', index: 1 }, 0.5);
ctx.cancel({ sha: 'TARGET_SHA', index: 1 });
ctx.diagnose('Unsupported input');
```

These are separate API examples, not a compound recipe to execute together.
`ctx.emit(operation)` accepts a validated typed operation, including metadata:

```javascript
ctx.emit({
  kind: 'metadata',
  from: 'FROM_SHA',
  to: 'TO_SHA',
  operations: [{ key: 'tags', operator: 'add', value: 'reviewed' }],
});
```

Typed operators are `set`, `add` and `reset` (with null for reset).
Use the current exported operation types when building patches. The declared keys
are affected_areas, owner and tags; canonical content/type/score/validity cannot
be overwritten. There is no database handle or registry overwrite API.

## Reuse eligibility

The enabled manifest, package files and declared inputs are fingerprinted.
Executable code also includes Node version. Relative imports must stay inside
captured package files; bundle external dependencies for a closed package.
Imported helper changes must change the effective surface too.

`deterministic: true` is an author contract to use captured inputs only. Static
analysis conservatively demotes dynamic/outside imports and recognizable ambient
access (clock, process state, random, filesystem/network APIs). It is not a proof
of arbitrary JavaScript purity or a security sandbox. Non-shareable surfaces get
a session identity and remain local; do not promise warm reuse across sessions.
Different surfaces never share computed results merely because commits match.

## After-index observers

An executable package can call `registry.afterIndex(name, callback)`. It receives
read-only repository/head/segment context after publication for newly computed
source commits. It cannot emit canonical operations. Do not use an observer to
add entries or modify scores; that belongs in expansion.

Delivery identity includes repository, hook package content, inputs, hook name
and source commit. Receipts are stored separately from evictable payloads.
Successful, failed and running/uncertain deliveries remain recorded. Preview
checks skip observers; adoption, repacking and reconstruction do not redeliver
historical events. Keep external actions idempotent where possible.

Inspect `status` for failure details. `retry KEY` explicitly resets a failed or
uncertain receipt; a later indexing operation may deliver it. Process death can
leave an external action completed but its receipt uncertain, so neither cache
eviction nor an automatic retry loop is a valid retry authorization.
