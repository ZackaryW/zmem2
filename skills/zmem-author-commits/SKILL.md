---
name: zmem-author-commits
description: Author or review Git commits carrying durable zmem entries or DECAY, CANCEL and META effects, validate proposed messages against computed memory, and create incremental commits when authorized.
---

# Author zmem commits

Write useful Git history first. Add annotations only for durable decisions,
verified lessons or intentional effects; ordinary diff narration needs none.

## Select the runtime

These instructions target the TypeScript/Node engine. Inspect executable location,
`zmem --version` and `zmem --help`; its help includes `init`, `sync` and file/stdin
checks. The older product shares the command name. If it is selected, report the
mismatch and use an explicitly selected new executable if available. Do not
replace the user's runtime or data to validate a message.

If a needed repository index is absent, run `zmem init PATH` with the selected
runtime/home and snapshot limits, then continue checking without a separate
permission request. Honor any user no-bootstrap instruction until changed;
`check` and `show` can themselves create missing state, so do not use them to
bypass that instruction. If initialization fails or bootstrap is prohibited,
report the validation limitation and continue the authorized work using available
evidence, without claiming a successful memory check.

## Prepare, validate, inspect

1. Inspect the repository's conventions, staged diff and relevant verification.
   For multiple responsibilities, choose dependency-ordered commits that each
   leave a coherent, verified state. Stage only their explicit paths or hunks.
2. Read [annotation-vocabulary.md](references/annotation-vocabulary.md) when
   adding or changing an annotation. Keep a normal subject/body and put each
   annotation on its own unwrapped line. Use registered custom types only.
3. Resolve effect targets from valid selected-snapshot memory and Git ancestry.
   Copy the returned SHA and one-based annotation index; never infer an index
   from entry order. Confirm META endpoints cover a complete reachable range.
4. Write the complete proposed message to a temporary file and run
   `zmem --repo PATH check --file MESSAGE_FILE`. Normal checks use a computed
   base and an ephemeral proposal overlay, including for DECAY/CANCEL/META.
   Inspect `ok`, `diagnostics`, `attention`, `effects` and proposed `entries`.
5. Resolve validation failures and relevant coverage gaps. Use `--deep` when an
   independent fresh-history audit is needed, not automatically for every effect.
   Both modes skip hooks and discard hypothetical state. Add message policies
   only when requested or established by repository conventions.
6. Present the proposed message and check outcome, or commit within the user's
   existing authorization. After an authorized commit, run `show COMMIT` through
   the same selected executable and inspect the resulting annotations/memory.
   Report failed inspection explicitly; do not amend merely to add memory.

An entry should explain the adopted choice and its reason, or a verified lesson
that will help later work. Keep entries atomic and understandable without this
chat. Do not add credentials or other secrets to Git history.

If validation is unavailable, report that limitation rather than claiming a
successful check. Preserve unrelated working-tree changes and existing commit
authorization; using this skill alone does not authorize committing or pushing.
