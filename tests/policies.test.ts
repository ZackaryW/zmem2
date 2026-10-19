import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.js';
import { MemoryEngine } from '../src/core/engine.js';
import { GitRepo } from '../src/core/git.js';

test('path aliases and worktrees have correct repository/location identity', () => {
  const f = fixture();
  try {
    f.commit('feat: initial');
    const a = new MemoryEngine(f.repo, { home: f.home }),
      alias = new MemoryEngine(`${f.repo}/.`, { home: f.home });
    assert.deepEqual(a.registration, alias.registration);
    f.git('worktree', 'add', '-b', 'work', '../work');
    const b = new MemoryEngine(`${f.root}/work`, { home: f.home });
    assert.equal(a.registration.repository, b.registration.repository);
    assert.notEqual(a.registration.location, b.registration.location);
    const c = new MemoryEngine(f.clone('clone'), { home: f.home });
    assert.notEqual(a.registration.repository, c.registration.repository);
    const other = new GitRepo(f.repo);
    assert.throws(() => other.select('HEAD', 0));
    assert.throws(() => other.select('HEAD', 500, 400, '0'.repeat(40)), /reference moved/);
  } finally {
    f.clean();
  }
});

test('META merge keeps concurrent conflict until descendant resolution', async () => {
  const f = fixture();
  try {
    const a = f.commit('feat: choose\n\nzmem(DECISION): storage');
    f.git('branch', 'side');
    f.git('commit', '--allow-empty', '-m', `feat: owner\n\nzmem(META)[${a}, ${a}, owner=alpha]`);
    f.git('checkout', 'side');
    f.git('commit', '--allow-empty', '-m', `feat: owner\n\nzmem(META)[${a}, ${a}, owner=beta]`);
    f.git('checkout', 'main');
    f.git('merge', '--no-ff', 'side', '-m', 'feat: merge');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const conflict = (await engine.recall()).results[0]!;
    assert.equal(conflict.owner, null);
    assert.deepEqual(conflict.metadata_conflicts.owner, ['"alpha"', '"beta"']);
    f.git('commit', '--allow-empty', '-m', `feat: resolve\n\nzmem(META)[${a}, ${a}, owner=gamma]`);
    const resolved = (await engine.recall()).results[0]!;
    assert.equal(resolved.owner, 'gamma');
    assert.deepEqual(resolved.metadata_conflicts, {});
  } finally {
    f.clean();
  }
});

test('merge decay agrees with independent unique-contribution calculation', async () => {
  const f = fixture();
  try {
    const a = f.commit('feat: choice\n\nzmem(DECISION): storage');
    f.git('commit', '--allow-empty', '-m', `feat: common\n\nzmem(DECAY)[${a}, 1, 0.5]`);
    f.git('branch', 'side');
    f.git('commit', '--allow-empty', '-m', `feat: main\n\nzmem(DECAY)[${a}, 1, 0.8]`);
    f.git('checkout', 'side');
    f.git('commit', '--allow-empty', '-m', `feat: side\n\nzmem(DECAY)[${a}, 1, 0.25]`);
    f.git('checkout', 'main');
    f.git('merge', '--no-ff', 'side', '-m', 'feat: merge');
    const reachable = new Set(f.git('rev-list', 'HEAD').split('\n'));
    let expected = 1;
    for (const oid of reachable) {
      const message = f.git('show', '-s', '--format=%B', oid);
      for (const match of message.matchAll(/zmem\(DECAY\)\[[^,]+,\s*1,\s*([\d.]+)\]/g))
        expected *= Number(match[1]);
    }
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const first = await engine.recall();
    assert.equal(first.results[0]?.score, expected);
    const count = engine.metrics.expansions;
    await engine.recall();
    assert.equal(engine.metrics.expansions, count);
  } finally {
    f.clean();
  }
});

test('segment commit cap and short-lived read leases are enforced', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 5; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    f.user({ segments: { max_commits: 2 } });
    const engine = new MemoryEngine(f.repo, { home: f.home });
    await engine.recall();
    assert.deepEqual(
      engine.local
        .rows()
        .map((r) => JSON.parse(r.manifest).commits.length)
        .sort(),
      [1, 2, 2],
    );
    const pack = engine.local.rows()[0]!;
    const release = engine.local.lease([pack.id]);
    const result = engine.local.evict(0);
    assert.ok(result.over_capacity);
    assert.equal(engine.local.row(pack.id)?.resident, 1);
    release();
    assert.equal(engine.local.evict(0).over_capacity, false);
  } finally {
    f.clean();
  }
});
