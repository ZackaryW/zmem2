# Implementation verification

All 51 tests pass on Windows x64 with both Node 24.22.0 and 26.8.2. The integration
suite uses temporary repositories and isolated user homes. It covers CLI/library
parity, computed effects and merge ancestry, stable-boundary promotion, three
locations, incompatible extensions, unique local tails, active readers, process
death, corruption, eviction/rebuild, missing inputs, lowered limits, oversized
commits, and durable failed-hook records.
Repository lifecycle coverage verifies `init` and `sync`, positional paths,
preservation of config/ignore content, repeat initialization, incremental/no-op
sync, trackable extension sources, and initialization before the first commit.

```console
npm ci --ignore-scripts
npm run typecheck
npm run format:check
npm test
npm pack
openspec validate rebuild-zmem-computed-segments --strict
```

The packaged tarball is also installed into a separate temporary npm project.
Smoke checks exercise its CLI, public library import, built-ins, and trusted
JavaScript extension loading without the predecessor service.

## Measurements

These are observed single runs under Node 26.8.2 on this Windows machine, not cross-language
comparisons or throughput guarantees. Each history has one DECISION per commit,
eight commits per segment, and ten warm recall calls. Git process startup and
SQLite access are included in query timings. Reproduce with `npm run bench`;
`ZMEM_BENCH_COMMITS` changes history size.

| Measurement                             | 40 commits | 160 commits |
| --------------------------------------- | ---------: | ----------: |
| Segments                                |          5 |          20 |
| Cold recall                             |   3,535 ms |   13,718 ms |
| Mean warm recall                        |      63 ms |      124 ms |
| Historical expansions during warm calls |          0 |           0 |
| Indexed key lookup page visits          |          3 |           3 |
| Peak pending encoded construction bytes |     61,980 |      71,261 |
| Resident local payload bytes            |    204,059 |   1,115,756 |
| Process RSS at end of run               | 87,719,936 | 146,608,128 |

The 40-commit column was remeasured from the final staged snapshot during R5.
The 160-commit column retains the earlier recorded measurement of the same
engine. Git identities affect radix-page packing, so payload sizes can vary
between independently generated histories.

The pending-byte measurement bounds serialized construction pages; it is not a
measurement of peak JavaScript heap. The larger warm query returns four times as
many entries and verifies a larger dependency closure. Individual key lookup
does not walk the twenty-segment inheritance chain. Entry scans also skip
unrelated commit/effect/diagnostic namespaces.

## Remaining platform verification

OpenSpec task 9.4 remains unchecked because Linux/macOS lifecycle execution has
not run in this Windows session. Docker's Linux daemon is unavailable here.
The GitHub Actions matrix runs Node 24/26 on Windows, Ubuntu, and macOS when
the workflow is executed. A prepared workflow is not evidence of a passing run.

## Review checkpoint

Earlier work was verified in a combined working tree without a complete
incremental checkpoint record. After the user authorized incremental commits,
the existing work was reconciled into the following sequence. These are newly
created checkpoints, not a claim about the earlier implementation order.

| Commit                                                         | Independently verified staged snapshot                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `0155dc1`                                                      | Package/helpers: clean install, typecheck, four utility tests, formatting                                                            |
| `c312595`                                                      | Core storage/contracts: build, five focused primitive tests, formatting                                                              |
| `04058d3`                                                      | Compiler/extensions: build, two focused computation/surface tests, formatting                                                        |
| `0f544d7`                                                      | Integrated engine/CLI: typecheck, 51 tests on Node 24/26, formatting and installed-package smoke                                     |
| `docs: reconcile verified checkpoints and acceptance evidence` | CI, benchmark/report and OpenSpec reconciliation; formatting, benchmark execution, strict artifact validation and final scope review |

Each staged snapshot was exported to a separate temporary directory so unstaged
implementation could not mask missing dependencies. Initial package metadata
introduced the build/helpers first; the public library and executable were
declared when the integrated engine landed. Source and test contents were
preserved, with focused tests moved to their owning layer. Two additional tests
verify isolated catalog lifecycle and compound compiler rollback, increasing
the previous 49-test suite to 51.

The clean Windows checkout check exposed CRLF conversion conflicting with the
formatter's LF policy. `.gitattributes` now makes text checkout endings explicit.
The config rules were preserved; task IDs and existing completion states were
retained, and pending platform execution was not marked complete.

Focused commit messages are validated through zmem before committing. The two
DECISION entries record effective extension fingerprinting and the approved
stable, compatible, two-location promotion rule. Ordinary implementation and
process-reporting commits need no memory annotation. Nothing was pushed or
archived; archive-only temporary-state cleanup has not run.

## Nested ignore refinement and pilot rollout

Checkpoint `338b158` reconciles the init proposal/design/specification with
`.zmem/.gitignore` containing `/index/`. Root ignore files remain absent or
byte-for-byte unchanged. The five focused CLI tests passed on Windows Node
26.8.2 in the working tree and Node 24.22.0 in an exported staged snapshot after
a clean install/build. Coverage includes unborn and committed repositories,
repeat init, preserved custom content/newlines and equivalent rules, legacy root
rules, Git ignore provenance for three platform paths, and trackable config and
extension sources. These path checks do not constitute execution on other hosts.
Formatting, skill validation and strict OpenSpec validation also passed.

The rebuilt package was installed in `~/.zmem-pilots/test-pilot/runtime`; its
engine matched the build. The installed query-skill setup reference was backed
up, updated, validated and compared with the source. The pilot's init created
the nested rule without changing root bytes. After checking Git provenance,
only the known generated root rule was removed. Pilot commit `a1530fe` records
that migration and its documentation. No global runtime was replaced.

Repeated init preserved both ignore files. Init and warm sync computed zero
commits, expansions and effects; recall before/after was identical. After the
migration commit, both memory entries remained unchanged and warm sync again
computed nothing. Git confirmed that config, extension sources and the nested
ignore file remained trackable. Evidence is retained under
`~/.zmem-pilots/test-pilot/evidence/ignore-01` through `ignore-09` command records.
Both source and pilot commit messages passed computed checks and post-commit
inspection. Task 10.6 is complete; task 9.4 remains open.
