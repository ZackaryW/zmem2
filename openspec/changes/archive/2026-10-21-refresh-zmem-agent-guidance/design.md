# Design

## Context

See proposal.md for motivation. The engine already exposes the required query, proposal-check, and extension behaviors. User-installed skills currently live outside this Git repository and are not packaged with the engine. CodeGraph's `src/installer/instructions-template.ts` provides a short conditional entry point, `src/mcp/server-instructions.ts` carries usage guidance, and `.claude/skills/add-lang/SKILL.md` demonstrates a specialist workflow with concrete verification. This change adapts those presentation boundaries to zmem's existing CLI.

## Goals / Non-Goals

**Goals:** Discoverable concise skill entry points, accurate command/API examples, portable supporting references, and reproducible source/package/user-copy correspondence.

**Non-Goals:** New retrieval/ranking behavior, natural-language search, MCP, automatic global instruction injection, a fourth skill, or changes to Git/cache semantics.

## Decisions

1. **Own skills in `skills/<existing-name>/`.** Include SKILL.md, existing UI metadata, and task-specific references in the npm tarball. This makes changes reviewable with their engine version rather than maintaining only mutable user-profile copies. Copy these three directories to the user's existing skill location after validation, preserving unrelated files and backing up overwritten content outside discovery paths.
2. **Keep entry points short and references selective.** Query is the everyday path; authoring and extension design are specialist workflows. Put setup/promotion/recovery under query references, link it from that skill and the repository agent guide. References travel with their skill; no hard-coded developer paths or required sibling repository links in installed content.
3. **Detect runtime capabilities before product operations.** `--version`, executable location, and `--help` distinguish installations; a version string alone is insufficient. The new help exposes init/sync and file/stdin checking. When the old binary is selected, report it and use an explicitly selected new executable if available; do not silently replace PATH or migrate data. Test this change with the repository's absolute built CLI and an isolated home.
4. **Teach current results rather than storage internals.** Query guidance covers literal search, newest-first order (not semantic relevance), attention versus result truncation, returned trail identity, branch-specific validity, and explicit errors. Normal checks reuse computed history; deep checks are isolated audits, not routine effect validation. Extension examples use register/extend, manifests, declared inputs and per-annotation rollback; observers require explicit retry decisions.
5. **Present a brief guide through existing surfaces.** Add `docs/agents.md`, README links and a short CLI-help usage paragraph. Keep the CLI command inventory authoritative; do not add a second machine API or generate broad instructions into user AGENTS.md. Link the specialist references from the guide, with a documented manual copy/install path.
6. **Bootstrap missing repository memory by default.** When a relevant memory query or commit check needs an absent index, use the selected TypeScript runtime to run `zmem init PATH`, retaining the selected home and snapshot/attention limits, then continue the operation without a separate permission request. Honor the user's explicit no-bootstrap instruction across subsequent operations; avoid cold queries/checks/status that would create state indirectly. Missing indexes are not an unavailable-engine fallback. If initialization fails, report the concrete error and continue using available evidence without a retry loop or false memory-verification claim. This does not install a runtime, migrate predecessor data, grant extension trust, associate separate clones, or change promotion policy. Keep the source skills, agent guide and local OpenSpec context consistent.

## Risks / Trade-offs

- [Old and new executables have the same command name] -> Capability preflight and absolute executable selection; preserve existing runtime/data.
- [Documentation examples drift from implementation] -> Exercise query, proposal and extension examples in temporary Git fixtures, run existing focused CLI/extension tests, validate all skills and relative links, and inspect tarball contents.
- [Installed copies diverge from versioned sources] -> Back up before copying, verify byte equality afterwards, and document reinstalling from the selected package version.
- [Instruction-only validation misses decision errors] -> Review realistic short-history query, cancellation preview, declarative/custom extension, and missing-shared-data recovery scenarios against current contracts; do not claim live-agent A/B measurements.

## Migration Plan

Commit three coherent checkpoints: everyday guide/query skill and package ownership; authoring/extension skills; verified user deployment and completion evidence. Run focused gates per checkpoint. Preserve existing UI invocation policy. Restore backed-up user files to roll back guidance; no runtime or database rollback is needed. Leave the separate rebuild change and its pending platform verification untouched.
