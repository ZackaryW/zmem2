# Setup and recovery

Use this reference for requested lifecycle work or diagnosing availability, not
as mandatory steps before every query. Confirm the selected TypeScript CLI with
its executable location and `--help`; preserve the user's chosen `--home`.

## Initialize and synchronize

```console
zmem init PATH
zmem sync PATH
zmem status PATH
```

`init` registers the location, creates missing `.zmem/config.yaml`, ensures
`/index/` in `.zmem/.gitignore`, and computes initial memory. It preserves existing
configuration and nested ignore content/newline style, recognizing `/index/` and
`index/` without duplication. It neither creates nor changes the root `.gitignore`.
Legacy root rules remain untouched; remove a known generated rule only as part of
a requested migration after verifying the nested rule. An unborn repository is
registered without a segment; sync after its first commit. `index` aliases sync.
Configuration, extension sources and `.zmem/.gitignore` stay trackable.

Local generated state lives under `.zmem/index/PLATFORM-ARCH`. User policy is
`~/.zmem/config.yaml`, shared state is `~/.zmem/v2/`, and reusable extension
installations are `~/.zmem/extensions/ID/VERSION`. `--home` or `ZMEM_HOME` selects
another user root. Do not share live catalog directories between environments.

## Enable sharing deliberately

```console
zmem --repo FIRST_PATH init
zmem --repo FIRST_PATH config --user --stable-ref main
zmem --repo SECOND_PATH init --associate REPOSITORY_ID
zmem --repo SECOND_PATH sync
zmem --repo FIRST_PATH config --user
```

Copy the repository ID from the first init response. `main` is an example, not
an assumed stable branch: select the user's intended boundary. Use
`--stable-oid FULL_COMMIT_ID` instead for an explicit commit boundary. These
commands append a boundary to user policy; inspect existing policy first.

Worktrees sharing a Git common directory associate automatically. Separate
clones need explicit association and a verified witness commit. Equal remote
URLs do not prove identity. User installations do not enable extensions globally;
each repository selects its own surface.

Promotion defaults to two total completed compatible computations across at
least two verified locations, including the first completion. Warm reads,
adoption, polling, failed work and previews do not count. Stable coverage and
compatible base, range, selected attention, evaluator and extension inputs must
also match. No configured stable boundary means local indexing still works but
promotion is ineligible. Same commits with different effective extensions cannot
share results.

Edit the selected user's config for budgets and thresholds; these keys are
supported (merge with existing settings):

```yaml
promotion:
  enabled: true
  min_computations: 2
  stable_boundaries: []
segments:
  max_commits: 256
  max_bytes: 16777216
cache:
  max_bytes: 1073741824
profiles:
  max_entries: 4096
  retention_days: 30
```

An empty boundary list does not enable sharing. Keep configured boundaries when
changing other settings. Profiles track bounded, expiring completion observations;
they are separate from payload LRU demand recency.

## Diagnose before changing state

Use `status` to inspect local/shared segment residency, pending/failed claims and
hook receipts. A claim is not a published result. A compatible ready result can
be adopted before local computation; unique tails remain local. Busy/unavailable
central coordination may allow independent local indexing.

| Observation            | Appropriate next step                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No promotion           | Check association, distinct completed locations, stable boundary, and effective extension compatibility. Repeating warm queries does not help.        |
| Shared payload evicted | Query/sync can rebuild from recorded Git and compatible extension inputs. Local pointers are not permanent pins.                                      |
| `missing_inputs`       | Restore the required Git objects or compatible captured inputs if available; report the unavailable result otherwise. Do not substitute empty memory. |
| `segment_too_large`    | Inspect the indivisible commit/result and user limits. Splitting works only at whole-commit boundaries; increasing a budget is a policy decision.     |
| Failed claim           | Inspect the error and correct its cause before an explicitly chosen retry.                                                                            |
| Failed/uncertain hook  | Inspect whether its external action already happened; decide whether redelivery is appropriate. Eviction/rebuilding must not authorize it.            |

```console
zmem --repo PATH evict --limit 536870912
zmem --repo PATH retry JOB_OR_HOOK_KEY
```

Evict's limit is the target shared payload budget in bytes, not bytes to delete.
Active readers/publications protect dependencies; pressure can remain when all
remaining data is protected. Idle pointers allow LRU eviction and later rebuild.
Never manually delete catalogs or shared payloads as a substitute for this flow.

`retry` explicitly resets a failed/uncertain record. It does not itself execute
a hook; a later indexing operation may deliver the reset event. Successful,
failed and uncertain observer receipts survive payload eviction. Hooks are
external side effects, so an uncertain delivery does not imply it never ran.
