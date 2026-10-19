# Extension definitions and execution

Each package has `extension.yaml` and, when needed, executable JavaScript.
TypeScript authors compile their module to `.mjs` or ES-module `.js`. Executable
repository packages require `init --trust-extensions` before import. User-installed
packages are explicitly selected from the user's trusted installation directory.

Select a local package in `.zmem/config.yaml`:

```yaml
extensions:
  - path: extensions/example
    inputs:
      replacementType: DECISION
```

Or select an installed package with `id: example` and `version: '1.0.0'`.
Local and user installations with identical effective definitions, content, inputs,
and behavior share identity. Duplicate type registrations and built-in overwrites
are rejected. Supported module API version is 1.

## Simple types

`.zmem/extensions/example/extension.yaml`:

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

`zmem(RISK): An upstream API can change.` becomes a normal scored entry without
executable module loading. Definitions and extension sources belong in Git;
generated indexing files do not.

## Declarative operations

DSL functions currently available are `entry`, `relationship`, `decay`, `cancel`,
`metadata`, and `diagnostic`. Each implementation has its own `src/ext/dsl` file.
REORDER, UPSERT, and INSERT have no implied semantics and are not accepted names.
The library also exports the typed builders as `dsl`.

```yaml
id: example
version: '1.0.0'
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

`zmem(SUPERSEDE)[COMMIT_PREFIX, 1]: Use SQLite.` creates the replacement and cancels
the reachable old decision atomically. `$annotation.target` derives its SHA and
one-based index from the first two bracket arguments. Supported references are
own-property paths under `$annotation`, `$commit`, `$inputs`, and `$currentEntry`.
They are data bindings, not JavaScript evaluation. Numeric DSL arguments such as
`factor` accept numeric argument strings and are validated before computation.

`entry` accepts type/content/optional score; `cancel` accepts target; `decay`
accepts target/factor; `relationship` accepts source/target/optional relation and
score; `metadata` accepts from/to and typed operations with key/operator/value;
`diagnostic` accepts message. Invalid operations roll back that annotation's work.

## JavaScript entry point

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

```javascript
export function register(registry) {
  registry.extend('RISK', {
    expand(ctx) {
      ctx.addEntry({ type: 'RISK', content: ctx.annotation.content });
    },
  });
}
```

Both `register` and `expand` return nothing (an async handler can resolve to
undefined). The context contains read-only annotation/commit data, declared inputs,
and `currentEntry`, the stable identity for an entry emitted by this annotation.
Available methods are `addEntry`, `addRelationship`, `decay`, `cancel`, `diagnose`,
and typed `emit`. There is no database connection in the context. Canonical score,
validity, ancestry, and metadata rules remain engine-owned.

The full enabled package content and inputs are fingerprinted. Executable code
also includes the Node version in computation identity. Source generations are
captured before execution so an imported helper cannot remain stale in Node's
module cache after its content changes. Bundle third-party dependencies into the
package; relative imports must refer to captured files for central eligibility.

`deterministic: true` is an author contract to use only captured inputs. Static
module analysis demotes dynamic/outside imports and recognizable ambient access
such as process state, clock, random, or filesystem modules. This analysis is
conservative, not a proof of arbitrary JavaScript purity or a security sandbox.
Trusted authors must honor the contract. Non-shareable computation receives a
session generation and remains local; code requiring ambient state is not eligible
for shared computed reuse. Prefer declarative operations for fully constrained work.

## Observers

`registry.afterIndex(name, callback)` registers an external observer. After segment
publication, it receives a read-only segment/repository/head context for each newly
computed source commit. Delivery identity uses repository, hook package content,
declared inputs, hook name, and source commit. It does not depend on cache packing
or a session nonce. Hooks cannot emit canonical operations.

Successful, running/uncertain, and failed deliveries are durably recorded separately
from payloads. Adoption, repacking, rebuilding, and preview checking do not retry
historical events. `retry KEY` explicitly resets a failed/uncertain receipt; a later
real indexing operation can attempt it again. Failure details remain visible in
`status`. A process death cannot provide exactly-once external side effects: an
uncertain delivery stays blocked until explicitly addressed.
