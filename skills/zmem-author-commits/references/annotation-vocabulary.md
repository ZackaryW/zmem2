# Annotation vocabulary and checks

## Entries and effects

```text
feat(storage): choose the local catalog

zmem(DECISION): Use SQLite so catalog publication is transactional.
zmem(LESSON_LEARNT): File modification time cannot establish Git ancestry.
```

Use one annotation per physical line. Every line containing `zmem(` consumes an
ordinal even if malformed; avoid illustrative annotation syntax in actual commit
prose unless it is intended to be parsed. Type identifiers are uppercase with
digits/underscores allowed after the first letter. Conventional commit scope
becomes stored scope. Entries start valid with score 1.0.

| Form                                   | Meaning                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `zmem(DECISION): text`                 | An adopted choice, constraint or tradeoff and its reason.                               |
| `zmem(LESSON_LEARNT): text`            | A verified reusable lesson.                                                             |
| `zmem(DECAY)[SHA, INDEX, FACTOR]`      | Multiply an earlier reachable entry's score by a finite factor in [0,1].                |
| `zmem(CANCEL)[SHA, INDEX]`             | Invalidate an earlier reachable DECISION and set its score to zero.                     |
| `zmem(META)[FROM, TO, OPERATION, ...]` | Patch declared metadata over a complete inclusive ancestry range preceding this commit. |

Effects do not create additional memory entries. CANCEL cannot target another
entry type. DECAY does not restore a cancelled entry. SHA prefixes must resolve
uniquely; INDEX is the returned one-based annotation ordinal, not a result-row
number. An effect target must precede the proposed commit in its ancestry.

META supports `affected_areas`, `owner` and `tags`: `key=value` replaces,
`key+=value` appends a unique set member, and `key=null` resets. Scalar owner
cannot be appended. Content, type, validity and score are not patchable metadata.

```text
zmem(META)[FROM_SHA, TO_SHA, affected_areas=src/storage, owner=platform, tags+=durability]
```

Both endpoints must be reachable, FROM must be an ancestor of TO, and attention
must include the whole range. Null affected areas mean global applicability;
append does not narrow global applicability until an assignment establishes a
bounded value. Descendant assignments supersede ancestral ones; incomparable
assignments can remain conflicts until resolved by a descendant.

## Find a target

```console
zmem --repo PATH recall --event DECISION --ref BRANCH
zmem --repo PATH search "local catalog" --ref BRANCH
zmem --repo PATH show TARGET_COMMIT --ref BRANCH
```

Use the same selected snapshot throughout. Recall includes `trail.head`,
`trail.id` and `trail.surface` without an extra flag. Show returns the origin's
annotations and its computed entries visible in that snapshot, including invalid
ones. Verify uniqueness and ancestry with Git; raw commit prose alone does not
validate effective memory.

## Validate the complete proposal

```console
zmem --repo PATH check --file MESSAGE_FILE
zmem --repo PATH check --stdin
zmem --repo PATH check --file MESSAGE_FILE --deep
```

The first two reuse compatible computed history. The last explicitly computes an
isolated fresh history for auditing. These simulate a new commit after HEAD (or
the selected `--ref`); they do not create a commit or persist hypothetical effects.
Hooks are skipped in both modes. Normal checking may populate missing base state.

Inspect `ok`, `mode` (`computed` or `deep`), `parent`, `attention`, `diagnostics`,
`effects` and `entries`. A completed unsuccessful check exits 5. Input/config
errors exit 2, repository errors 3, and unavailable computation/storage 4.

Defaults are 500 commits and 400 syntactically valid annotations. The proposal
reserves node attention too. Raise finite `--commit-limit` / `--node-limit`
values when needed for a target or range. A deliberately complete audit may use:

```console
zmem --repo PATH --commit-limit -1 --node-limit -1 check --file MESSAGE_FILE --deep
```

Optional `--conventional`, `--require-annotation` and `--max-subject-length N`
enforce requested message policies. Do not require annotations on every commit.

There is no `check COMMIT_REF` mode in this CLI. Do not feed an existing message
after HEAD and call that validation at its historical position. Inspect existing
commits with show; an exact historical or merge audit needs deliberate ancestry
selection and may require library-level work beyond proposal checking.
