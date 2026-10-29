import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { type BackgroundJob, processAlive } from '../src/core/background-queue.js';
import { waitForBackground, waitForJob, stopBackground } from './background-test-helpers.js';

const job = (overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: 'job',
  target: {
    repository: 'repo',
    location: 'location',
    path: '/test',
    head: 'a'.repeat(40),
    surface: 'surface',
    version: '1',
    max_commits: 1,
    max_bytes: 1024,
  },
  state: 'running',
  token: 'token',
  supervisor: 'supervisor',
  pid: null,
  created: 0,
  updated: 0,
  attempts: 0,
  commits: 0,
  segment: null,
  error: null,
  ...overrides,
});
const snapshot = (item: BackgroundJob) => ({
  service: { enabled: true, running: false, pid: null, heartbeat: 0 },
  jobs: [item],
});

test('background waits report terminal job failures immediately', async () => {
  let observations = 0;
  const queue = {
    inspect: () => {
      observations++;
      return snapshot(job({ state: 'failed', error: 'worker failed to start' }));
    },
    setEnabled: () => {},
  };
  await assert.rejects(waitForJob(queue, 'job'), /worker failed to start/);
  assert.equal(observations, 1);
  await waitForJob(queue, 'job', 'failed');
});

test('a bounded background timeout includes the last queue snapshot', async () => {
  const queue = { inspect: () => snapshot(job({ commits: 2 })), setEnabled: () => {} };
  await assert.rejects(
    waitForBackground(queue, () => false, 'test progress', 0),
    (error) =>
      error instanceof Error &&
      error.message.includes('test progress') &&
      error.message.includes('"commits":2') &&
      error.message.includes('"state":"running"'),
  );
});

test('shutdown waits for an observed worker after queue settlement clears its PID', async (t) => {
  const child = spawn(
    process.execPath,
    ['-e', 'process.send("ready"); process.on("message", () => process.exit(0));'],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true },
  );
  const exited = once(child, 'exit');
  t.after(async () => {
    if (processAlive(child.pid ?? null)) child.kill();
    await exited;
  });
  await once(child, 'message');
  let observations = 0,
    stopped = false;
  const queue = {
    inspect: () =>
      snapshot(
        ++observations === 1 ? job({ pid: child.pid! }) : job({ state: 'completed', pid: null }),
      ),
    setEnabled: (enabled: boolean) => {
      stopped = !enabled;
    },
  };
  await waitForJob(queue, 'job');
  assert.equal(processAlive(child.pid!), true, 'fixture must expose the settlement/exit gap');
  let drained = false;
  const stopping = stopBackground(queue).then(() => {
    drained = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(drained, false, 'teardown cannot finish while the worker still holds its files');
  child.send('exit');
  await stopping;
  assert.equal(stopped, true);
  assert.equal(processAlive(child.pid!), false, 'cleanup must wait for the actual process exit');
});
