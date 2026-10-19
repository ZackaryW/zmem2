import { fixture } from '../dist/tests/fixtures.js';
import { MemoryEngine } from '../dist/src/core/engine.js';
import { StateMap } from '../dist/src/core/state-map.js';
import { performance } from 'node:perf_hooks';

const f = fixture();
try {
  const commits = Number(process.env.ZMEM_BENCH_COMMITS ?? 40);
  for (let i = 0; i < commits; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): memory ${i}`);
  f.user({ segments: { max_commits: 8 } });
  const engine = new MemoryEngine(f.repo, { home: f.home });
  const start = performance.now();
  await engine.recall();
  const coldMs = performance.now() - start;
  const before = { ...engine.metrics };
  const warm = performance.now();
  for (let i = 0; i < 10; i++) await engine.recall();
  const warmMs = (performance.now() - warm) / 10;
  const snapshot = await engine.read();
  let visits;
  try {
    const entry = [...snapshot.state.entries('entry:')][0];
    const state = new StateMap(snapshot.state.root, (hash) => snapshot.state.page(hash));
    if (entry) state.get(entry[0]);
    visits = state.visits;
  } finally {
    snapshot.release();
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        commits,
        cold_ms: coldMs,
        warm_mean_ms: warmMs,
        warm_expansions: engine.metrics.expansions - before.expansions,
        lookup_page_visits: visits,
        peak_pending_encoded_bytes: engine.metrics.peak_construction_bytes,
        resident_payload_bytes: engine.local.bytes(),
        process_rss_bytes: process.memoryUsage().rss,
        segments: engine.local.rows().length,
      },
      null,
      2,
    ),
  );
} finally {
  f.clean();
}
