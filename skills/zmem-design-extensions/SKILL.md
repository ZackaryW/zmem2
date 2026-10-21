---
name: zmem-design-extensions
description: Design and verify zmem annotation types using declarative definitions, typed DSL operations or trusted JavaScript modules, including computed sharing identity and after-index observers.
---

# Design zmem extensions

Choose the smallest surface that expresses the requested behavior:

| Need                              | Surface                                       |
| --------------------------------- | --------------------------------------------- |
| A scored entry with a new type    | Declarative type in extension.yaml            |
| A combination of existing effects | Declarative DSL operations                    |
| Custom validation or computation  | JavaScript register(registry) and expand(ctx) |
| An external action after indexing | Read-only afterIndex observer                 |

These instructions target the TypeScript/Node product. Confirm executable
location, `zmem --version` and `zmem --help` (init/sync and file/stdin checking).
If the predecessor is selected, report the mismatch and use an explicitly
selected new executable if available. Python modules and overwrite registration
are not this runtime's extension API.

## Define and prove the behavior

1. Specify the annotation grammar, uppercase type, inputs, resulting entries or
   effects, and invalid-input behavior. Prefer a declarative definition before
   choosing executable code.
2. Read the relevant examples in [extension-api.md](references/extension-api.md).
   Select the package explicitly in repository config; a user installation alone
   does not activate it. Establish trust before executing repository code.
3. Keep canonical changes within typed context operations. The engine owns
   ancestry, score, validity, metadata and rollback. Handlers return nothing;
   observers cannot emit canonical operations. Built-in overwrites and duplicate
   registrations are rejected.
4. Declare inputs and assess determinism before claiming shared eligibility.
   Effective package content and inputs affect identity; executable surfaces also
   include Node version. Same repository/commits alone are insufficient.
5. Exercise a temporary repository with the intended annotations through init,
   sync and recall/show. Check invalid input leaves no partial compound effects,
   an unchanged sync runs zero expansions for a shareable surface, and changing
   code or inputs selects a different surface. For JavaScript, verify untrusted
   execution is refused before testing the explicitly trusted path.
6. When observers are involved, verify receipts and failure reporting, and that
   preview/adoption/rebuild do not redeliver historical effects. An uncertain
   external action needs an explicit retry decision.

Report the chosen surface, files/configuration, observed entries/effects,
verification and sharing limitations. Do not change core merely to bypass
extension validation or add a DSL command with unspecified semantics.
