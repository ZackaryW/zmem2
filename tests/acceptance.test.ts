import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import { fixture } from './fixtures.js';
import { MemoryEngine } from '../src/core/engine.js';
import { GitRepo } from '../src/core/git.js';
import { MemoryError } from '../src/core/contracts.js';
import { annotations } from '../src/core/annotations.js';

test('three locations preserve a shared prefix, unique local tail, and incompatible surfaces', async () => {
  const f = fixture();
  try {
    f.commit('feat: common\n\nzmem(DECISION): common');
    const registration = new MemoryEngine(f.repo, { home: f.home }).registration;
    f.user({
      promotion: { stable_boundaries: [{ repository: registration.repository, ref: 'main' }] },
    });
    const a = new MemoryEngine(f.repo, { home: f.home });
    const common = await a.recall();
    const b = new MemoryEngine(f.clone('b'), { home: f.home, associate: registration.repository });
    await b.recall();
    const cPath = f.clone('c');
    execFileSync('git', [
      '-C',
      cPath,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'feat: tail\n\nzmem(LESSON_LEARNT): unique',
    ]);
    const c = new MemoryEngine(cPath, { home: f.home, associate: registration.repository });
    const tail = await c.recall();
    assert.equal(c.metrics.computed_commits, 1);
    assert.equal(tail.results.length, 2);
    assert.equal(c.local.row(common.trail.id)?.pointer, 1);
    const tailRow = c.local.row(tail.trail.id)!;
    assert.equal(tailRow.pointer, 0);
    c.adopt(common.trail.id);
    assert.equal(c.local.row(tail.trail.id)?.resident, 1);
    assert.equal(c.coordinator!.catalog.row(tail.trail.id), undefined);

    const ext = join(cPath, '.zmem', 'extensions', 'risk');
    mkdirSync(ext, { recursive: true });
    writeFileSync(
      join(ext, 'extension.yaml'),
      stringify({ id: 'risk', version: '1', types: { RISK: { kind: 'entry' } } }),
    );
    writeFileSync(
      join(cPath, '.zmem', 'config.yaml'),
      stringify({ extensions: [{ path: 'extensions/risk' }] }),
    );
    const changed = new MemoryEngine(cPath, { home: f.home });
    const different = await changed.recall();
    assert.notEqual(different.trail.surface, common.trail.surface);
    assert.equal(changed.metrics.computed_commits, 2);
    assert.equal(changed.local.row(different.trail.id)?.pointer, 0);
  } finally {
    f.clean();
  }
});

test('a higher threshold counts completed work while preview and warm reads earn no credit', async () => {
  const f = fixture();
  try {
    f.commit('feat: common\n\nzmem(DECISION): common');
    const registration = new MemoryEngine(f.repo, { home: f.home }).registration;
    f.user({
      promotion: {
        min_computations: 3,
        stable_boundaries: [{ repository: registration.repository, ref: 'main' }],
      },
    });
    const a = new MemoryEngine(f.repo, { home: f.home });
    const first = await a.recall();
    const b = new MemoryEngine(f.clone('b'), { home: f.home, associate: registration.repository });
    await b.recall();
    assert.equal(a.coordinator!.count(first.trail.id), 2);
    assert.equal(a.coordinator!.catalog.rows().length, 0);
    await b.recall();
    const head = f.git('rev-parse', 'HEAD');
    await b.check(`feat: check\n\nzmem(CANCEL)[${head}, 1]`, { deep: true });
    assert.equal(a.coordinator!.count(first.trail.id), 2);
    await b.index({ force: true });
    assert.equal(a.coordinator!.count(first.trail.id), 3);
    assert.equal(a.coordinator!.catalog.row(first.trail.id)?.resident, 1);
  } finally {
    f.clean();
  }
});

test('unavailable user catalog preserves independent local indexing and cached reads', async () => {
  const f = fixture();
  try {
    f.commit('feat: first\n\nzmem(DECISION): first');
    const initial = new MemoryEngine(f.repo, { home: f.home });
    const before = await initial.recall();
    renameSync(join(f.home, 'v2'), join(f.home, 'offline-v2'));
    writeFileSync(join(f.home, 'v2'), 'catalog unavailable');
    const offline = new MemoryEngine(f.repo, { home: f.home });
    assert.equal(offline.coordinator, undefined);
    assert.equal(offline.registration.repository, initial.registration.repository);
    assert.deepEqual((await offline.recall()).results, before.results);
    assert.equal(offline.metrics.computed_commits, 0);
    f.commit('feat: second\n\nzmem(LESSON_LEARNT): second');
    assert.equal((await offline.recall()).results.length, 2);
    assert.equal(offline.metrics.computed_commits, 1);
  } finally {
    f.clean();
  }
});

test('detached refs and sliding attention have exact context identities', async () => {
  const f = fixture();
  try {
    const first = f.commit('feat: first\n\nzmem(DECISION): first');
    f.commit(`feat: cancel\n\nzmem(CANCEL)[${first}, 1]`);
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const before = await engine.recall({ commitLimit: 2, includeInvalid: true });
    assert.equal(before.results[0]?.valid, false);
    f.commit('feat: newest\n\nzmem(LESSON_LEARNT): newest');
    const after = await engine.recall({ commitLimit: 2, includeInvalid: true });
    assert.notEqual(after.trail.id, before.trail.id);
    assert.equal(after.results.length, 1);
    assert.ok(after.diagnostics.some((d) => d.code === 'incomplete_history'));
    f.git('checkout', '--detach', first);
    const detached = await engine.recall();
    assert.equal(detached.trail.head, first);
    assert.equal(detached.results[0]?.valid, true);
    await assert.rejects(
      engine.index({ observed: before.trail.head }),
      (e) => e instanceof MemoryError && e.code === 'stale_ref',
    );
  } finally {
    f.clean();
  }
});

test('annotation ordinals, invalid effects, and renamed affected areas are preserved', async () => {
  const f = fixture();
  try {
    const parsed = annotations('zmem(broken\nzmem(DECISION): valid');
    assert.equal(parsed[0]?.index, 1);
    assert.equal(parsed[1]?.index, 2);
    mkdirSync(join(f.repo, 'old'), { recursive: true });
    writeFileSync(join(f.repo, 'old', 'file.txt'), 'move me');
    const a = f.commit('feat: initial\n\nzmem(DECISION): initial');
    f.git('mv', 'old/file.txt', 'new.txt');
    f.git('commit', '-m', 'feat: rename\n\nzmem(DECISION): rename');
    const rename = f.git('rev-parse', 'HEAD');
    assert.deepEqual(new GitRepo(f.repo).commit(rename).paths.sort(), ['new.txt', 'old/file.txt']);
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const renamed = (await engine.recall()).results.find((e) => e.sha === rename)!;
    assert.deepEqual(renamed.affected_areas, ['<root>', 'old']);
    f.commit(
      `feat: invalid\n\nzmem(DECAY)[${a}, 1, 2]\nzmem(CANCEL)[${a}, 99]\nzmem(META)[${a}, ${a}, score=2]`,
    );
    const result = await engine.recall();
    assert.equal(result.results.find((e) => e.sha === a)?.score, 1);
    assert.equal(result.diagnostics.length, 3);
  } finally {
    f.clean();
  }
});
