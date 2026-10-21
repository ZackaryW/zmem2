import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixtures.js';
import { BackgroundQueue, processAlive } from '../src/core/background-queue.js';

const call = (repo: string, home: string, ...args: string[]) => {
  const result = spawnSync(
    process.execPath,
    [resolve('dist/src/cli/main.js'), '--repo', repo, '--home', home, ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('background did not finish');
    await delay(50);
  }
}
test('CLI returns foreground memory with automatic admission and later uses full coverage', async () => {
  const f = fixture(),
    q = new BackgroundQueue(f.home);
  try {
    f.user({ segments: { max_commits: 1 } });
    for (let i = 0; i < 4; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): entry ${i}`);
    const first = call(f.repo, f.home, 'recall', '--commit-limit', '1');
    assert.equal(first.count, 1);
    assert.equal(first.memory_coverage.complete, false);
    assert.equal(first.backfill.status, 'accepted');
    const again = call(f.repo, f.home, 'recall', '--commit-limit', '1');
    assert.equal(again.backfill.status, 'already_pending');
    assert.equal(again.backfill.job_id, first.backfill.job_id);
    await waitFor(() => q.get(first.backfill.job_id)?.state === 'completed');
    const full = call(f.repo, f.home, 'recall');
    assert.equal(full.count, 4);
    assert.equal(full.memory_coverage.complete, true);
    assert.equal(full.backfill.status, 'already_fulfilled');
    const bounded = call(f.repo, f.home, 'recall', '--commit-limit', '1');
    assert.equal(bounded.count, 1);
    assert.equal(bounded.memory_coverage.complete, false);
    assert.equal(bounded.backfill.status, 'already_fulfilled');
  } finally {
    q.setEnabled(false);
    await waitFor(
      () => !q.inspect().service.running && q.inspect().jobs.every((j) => !processAlive(j.pid)),
    );
    f.clean();
  }
});
test('observational commands, opt-out and previews do not create or enqueue background work', () => {
  const f = fixture(),
    q = new BackgroundQueue(f.home);
  try {
    const absentHome = join(f.root, 'untouched');
    for (const args of [['jobs'], ['service', 'status'], ['backfill', 'status']]) {
      assert.deepEqual(call(f.repo, absentHome, ...args).jobs, []);
    }
    assert.equal(existsSync(absentHome), false);
    assert.equal(existsSync(join(f.repo, '.zmem')), false);
    f.commit('feat: one\n\nzmem(DECISION): one');
    f.commit('chore: next');
    const disabled = call(f.repo, f.home, 'init', '--commit-limit', '1', '--no-background');
    assert.equal(disabled.backfill.reason, 'command_disabled');
    assert.equal(existsSync(q.file), false);
    const message = join(f.root, 'message.txt');
    writeFileSync(message, 'chore: proposal');
    const checked = call(f.repo, f.home, 'check', '--file', message);
    assert.equal(checked.backfill.reason, 'proposal_preview');
    assert.equal(existsSync(q.file), false);
    f.user({ background: { enabled: false } });
    assert.equal(
      call(f.repo, f.home, 'recall', '--commit-limit', '1').backfill.reason,
      'user_disabled',
    );
    assert.equal(existsSync(q.file), false);
  } finally {
    f.clean();
  }
});
test('failed admission retains successful foreground results', () => {
  const f = fixture();
  try {
    f.commit('feat: one\n\nzmem(DECISION): one');
    f.commit('feat: two\n\nzmem(DECISION): two');
    writeFileSync(join(f.home, 'background'), 'not a directory');
    const result = call(f.repo, f.home, 'recall', '--commit-limit', '1');
    assert.equal(result.count, 1);
    assert.equal(result.backfill.status, 'failed');
    assert.match(result.backfill.reason, /ENOTDIR|EEXIST|directory/i);
  } finally {
    f.clean();
  }
});
