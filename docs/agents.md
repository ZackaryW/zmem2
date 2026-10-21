# Using zmem with an agent

Zmem provides computed repository memory from Git annotations. Use it when
investigating recorded decisions, constraints, lessons, or superseded choices.
Start with `recall`; use `search` for literal topic matching and `show` to inspect
an origin. Results already incorporate cancellation, decay and metadata effects.
Check the selected snapshot and attention coverage, then corroborate applicability
against current code, tests and specifications.

## Start here

Confirm the executable location, `zmem --version` and `zmem --help`. These guides
target the TypeScript CLI whose help exposes `init`, `sync` and file/stdin checks.
The predecessor also uses the name `zmem`. A version string alone is insufficient;
use the intended executable explicitly rather than silently changing PATH.
From a built checkout, substitute `node /absolute/path/to/dist/src/cli/main.js`.

```console
zmem --repo PATH recall --event DECISION
zmem --repo PATH search "SQLite"
zmem --repo PATH show COMMIT
```

Queries return JSON and can build missing derived state. Search is literal,
case-insensitive substring matching; recall/search order is newest-first, not
semantic relevance. An empty answer with bounded attention is not proof that no
older decision exists. There is no MCP server in this product version.

## Load only the workflow needed

- [zmem-query-memory](../skills/zmem-query-memory/SKILL.md): everyday retrieval,
  selected-snapshot provenance and coverage interpretation.
- `zmem-author-commits`: durable annotations and proposal validation when authoring
  or reviewing commits.
- `zmem-design-extensions`: declarative types, DSL and JavaScript when adding
  annotation behavior.

For initialization, clone association, stable boundaries, cache budgets or failed
work, use the linked [setup and recovery reference](../skills/zmem-query-memory/references/setup-and-recovery.md).
Ordinary memory retrieval does not require changing those settings.

## Install the skills

The package ships canonical skill folders under `skills/`. Copy the three
`zmem-*` folders from the selected package or checkout into your agent's skill
directory (for Codex, `$CODEX_HOME/skills` or `~/.codex/skills`). Back up existing
copies outside that directory first; preserve unrelated files and any local
invocation policy in `agents/openai.yaml`. Copy references together with SKILL.md.
Future updates should come from the same product version's skill sources.

Skill installation does not replace the zmem executable, migrate databases,
enable extensions or inject instructions into AGENTS.md. To roll back guidance,
restore the backed-up files and remove only new files introduced by that copy.

This presentation follows CodeGraph's compact everyday guidance and selectively
loaded specialist workflows. Zmem memory remains historical evidence, so its
applicability must still be checked against the current repository.
