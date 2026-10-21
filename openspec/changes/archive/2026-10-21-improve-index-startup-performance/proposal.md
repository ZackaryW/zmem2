# Proposal

## Why

The large pilot returned its first 400-entry view after 35.6 seconds and exhausted all three 30-second background attempts before a segment sealed. Computed-state reuse is correct, but repeated Git selection still cost 16.9 seconds for one new commit.

## What Changes

- Use a user-configurable 64-commit initial foreground window (the user's accepted replacement for 32), preserving annotation limits and explicit attention overrides.
- Prefer compatible complete memory and extend it when the selected head advances, rather than reverting to a narrow startup view.
- Batch Git commit metadata reads and persist a bounded, pinned background selection plan for reuse between segment workers.
- Default worker deadlines to 90 seconds, retaining configurable finite deadlines, retries, two workers/eight waiting jobs, staged publication and existing segment bounds.
- Measure the packaged implementation against the existing 540-commit synthetic pilot and retain failure evidence from the earlier runtime.

## Capabilities

### New Capabilities

- `index-startup-performance`: initial window policy, complete-coverage reuse and reusable background history planning.

### Modified Capabilities

None in main specs (the inventory is empty). Reconcile the overlapping requirements in the unarchived rebuild and background-backfill artifacts with this change, without archiving them or altering their completed-task history.

## Impact

Core configuration, Git history access, engine selection/reuse, staged workers, CLI/config documentation, focused tests and packaged pilot evidence. TypeScript remains the runtime. No new runtime dependency, extension contract, sharing qualification or queue capacity change.
