import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { BackgroundQueue, type BackfillTarget } from '../src/core/background-queue.js';
import { fixture } from './fixtures.js';

const target = (n: number): BackfillTarget => ({
  repository: `repo-${n}`,
  location: `location-${n}`,
  path: `/repo/${n}`,
  head: 'a'.repeat(40),
  surface: 'surface',
  version: '1',
  max_commits: 256,
  max_bytes: 16777216,
});
test('queue limits, duplicate precedence and persistent user controls', () => {
  const f = fixture();
  try {
    const q = new BackgroundQueue(f.home);
    assert.deepEqual(q.inspect().jobs, []);
    assert.equal(existsSync(q.file), false);
    const a = q.admit(target(0));
    assert.equal(a.status, 'accepted');
    const supervisor = q.acquireSupervisor()!;
    const job = q.dispatch(supervisor)!;
    q.admit(target(1));
    q.dispatch(supervisor);
    for (let i = 2; i < 10; i++) assert.equal(q.admit(target(i)).status, 'accepted');
    assert.equal(q.dispatch(supervisor), undefined);
    assert.equal(q.admit(target(10)).status, 'queue_full');
    assert.equal(q.admit(target(0)).status, 'already_pending');
    assert.equal(q.admit(target(10), true).status, 'already_fulfilled');
    q.guarded(job.id, job.token!, () => {});
    q.control(job.id, 'pause');
    assert.throws(() => q.guarded(job.id, job.token!, () => {}), /revoked/);
    assert.equal(new BackgroundQueue(f.home).admit(target(0)).reason, 'job_paused');
    assert.equal(q.control(job.id, 'resume').status, 'queue_full');
    q.setEnabled(false);
    assert.equal(q.admit(target(11)).reason, 'service_stopped');
    q.setEnabled(true);
    assert.equal(q.get(job.id)?.state, 'paused');
    assert.equal(q.control(job.id, 'resume').status, 'accepted');
  } finally {
    f.clean();
  }
});
test('continuations reserve their slot and bounded retries end in failure', () => {
  const f = fixture();
  try {
    const q = new BackgroundQueue(f.home);
    q.admit(target(0));
    const s = q.acquireSupervisor()!;
    assert.equal(q.acquireSupervisor(), undefined);
    let job = q.dispatch(s)!;
    q.settle(job.id, job.token!, { commits: 256, segment: 'one' }, 2);
    job = q.dispatch(s)!;
    assert.equal(job.commits, 256);
    q.settle(job.id, job.token!, { error: 'timeout', retryable: true }, 2);
    job = q.dispatch(s)!;
    q.settle(job.id, job.token!, { error: 'timeout', retryable: true }, 2);
    assert.equal(q.get(job.id)?.state, 'failed');
    assert.equal(q.admit(target(0)).reason, 'job_failed');
    q.releaseSupervisor(s);
  } finally {
    f.clean();
  }
});
test('concurrent processes cannot over-admit waiting work', async () => {
  const f = fixture();
  try {
    const q = new BackgroundQueue(f.home);
    q.setEnabled(true);
    const module = new URL('../src/core/background-queue.js', import.meta.url).href;
    const results = await Promise.all(
      Array.from(
        { length: 12 },
        (_, i) =>
          new Promise<string>((resolve, reject) => {
            const code = `import {BackgroundQueue} from ${JSON.stringify(module)}; console.log(JSON.stringify(new BackgroundQueue(process.argv[1]).admit(JSON.parse(process.argv[2]))));`;
            const child = spawn(
              process.execPath,
              ['--input-type=module', '-e', code, f.home, JSON.stringify(target(i))],
              { windowsHide: true },
            );
            let output = '';
            child.stdout.on('data', (data) => (output += data));
            child.on('error', reject);
            child.on('exit', (exit) =>
              exit === 0
                ? resolve(JSON.parse(output).status)
                : reject(new Error(`child exit ${exit}`)),
            );
          }),
      ),
    );
    assert.equal(results.filter((s) => s === 'accepted').length, 8);
    assert.equal(results.filter((s) => s === 'queue_full').length, 4);
    assert.equal(q.inspect().jobs.length, 8);
  } finally {
    f.clean();
  }
});
