import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { GitRepo } from '../src/core/git.js';
import { historyPlan } from '../src/core/history-plan.js';
import { identity } from '../src/core/contracts.js';
import { MemoryEngine } from '../src/core/engine.js';
import { BackgroundQueue } from '../src/core/background-queue.js';
import { backfillTarget, computeBackfillSegment } from '../src/core/background-compute.js';
import { fixture } from './fixtures.js';

const guard = <T>(work: () => T) => work();
test('private history plans reuse selection and rebuild corrupt, wrong-target or disconnected data', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    const directory = join(f.home, 'plan');
    mkdirSync(directory);
    const repo = new GitRepo(f.repo),
      head = repo.resolve();
    let selections = 0;
    const select = repo.select.bind(repo);
    repo.select = (...args) => {
      selections++;
      return select(...args);
    };
    const load = (target = 'target') =>
      historyPlan(repo, directory, target, head, 1048576, guard, () => {});
    const original = load();
    assert.deepEqual(load(), original);
    assert.equal(selections, 1);
    const filename = join(directory, 'selection.json');
    writeFileSync(filename, '{partial');
    assert.deepEqual(load(), original);
    assert.equal(selections, 2);
    assert.deepEqual(load('another-target'), original);
    assert.equal(selections, 3);
    const data = JSON.parse(readFileSync(filename, 'utf8'));
    data.selection.commits[1].parents = ['a'.repeat(40)];
    const { checksum: _, ...body } = data;
    data.checksum = identity(body);
    writeFileSync(filename, JSON.stringify(data));
    assert.deepEqual(load('another-target'), original);
    assert.equal(selections, 4);
    assert.throws(() => historyPlan(repo, directory, 'target', head, 1, guard, () => {}), /budget/);
    const other = join(f.home, 'other');
    mkdirSync(other);
    assert.throws(
      () =>
        historyPlan(repo, other, 'target', head, 1048576, guard, () => {
          throw Error('disk budget');
        }),
      /disk budget/,
    );
    assert.equal(existsSync(join(other, 'selection.json')), false);
  } finally {
    f.clean();
  }
});

test('replacement workers select full history once and reclaim the plan after publication', async () => {
  const f = fixture(),
    previous = GitRepo.prototype.select;
  let selections = 0;
  try {
    f.user({ segments: { max_commits: 2 } });
    for (let i = 0; i < 5; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    const engine = new MemoryEngine(f.repo, { home: f.home }),
      q = new BackgroundQueue(f.home);
    const target = backfillTarget(engine),
      admission = q.admit(target),
      supervisor = q.acquireSupervisor()!;
    const directory = join(engine.local.directory, 'backfill', admission.job_id!);
    GitRepo.prototype.select = function (...args) {
      selections++;
      return previous.apply(this, args);
    };
    for (const expected of [2, 4, 5]) {
      const job = q.dispatch(supervisor)!;
      const result = await computeBackfillSegment(f.home, job.id, job.token!);
      assert.equal(result.commits, expected);
      assert.equal(result.complete, expected === 5);
      q.settle(job.id, job.token!, result, 3);
      assert.equal(selections, 1);
      if (expected < 5) assert.equal(existsSync(join(directory, 'selection.json')), true);
    }
    assert.equal(existsSync(directory), false);
    assert.equal((await engine.recall()).count, 5);
    assert.equal(selections, 1);
  } finally {
    GitRepo.prototype.select = previous;
    f.clean();
  }
});

test('current queue owner reclaims a private building claim even when its recorded PID is live', async () => {
  const f = fixture();
  try {
    f.commit('feat: entry\n\nzmem(DECISION): keep');
    const engine = new MemoryEngine(f.repo, { home: f.home }),
      q = new BackgroundQueue(f.home);
    q.admit(backfillTarget(engine));
    const supervisor = q.acquireSupervisor()!,
      job = q.dispatch(supervisor)!;
    const stage = new MemoryEngine(f.repo, {
      home: f.home,
      localDirectory: join(engine.local.directory, 'backfill', job.id),
    });
    const request = stage.computation({ ref: job.target.head, commitLimit: -1, nodeLimit: -1 });
    const key = `index:${request.key}:${identity(stage.settings.user.segments)}`;
    assert.equal(stage.local.claim(key), 'owned');
    assert.equal(engine.local.claim('public-sentinel'), 'owned');
    const result = await computeBackfillSegment(f.home, job.id, job.token!);
    assert.equal(result.complete, true);
    assert.equal(engine.local.claim('public-sentinel'), 'busy');
    engine.local.finishClaim('public-sentinel');
  } finally {
    f.clean();
  }
});
