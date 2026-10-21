import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryEngine } from '../src/core/engine.js';
import { BackgroundQueue } from '../src/core/background-queue.js';
import { backfillTarget, computeBackfillSegment } from '../src/core/background-compute.js';
import { fixture, extension } from './fixtures.js';

test('private sequential segments preserve preview then publish full effect-correct history', async () => {
  const f = fixture();
  try {
    f.user({ segments: { max_commits: 2 } });
    const old = f.commit('feat: old\n\nzmem(DECISION): old decision');
    f.commit('feat: second\n\nzmem(LESSON_LEARNT): second');
    f.commit('feat: third\n\nzmem(DECISION): third');
    f.commit(`fix: retire\n\nzmem(CANCEL)[${old}, 1]`);
    f.commit('chore: tail');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const preview = await engine.recall({ commitLimit: 2, nodeLimit: -1 });
    const q = new BackgroundQueue(f.home),
      admission = q.admit(backfillTarget(engine));
    const s = q.acquireSupervisor()!;
    let job = q.dispatch(s)!;
    const first = await computeBackfillSegment(f.home, job.id, job.token!);
    assert.equal(first.complete, false);
    assert.equal(first.commits, 2);
    assert.deepEqual(await engine.recall({ commitLimit: 2, nodeLimit: -1 }), preview);
    assert.equal(
      engine.local.view(engine.computation({ commitLimit: -1, nodeLimit: -1 }).key),
      undefined,
    );
    q.settle(job.id, job.token!, first, 3);
    job = q.dispatch(s)!;
    const second = await computeBackfillSegment(f.home, job.id, job.token!);
    assert.equal(second.complete, false);
    assert.equal(second.commits, 4);
    q.settle(job.id, job.token!, second, 3);
    job = q.dispatch(s)!;
    const third = await computeBackfillSegment(f.home, job.id, job.token!);
    assert.equal(third.complete, true);
    assert.equal(third.commits, 5);
    q.settle(job.id, job.token!, third, 3);
    const full = await engine.recall({ commitLimit: -1, nodeLimit: -1, includeInvalid: true });
    assert.equal(full.attention.truncated, false);
    assert.equal(full.results.find((e) => e.sha === old)?.valid, false);
    assert.equal(q.get(admission.job_id!)?.state, 'completed');
    const warm = new MemoryEngine(f.repo, { home: f.home });
    await warm.recall({ commitLimit: -1, nodeLimit: -1 });
    assert.equal(warm.metrics.computed_commits, 0);
    assert.equal(engine.coordinator!.catalog.rows().filter((r) => r.resident).length, 0);
  } finally {
    f.clean();
  }
});

test('private construction defers hooks and publication preserves failed receipts', async () => {
  const f = fixture();
  try {
    f.user({ segments: { max_commits: 1 } });
    extension(
      f.repo,
      {
        id: 'observer',
        version: '1.0.0',
        entry: 'extension.mjs',
        deterministic: true,
        types: { RISK: { kind: 'entry', handler: 'risk' } },
      },
      `export function register(r){r.extend('RISK',{expand(c){c.addEntry({type:'RISK',content:c.annotation.content});}});r.afterIndex('notify',()=>{throw Error('uncertain');});}`,
    );
    f.commit('feat: risk\n\nzmem(RISK): first');
    f.commit('feat: next\n\nzmem(RISK): second');
    const e = new MemoryEngine(f.repo, { home: f.home, trust: true }),
      q = new BackgroundQueue(f.home);
    q.admit(backfillTarget(e));
    const s = q.acquireSupervisor()!;
    let j = q.dispatch(s)!;
    const first = await computeBackfillSegment(f.home, j.id, j.token!);
    assert.equal(e.coordinator!.catalog.status().hooks.length, 0);
    q.settle(j.id, j.token!, first, 3);
    j = q.dispatch(s)!;
    const last = await computeBackfillSegment(f.home, j.id, j.token!);
    assert.equal(last.complete, true);
    const receipts = e.coordinator!.catalog.status().hooks;
    assert.equal(receipts.length, 2);
    assert.ok(receipts.every((r) => r.state === 'failed'));
    e.local.evict(0);
    await e.recall({ commitLimit: -1, nodeLimit: -1 });
    assert.deepEqual(e.coordinator!.catalog.status().hooks, receipts);
  } finally {
    f.clean();
  }
});

test('revoked ownership and storage budget prevent publication', async () => {
  const f = fixture();
  try {
    f.commit('feat: one\n\nzmem(DECISION): one');
    f.user({ background: { max_staging_bytes: 1 } });
    const e = new MemoryEngine(f.repo, { home: f.home }),
      q = new BackgroundQueue(f.home);
    q.admit(backfillTarget(e));
    const s = q.acquireSupervisor()!,
      job = q.dispatch(s)!;
    await assert.rejects(computeBackfillSegment(f.home, job.id, job.token!), /budget/);
    q.control(job.id, 'cancel');
    await assert.rejects(computeBackfillSegment(f.home, job.id, job.token!), /revoked/);
    assert.equal(e.local.rows().length, 0);
  } finally {
    f.clean();
  }
});
