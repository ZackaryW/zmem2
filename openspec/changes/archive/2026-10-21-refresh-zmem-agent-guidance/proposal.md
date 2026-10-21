# Proposal

## Why

The installed zmem skills describe the predecessor Python/service product and recommend commands and extension APIs the TypeScript engine does not support. Agents need a compact entry point and accurate, selectively loaded references, following CodeGraph's separation of everyday guidance and specialist workflows.

## What Changes

- Maintain the three existing skill names in version-controlled `skills/` sources and ship them in the npm package.
- Refresh query guidance for computed results, literal search, newest-first ordering, coverage, and provenance.
- Encourage automatic repository initialization when a needed index is missing, unless the user has opted out; distinguish missing derived state from unavailable tooling or failed computation.
- Refresh authoring guidance for computed proposal checks and explicit deep audits; retain incremental commit and target-verification practices.
- Rewrite extension guidance around declarative types, typed DSL operations, and trusted JavaScript registration, including sharing identity and observer receipts.
- Add a linked setup/recovery reference rather than a fourth skill, and a short agent guide surfaced in the README and CLI help.
- Verify the new runtime before applying new commands; preserve the current runtime installation and back up existing skill files before updating the three user-installed copies.

## Capabilities

### New Capabilities

None. This documentation and packaging change uses `skip_specs: true`; it does not add runtime behavior or a new tool API.

### Modified Capabilities

None. Existing computed-memory semantics and result formats remain the contract.

## Impact

Touches `skills/`, `docs/`, README, CLI help text, package file/format lists, and the three corresponding user skill directories. No MCP server, installer command, automatic agent-instructions injection, global executable replacement, extension runtime change, or dependency addition. The prior rebuild's pending Linux/macOS lifecycle verification remains separate.
