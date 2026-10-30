# zmem

Local-first memory from Git commit annotations, stored as precalculated segments.
The CLI, library, built-in types, DSL, and JavaScript extension seam use one
TypeScript/Node engine.

For agent use, start with the [short usage guide](docs/agents.md). The package
ships focused skills for querying memory, authoring commits, and designing
extensions, with setup and recovery details linked only where needed.
Agents should initialize a missing repository index when memory is needed,
unless the user has explicitly disabled automatic bootstrap.

## Install and upgrade from Git

Requires Node 24 or 26, npm, and Git on PATH. This command temporarily selects
the tested npm 12.2.1 installer and installs the latest Git source on `main`:

```console
npm exec --yes --package=npm@12.2.1 -- npm install --global --allow-git=root git+https://github.com/ZackaryW/zmem2.git#main
zmem --version
zmem init .
```

Your globally installed npm version stays unchanged. Run the same command to
update from `main`. To pin a revision,
replace `#main` with `#FULL_COMMIT_SHA`. npm prepares the Git source automatically;
keep lifecycle scripts enabled and development dependencies available during
installation. Ensure npm's global executable directory is on PATH.

For development from a local checkout, run `npm ci` followed by `npm link`.
Preparation builds the CLI automatically. If scripts are disabled, run
`npm ci --ignore-scripts` and `npm run build` before linking. A development link
depends on that checkout: removing its `dist` directory breaks the command.
Restore it with `npm ci`, or reinstall directly from Git. No memory deletion or
uninstall is needed.

Use `--home PATH` or `ZMEM_HOME` for an isolated user data directory. No Python
host or separately installed Rust service is required.

## Repository memory

For checksummed source distributions and maintainer release operations, see the
[source release guide](docs/releases.md).

Commit annotations alongside normal commit prose:

```text
feat(storage): choose a backend

zmem(DECISION): Use SQLite for local memory.
zmem(LESSON_LEARNT): File modification time is not a history timestamp.
```

```console
zmem --repo PATH init
zmem --repo PATH sync
zmem --repo PATH recall --event DECISION
zmem --repo PATH search SQLite
zmem --repo PATH show COMMIT
zmem --repo PATH links --min-score 0.5
zmem --repo PATH recall --ref feature/storage --include-invalid
```

The project lifecycle follows `init` then `sync`, with optional positional paths:

```console
zmem init ./my-repo
zmem sync ./my-repo
zmem status ./my-repo
```

`init` registers the repository, creates `.zmem/config.yaml` if absent, ensures
`/index/` in `.zmem/.gitignore`, and builds the initial computed index.
It preserves existing configuration and nested ignore rules and can be repeated.
The repository's root `.gitignore` is neither created nor changed. Existing root
rules from earlier versions remain in place; they can be removed after verifying
the nested rule if they were added solely for zmem.
In a repository without commits it completes setup; `sync` builds the index
after the first commit. Configuration and extensions remain trackable.

`sync` checks compatible central coverage and computes uncovered local history.
An unchanged repository reuses its completed result. `index` remains an alias.

Successful init/sync/recall/search/show/links automatically request detached
full-history backfill when needed. Responses include `backfill` admission status
and `memory_coverage` separately from the returned result. One supervisor per user
home runs at most two workers with eight waiting targets. Use `--no-background`
to suppress admission for a call. Proposal checks do not schedule background work.

```console
zmem jobs
zmem backfill status
zmem backfill pause JOB_ID
zmem backfill resume JOB_ID
zmem backfill cancel JOB_ID
zmem service status
zmem service stop
zmem service start
```

These status commands do not initialize indexes. Stop pauses active/queued work;
start re-enables dispatch, and paused jobs require explicit resume. See
[background backfill](docs/background.md) for deadlines, limits and recovery.

Results default to JSON. `--human` formats readable JSON. `--event`, `--scope`,
`--area`, `--since`, `--min-score`, and `--limit` filter recall/search results.
Limits on returned results are separate from history attention: initial defaults are 64
commits and 400 syntactically valid annotations. `--commit-limit` and `--node-limit`
override these; `-1` disables one dimension. Environment equivalents are
`ZMEM_COMMIT_LIMIT` and `ZMEM_NODE_LIMIT`. Selection never applies half a commit. With an explicit attention override, unspecified dimensions retain 500-commit / 400-node defaults; the configurable 64-commit startup policy applies only without attention overrides.
After a compatible full-history view is published, default queries reuse it.
Explicit attention flags/environment settings continue to request bounded views.

DECAY multiplies a reachable entry's score; CANCEL invalidates a reachable
DECISION; META patches declared metadata over a complete ancestry range. Effects
are stored as computed outcomes rather than extra memory entries. See
[semantics and recovery](docs/semantics.md).

## Check a proposed commit

```console
zmem --repo PATH check --file COMMIT_EDITMSG
zmem --repo PATH check --stdin
zmem --repo PATH check --file COMMIT_EDITMSG --deep
```

Normal checks use a compatible computed base and an ephemeral proposal overlay.
`--deep` explicitly computes isolated fresh history for auditing. Both skip hooks
and discard hypothetical state. `--conventional`, `--require-annotation`, and
`--max-subject-length N` enable optional message policies. Exit codes are 2 for
invalid input/configuration, 3 for repository failures, 4 for computation/storage
unavailability, and 5 for a completed unsuccessful check.

## Share repeated computation between locations

Indexing stays local until the same compatible segment has been computed at
least twice across at least two registered locations. The original computation
counts as one. Warm reads, adoption, polling, failed work, and proposal simulation
do not count. Promotion also requires an explicit stable ref or commit boundary.

```console
zmem --repo FIRST_PATH init
zmem --repo FIRST_PATH config --user --stable-ref main
zmem --repo FIRST_PATH sync
zmem --repo SECOND_CLONE init --associate REPOSITORY_ID_FROM_INIT
zmem --repo SECOND_CLONE sync
zmem --repo THIRD_CLONE init --associate REPOSITORY_ID_FROM_INIT
zmem --repo THIRD_CLONE sync
```

Separate clones require explicit association and a verified witness commit.
Worktrees sharing a Git common directory are associated automatically. Remote
URL equality alone never establishes repository identity.

The second compatible computation supplies the shared result; no third
computation is needed merely to populate the cache. A later location can adopt
an immutable pointer. Existing local copies are reclaimed after active readers
drain. Unique local tails and incompatible extension surfaces stay local.

User policy lives in `~/.zmem/config.yaml` (or the selected home):

```yaml
promotion:
  enabled: true
  min_computations: 2
  stable_boundaries:
    - repository: REPOSITORY_ID_FROM_INIT
      ref: main
      # Alternatively use oid: FULL_COMMIT_ID instead of ref.
segments:
  max_commits: 256
  max_bytes: 16777216
cache:
  max_bytes: 1073741824
profiles:
  max_entries: 4096
  retention_days: 30
```

There is no assumed stable branch name. Without configured boundaries, indexing
works locally and promotion stays ineligible. Large ranges are split at complete
commit boundaries; an indivisible oversized result fails explicitly. Lowering
limits repartitions available computed checkpoints without running their handlers.

Shared payloads are disposable under LRU. Local pointers do not pin them forever;
later demand reconstructs the recorded computation from Git and compatible
extension inputs. Missing source inputs produce explicit errors. Use `status`
to inspect segment residency, claims, and hook failures, `evict --limit BYTES` to
reclaim shared payloads, and `retry JOB_OR_HOOK_KEY` for an explicit failed-job or
uncertain-hook retry. Retry does not itself execute a hook; a later indexing
operation can deliver an explicitly reset event.

## Extensions and library use

Repository extensions live under `.zmem/extensions`; reusable user installations
live under `<home>/extensions/ID/VERSION`. Repository configuration explicitly
selects them. A user installation alone does not enable behavior globally.
See [extension examples](docs/extensions.md).

```typescript
import { MemoryEngine } from 'zmem2';

const engine = new MemoryEngine('/path/to/repository', { home: '/isolated/home' });
const memory = await engine.recall({ event: ['DECISION'] });
const preview = await engine.check('feat: ordinary proposed commit');
console.log(memory.results, preview.ok);
```

Catalog handles close after each operation. Read snapshots obtained through the
lower-level API must be released in `finally`; ordinary query methods do this
automatically. Local generated indexes are environment-scoped beneath
`.zmem/index/PLATFORM-ARCH`; user state uses a versioned `v2` directory. Existing
zmem/zmem-cache databases, runtimes, and Python extensions are not migrated or
modified. Roll back by selecting the old installation and its unchanged data.

See [verification](docs/verification.md) for measured behavior and platform coverage.
