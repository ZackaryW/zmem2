import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { BackgroundQueue, processAlive } from '../src/core/background-queue.js';
import { backfillTarget } from '../src/core/background-compute.js';
import { launchSupervisor } from '../src/core/background-service.js';
import { MemoryEngine } from '../src/core/engine.js';
import { fixture, extension } from './fixtures.js';
import { waitForBackground, waitForJob, stopBackground } from './background-test-helpers.js';

test('supervisor survives a control database lock and dispatches after it clears', async () => {
  const f = fixture(),
    q = new BackgroundQueue(f.home);
  let lock: DatabaseSync | undefined;
  try {
    f.commit('feat: retained\n\nzmem(DECISION): retained');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    q.setEnabled(true);
    await launchSupervisor(f.home);
    await waitForBackground(q, (snapshot) => snapshot.service.running, 'supervisor startup');
    const pid = q.inspect().service.pid!;
    lock = new DatabaseSync(q.file, { timeout: 5000 });
    lock.exec('BEGIN IMMEDIATE');
    await delay(1000); // Longer than the 250-ms SQLite busy timeout.
    assert.equal(processAlive(pid), true, 'contention must not kill the supervisor');
    lock.exec('COMMIT');
    lock.close();
    lock = undefined;
    const admission = q.admit(backfillTarget(engine));
    await waitForJob(q, admission.job_id!);
    assert.equal(q.get(admission.job_id!)?.commits, 1);
  } finally {
    lock?.close();
    await stopBackground(q);
    f.clean();
  }
});

for (const duringComputation of [false, true]) {
  test(`worker survives control database contention during ${duringComputation ? 'computation and settlement' : 'ownership monitoring'}`, async () => {
    const f = fixture(),
      q = new BackgroundQueue(f.home);
    let lock: DatabaseSync | undefined,
      child: ChildProcess | undefined,
      exited: Promise<unknown> | undefined,
      supervisor: string | undefined;
    try {
      f.user({ background: { max_attempts: duringComputation ? 2 : 1 } });
      extension(
        f.repo,
        {
          id: 'delayed',
          version: '1',
          deterministic: true,
          entry: 'extension.mjs',
          types: { DELAYED: { kind: 'entry', handler: 'delayed' } },
        },
        `export function register(r){r.extend('DELAYED',{expand(c){
        console.log('extension-ready');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${duringComputation ? 500 : 3000});
        c.addEntry({type:'DELAYED',content:c.annotation.content});
      }});}`,
      );
      f.commit('feat: delayed work\n\nzmem(DELAYED): retained');
      const engine = new MemoryEngine(f.repo, { home: f.home, trust: true });
      const admission = q.admit(backfillTarget(engine));
      // This test owns dispatch so it can observe wrapper output before locking.
      supervisor = q.acquireSupervisor()!;
      const startWorker = () => {
        const job = q.dispatch(supervisor!)!;
        child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL('../src/cli/background-worker.js', import.meta.url)),
            f.home,
            job.id,
            job.token!,
          ],
          { windowsHide: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        exited = once(child, 'exit');
        q.attach(job.id, job.token!, child.pid!);
        let output = '';
        child.stdout!.on('data', (data) => {
          output += data;
        });
        child.stderr!.resume();
        return waitForBackground(
          q,
          () => {
            assert.equal(child!.exitCode, null, `worker exited before extension: ${output}`);
            return output.includes('extension-ready');
          },
          'extension startup',
        );
      };
      await startWorker();
      lock = new DatabaseSync(q.file, { timeout: 5000 });
      lock.exec('BEGIN IMMEDIATE');
      await delay(1500);
      lock.exec('COMMIT');
      lock.close();
      lock = undefined;
      await exited;
      assert.equal(child!.exitCode, 0);
      const job = q.get(admission.job_id!)!;
      if (duringComputation) {
        assert.equal(job.state, 'running', 'busy computation must remain retryable');
        assert.equal(job.token, null, 'settlement must survive contention');
        assert.equal(job.attempts, 1);
        await startWorker();
        await exited;
      }
      assert.equal(q.get(admission.job_id!)?.state, 'completed');
      assert.equal(q.get(admission.job_id!)?.attempts, 0);
      assert.equal((await engine.recall({ commitLimit: -1, nodeLimit: -1 })).count, 1);
    } finally {
      lock?.close();
      q.setEnabled(false);
      if (child?.exitCode === null) child.kill();
      await exited;
      if (supervisor) q.releaseSupervisor(supervisor);
      f.clean();
    }
  });
}
