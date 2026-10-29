# Development and package choices

zmem2 uses TypeScript/ES modules on Node 24 or 26. Git must be on PATH.
Run `npm ci`, `npm run typecheck`, `npm test`, and `npm pack` from the project root.
Tests use Node's built-in runner and isolated temporary Git repositories/user homes.

Routine GitHub Actions CI runs on pushes to `main`, pull requests, and manual
dispatch. Ubuntu Node 24 runs the full application suite. Windows and macOS on
Node 24, plus Ubuntu Node 26, run `npm run test:smoke`: five tests covering CLI
startup through links, import behavior, foreground recall, detached background
completion, and admission controls/failures. Both test commands compile with
`tsc`, so every job also checks types. Formatting, package preparation, and
release-helper tests run once in the Ubuntu Node 24 job. New routine runs cancel
older runs for the same branch or pull request.

Release validation runs the full suite on all six OS/runtime combinations, with
formatting and package preparation once on Ubuntu Node 24. Release invocations
have separate concurrency groups and are not cancelled by routine CI or another
release run.

The CLI is `zmem`; library callers import `MemoryEngine` from the `zmem2` package.
CLI formatting and startup belong to `src/cli`; semantic/storage contracts belong
to `src/core`; `src/ext/{dsl,tseam,builtin}` implements operation adapters, module
registration, and built-ins. Each DSL function has one file. Portable helpers
under `src/utils` import no zmem models. The existing Python/Rust installations
are not required by the new package.

## Dependencies

- SQLite uses Node `DatabaseSync` with short-lived handles, a 250-ms busy timeout,
  and short explicit transactions. There is no native npm build dependency.
  See https://nodejs.org/api/sqlite.html.
- `yaml` 2.9.1 (ISC) parses configuration and manifests. Zod 4.6.7 (MIT) validates
  structured inputs at runtime. Parsing is separate from policy selection.
  See https://eemeli.org/yaml/ and https://zod.dev/basics.
- `lru-cache` 11.5.3 (BlueOak-1.0.0, Node 20 or >=22) bounds decoded immutable
  payloads by both count and approximate encoded size. It does not coordinate
  persistent claims, leases, or eviction. See https://isaacs.github.io/node-lru-cache/.
- `es-module-lexer` 3.0.4 (MIT), using its synchronous JS build, inspects static and
  dynamic import dependencies without executing module registration. Unknown or
  outside dependencies prevent shared eligibility. See
  https://github.com/guybedford/es-module-lexer.
- TypeScript and Node types are development dependencies. Versions are pinned in
  package.json/package-lock.json; installation runs no dependency build scripts.

## Portable helpers

See [helper contracts](helpers.md) for framed fingerprints, shared pending work,
recursive plain-data freezing, and direct standard LRU reuse. The lower layers
are independently verified: [storage](storage.md) and
[computation](computation.md) document their focused tests and contracts.

Set `ZMEM_HOME` or pass `--home` / `{home}` to isolate user data. Repository
configuration and extension sources are trackable. Generated `.zmem/index`
storage contains its own ignore file and is never intended for Git tracking.

## Background integration tests

Background test waits allow up to 60 seconds for multi-segment work on shared CI
runners, including repeated Node and Git startup on Windows. This test budget does
not change application worker deadlines. A failed job ends the wait immediately;
a timeout reports the last queue snapshot for diagnosis.

Teardown remembers observed supervisor and worker PIDs and waits for actual
process exit before deleting fixtures. A settled queue can clear its PID fields
while a wrapper is still closing files, so queue state alone is insufficient for
Windows cleanup.

Contention regressions hold a real control-database write lock beyond the 250-ms
SQLite timeout. They verify supervisor survival, ownership monitoring without
false cancellation, and retryable computation with eventual durable settlement.
