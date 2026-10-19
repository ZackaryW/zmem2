import { test } from 'node:test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { MemoryEngine } from '../src/core/engine.js';
import { fixture } from './fixtures.js';
import { MemoryError } from '../src/core/contracts.js';

test('effects are materialized, reused, and previewed without persistence', async () => {
  const f = fixture();
  try {
    const a = f.commit('feat: choose\n\nzmem(DECISION): use JSON');
    f.commit(`feat: decay\n\nzmem(DECAY)[${a}, 1, 0.5]`);
    const engine = new MemoryEngine(f.repo, { home: f.home });
    assert.equal((await engine.recall()).results[0]?.score, 0.5);
    const mutableResult = await engine.recall();
    mutableResult.results[0]!.tags.push('caller-only');
    assert.deepEqual((await engine.recall()).results[0]!.tags, []);
    const initial = engine.metrics.expansions;
    assert.equal((await engine.recall()).results[0]?.score, 0.5);
    assert.equal(engine.metrics.expansions, initial);
    const check = await engine.check(`feat: change\n\nzmem(CANCEL)[${a}, 1]`);
    assert.equal(check.ok, true);
    assert.equal(check.effects[0]?.after.valid, false);
    assert.equal((await engine.recall()).results[0]?.valid, true);
    f.commit(`feat: cancel\n\nzmem(CANCEL)[${a}, 1]`);
    assert.equal((await engine.recall()).results.length, 0);
    assert.equal((await engine.recall({ includeInvalid: true })).results[0]?.score, 0);
    assert.equal(engine.metrics.computed_commits, 3);
  } finally {
    f.clean();
  }
});

test('second compatible location promotes, third adopts, eviction rebuilds', async () => {
  const f = fixture();
  try {
    f.commit('feat: decision\n\nzmem(DECISION): SQLite');
    const a = new MemoryEngine(f.repo, { home: f.home });
    f.user({
      promotion: { stable_boundaries: [{ repository: a.registration.repository, ref: 'main' }] },
    });
    const first = new MemoryEngine(f.repo, { home: f.home });
    await first.recall();
    assert.equal(first.coordinator!.catalog.rows().length, 0);
    const b = new MemoryEngine(f.clone('b'), {
      home: f.home,
      associate: a.registration.repository,
    });
    const second = await b.recall();
    assert.equal(b.metrics.computed_commits, 1);
    assert.equal(b.coordinator!.catalog.rows().filter((r) => r.resident).length, 1);
    const c = new MemoryEngine(f.clone('c'), {
      home: f.home,
      associate: a.registration.repository,
    });
    assert.deepEqual((await c.recall()).results, second.results);
    assert.equal(c.metrics.computed_commits, 0);
    assert.equal(c.local.rows()[0]?.pointer, 1);
    c.coordinator!.catalog.evict(0);
    assert.deepEqual((await c.recall()).results, second.results);
    assert.equal(c.metrics.computed_commits, 1);
    f.user({ cache: { max_bytes: 1 } });
    const constrained = new MemoryEngine(c.repo.root, { home: f.home });
    assert.equal(constrained.coordinator!.catalog.bytes(), 0);
    assert.equal(constrained.metrics.computed_commits, 0);
    assert.equal(constrained.local.row(second.trail.id)?.pointer, 1);
  } finally {
    f.clean();
  }
});

test('branch cancellation and common merge decay are isolated', async () => {
  const f = fixture();
  try {
    const a = f.commit('feat: choose\n\nzmem(DECISION): A');
    f.commit(`feat: common decay\n\nzmem(DECAY)[${a}, 1, 0.5]`);
    f.git('branch', 'side');
    f.commit(`feat: cancel\n\nzmem(CANCEL)[${a}, 1]`);
    const engine = new MemoryEngine(f.repo, { home: f.home });
    assert.equal((await engine.recall()).results.length, 0);
    assert.equal((await engine.recall({ ref: 'side' })).results[0]?.score, 0.5);
    f.git('checkout', 'side');
    f.git('commit', '--allow-empty', '-m', 'feat: side');
    f.git('checkout', 'main');
    f.git('merge', '--no-ff', 'side', '-m', 'feat: merge');
    assert.equal((await engine.recall({ includeInvalid: true })).results[0]?.score, 0);
  } finally {
    f.clean();
  }
});

test('whole commit attention and oversized commit fail without partial publication', async () => {
  const f = fixture();
  try {
    f.commit('feat: data\n\nzmem(DECISION): A\nzmem(LESSON_LEARNT): B');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const bounded = await engine.recall({ nodeLimit: 1 });
    assert.equal(bounded.results.length, 0);
    assert.equal(bounded.attention.truncated, true);
    f.user({ segments: { max_bytes: 500 } });
    const small = new MemoryEngine(f.repo, { home: f.home });
    await assert.rejects(
      small.index({ force: true }),
      (error) => error instanceof MemoryError && error.code === 'segment_too_large',
    );
  } finally {
    f.clean();
  }
});

test('an active local reader survives pointer handoff and duplicate reclamation', async () => {
  const f = fixture();
  try {
    f.commit('feat: choose\n\nzmem(DECISION): SQLite');
    const registered = new MemoryEngine(f.repo, { home: f.home });
    f.user({
      promotion: {
        stable_boundaries: [{ repository: registered.registration.repository, ref: 'main' }],
      },
    });
    const a = new MemoryEngine(f.repo, { home: f.home });
    await a.recall();
    const old = await a.read();
    const oldPath = a.local.row(old.segment.id)!.path;
    try {
      const b = new MemoryEngine(f.clone('b'), {
        home: f.home,
        associate: a.registration.repository,
      });
      await b.recall();
      await a.recall();
      assert.equal(a.local.row(old.segment.id)?.pointer, 1);
      assert.equal(existsSync(oldPath), true);
      assert.equal([...old.state.entries('entry:')].length, 1);
    } finally {
      old.release();
    }
    assert.equal(existsSync(oldPath), false);
  } finally {
    f.clean();
  }
});
