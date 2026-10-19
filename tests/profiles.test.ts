import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.js';
import { MemoryEngine } from '../src/core/engine.js';
import { Coordinator } from '../src/core/coordinator.js';
import { UserConfigSchema } from '../src/core/config.js';

test('completion accounting is bounded, idempotent, and cross-location', async () => {
  const f = fixture();
  try {
    f.commit('feat: initial\n\nzmem(DECISION): A');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const pack = await engine.index({ preview: true });
    const coordinator = engine.coordinator!;
    const now = Date.now();
    assert.equal(coordinator.observe(pack, 'a', `${now}:first`, now), 0);
    assert.equal(coordinator.observe(pack, 'a', `${now}:first`, now), 0);
    assert.equal(coordinator.observe(pack, 'b', `${now + 1}:second`, now + 1), 2);
    for (let i = 2; i < 102; i++) coordinator.observe(pack, 'a', `${now + i}:repeat`, now + i);
    const count = coordinator.catalog.db(
      (db) => db.prepare('SELECT count(*) AS n FROM observations').get() as { n: number },
    );
    assert.equal(count.n, 2);
  } finally {
    f.clean();
  }
});

test('profile capacity cannot turn an old completion into new demand', async () => {
  const f = fixture();
  try {
    f.commit('feat: initial\n\nzmem(DECISION): A');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const pack = await engine.index({ preview: true });
    const coordinator = new Coordinator(
      engine.coordinator!.catalog,
      UserConfigSchema.parse({ profiles: { max_entries: 1 } }),
    );
    const now = Date.now();
    coordinator.observe(pack, 'a', `${now}:first`, now);
    coordinator.observe({ ...pack, id: 'other' }, 'b', `${now + 10}:other`, now + 10);
    assert.equal(coordinator.observe(pack, 'a', `${now}:first`, now + 20), 0);
    assert.equal(coordinator.count(pack.id), 0);
  } finally {
    f.clean();
  }
});

test('stable frontier qualification rejects an active tail and missing ref', async () => {
  const f = fixture();
  try {
    const a = f.commit('feat: stable\n\nzmem(DECISION): A');
    f.commit('feat: tail\n\nzmem(DECISION): B');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const pack = await engine.index({ preview: true });
    const settings = UserConfigSchema.parse({
      promotion: { stable_boundaries: [{ repository: engine.registration.repository, oid: a }] },
    });
    const coordinator = new Coordinator(engine.coordinator!.catalog, settings);
    assert.equal(coordinator.stable(engine.repo, pack), undefined);
    settings.promotion.stable_boundaries = [
      { repository: engine.registration.repository, ref: 'missing' },
    ];
    assert.equal(coordinator.stable(engine.repo, pack), undefined);
    settings.promotion.stable_boundaries = [
      { repository: engine.registration.repository, ref: 'main' },
    ];
    assert.equal(coordinator.stable(engine.repo, pack), engine.repo.resolve());
    f.git('update-ref', 'refs/heads/main', a);
    assert.equal(coordinator.stable(engine.repo, pack), undefined);
  } finally {
    f.clean();
  }
});

test('a force-moved stable boundary rolls back ready publication and records no proof', async () => {
  const f = fixture();
  try {
    const first = f.commit('feat: first\n\nzmem(DECISION): first');
    f.commit('feat: second\n\nzmem(DECISION): second');
    f.git('branch', 'stable');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const pack = await engine.index({ preview: true });
    const coordinator = new Coordinator(
      engine.coordinator!.catalog,
      UserConfigSchema.parse({
        promotion: {
          stable_boundaries: [{ repository: engine.registration.repository, ref: 'stable' }],
        },
      }),
    );
    const now = Date.now();
    coordinator.observe(pack, 'a', `${now - 1}:a`, now);
    coordinator.observe(pack, 'b', `${now}:b`, now);
    const stable = coordinator.stable.bind(coordinator);
    let checks = 0;
    coordinator.stable = (repo, p) => {
      if (++checks === 4) f.git('update-ref', 'refs/heads/stable', first);
      return stable(repo, p);
    };
    assert.throws(
      () => coordinator.promote(engine.repo, pack, engine.local, (id) => engine.local.load(id)),
      /stable boundary moved/,
    );
    assert.equal(coordinator.catalog.rows().length, 0);
    assert.equal(coordinator.catalog.status().qualifications.length, 0);
    assert.equal(engine.local.row(pack.id)?.resident, 1);
  } finally {
    f.clean();
  }
});
