import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { BackgroundQueue, processAlive } from '../src/core/background-queue.js';
import { backfillTarget } from '../src/core/background-compute.js';
import { launchSupervisor } from '../src/core/background-service.js';
import { MemoryEngine } from '../src/core/engine.js';
import { fixture, extension } from './fixtures.js';
import { waitForBackground, waitForJob, stopBackground } from './background-test-helpers.js';
test('detached supervisor survives caller exit and completes sequential segments', async () => {
  const f = fixture(),
    q = new BackgroundQueue(f.home);
  try {
    f.user({ segments: { max_commits: 1 } });
    for (let i = 0; i < 3; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    const e = new MemoryEngine(f.repo, { home: f.home });
    const admission = q.admit(backfillTarget(e));
    const module = new URL('../src/core/background-service.js', import.meta.url).href;
    await new Promise<void>((resolve, reject) => {
      const caller = spawn(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {launchSupervisor} from ${JSON.stringify(module)}; await launchSupervisor(process.argv[1]);`,
          f.home,
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
      caller.once('error', reject);
      caller.once('exit', (n) => (n === 0 ? resolve() : reject(new Error(`caller ${n}`))));
    });
    await launchSupervisor(f.home); // Concurrent startup must not add a second dispatcher.
    await waitForJob(q, admission.job_id!);
    assert.equal(q.get(admission.job_id!)?.commits, 3);
    const warm = new MemoryEngine(f.repo, { home: f.home });
    assert.equal((await warm.recall({ commitLimit: -1, nodeLimit: -1 })).count, 3);
    assert.equal(warm.metrics.computed_commits, 0);
    await waitForBackground(q, (snapshot) => !snapshot.service.running, 'supervisor idle shutdown');
  } finally {
    await stopBackground(q);
    f.clean();
  }
});
test('worker deadlines bound stuck extension work and exhaust retries', async () => {
  const f = fixture(),
    q = new BackgroundQueue(f.home);
  try {
    f.user({ background: { timeout_ms: 1500, grace_ms: 100, max_attempts: 2 } });
    extension(
      f.repo,
      {
        id: 'stuck',
        version: '1',
        deterministic: true,
        entry: 'extension.mjs',
        types: { STUCK: { kind: 'entry', handler: 'stuck' } },
      },
      `export function register(r){r.extend('STUCK',{expand(){while(true){}}});}`,
    );
    f.commit('feat: hang\n\nzmem(STUCK): work');
    const e = new MemoryEngine(f.repo, { home: f.home, trust: true });
    const a = q.admit(backfillTarget(e));
    await launchSupervisor(f.home);
    await waitForJob(q, a.job_id!, 'failed');
    assert.equal(q.get(a.job_id!)?.attempts, 2);
    assert.match(q.get(a.job_id!)!.error!, /timeout|interrupt|deadline/);
    assert.equal(e.local.rows().length, 0);
  } finally {
    await stopBackground(q);
    f.clean();
  }
});

test('a replacement supervisor recovers interrupted ownership without duplicate publication', async () => {
  const f = fixture(),
    q = new BackgroundQueue(f.home);
  try {
    f.user({ segments: { max_commits: 1 }, background: { grace_ms: 100 } });
    for (let i = 0; i < 4; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    const e = new MemoryEngine(f.repo, { home: f.home });
    const a = q.admit(backfillTarget(e));
    await launchSupervisor(f.home);
    await waitForBackground(
      q,
      (snapshot) => !!snapshot.jobs.find((job) => job.id === a.job_id)?.pid,
      'worker startup',
    );
    const supervisorPid = q.inspect().service.pid!;
    process.kill(supervisorPid);
    await waitForBackground(q, () => !processAlive(supervisorPid), 'terminated supervisor');
    await launchSupervisor(f.home);
    await waitForJob(q, a.job_id!);
    assert.equal((await e.recall({ commitLimit: -1, nodeLimit: -1 })).count, 4);
  } finally {
    await stopBackground(q);
    f.clean();
  }
});
test('service stop revokes active work and start does not silently resume paused targets', async () => {
  const f = fixture(),
    q = new BackgroundQueue(f.home);
  try {
    f.user({ background: { timeout_ms: 5000, grace_ms: 100 } });
    extension(
      f.repo,
      {
        id: 'stuck',
        version: '1',
        deterministic: true,
        entry: 'extension.mjs',
        types: { STUCK: { kind: 'entry', handler: 'stuck' } },
      },
      `export function register(r){r.extend('STUCK',{expand(){while(true){}}});}`,
    );
    f.commit('feat: hang\n\nzmem(STUCK): work');
    const e = new MemoryEngine(f.repo, { home: f.home, trust: true });
    const a = q.admit(backfillTarget(e));
    for (const name of ['clone-b', 'clone-c']) {
      const clone = new MemoryEngine(f.clone(name), { home: f.home, trust: true });
      q.admit(backfillTarget(clone));
    }
    await launchSupervisor(f.home);
    await waitForBackground(
      q,
      (snapshot) => snapshot.jobs.filter((job) => job.state === 'running' && job.pid).length === 2,
      'two running workers',
    );
    assert.equal(q.inspect().jobs.filter((j) => j.state === 'queued').length, 1);
    await stopBackground(q);
    assert.equal(q.get(a.job_id!)?.state, 'paused');
    q.setEnabled(true);
    await launchSupervisor(f.home);
    assert.equal(q.admit(backfillTarget(e)).reason, 'job_paused');
  } finally {
    await stopBackground(q);
    f.clean();
  }
});
