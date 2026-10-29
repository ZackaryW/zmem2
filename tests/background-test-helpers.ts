import { setTimeout as delay } from 'node:timers/promises';
import { BackgroundQueue, processAlive } from '../src/core/background-queue.js';

type Queue = Pick<BackgroundQueue, 'inspect' | 'setEnabled'>;
type Snapshot = ReturnType<Queue['inspect']>;
const processes = new WeakMap<Queue, Set<number>>();

function observe(queue: Queue) {
  const snapshot = queue.inspect();
  const pids = processes.get(queue) ?? new Set<number>();
  const supervisor = 'pid' in snapshot.service ? snapshot.service.pid : undefined;
  for (const pid of [supervisor, ...snapshot.jobs.map((job) => job.pid)]) {
    if (pid) pids.add(pid);
  }
  processes.set(queue, pids);
  return snapshot;
}

// Multi-segment work includes several Node/Git startups on a shared CI runner.
// This test budget is independent of the application's per-worker deadline.
export async function waitForBackground(
  queue: Queue,
  predicate: (snapshot: Snapshot) => boolean,
  description: string,
  timeout = 60000,
) {
  const end = performance.now() + timeout;
  while (true) {
    const snapshot = observe(queue);
    if (predicate(snapshot)) return;
    if (performance.now() >= end) {
      throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(snapshot)}`);
    }
    await delay(50);
  }
}

export async function waitForJob(
  queue: Queue,
  id: string,
  expected: 'completed' | 'failed' = 'completed',
) {
  await waitForBackground(
    queue,
    (snapshot) => {
      const job = snapshot.jobs.find((item) => item.id === id);
      if (!job) throw new Error(`Missing background job ${id}: ${JSON.stringify(snapshot)}`);
      if (job.state === expected) return true;
      if (['failed', 'cancelled', 'paused'].includes(job.state)) {
        throw new Error(
          `Background job ${id} ended before ${expected}: ${JSON.stringify(snapshot)}`,
        );
      }
      return false;
    },
    `background job ${id} to become ${expected}`,
  );
}

export async function stopBackground(queue: Queue) {
  observe(queue);
  queue.setEnabled(false);
  // Queue settlement clears PIDs before the wrapper finishes exiting. Remember
  // observed processes so Windows cleanup cannot race their open file handles.
  await waitForBackground(
    queue,
    (snapshot) =>
      !snapshot.service.running && [...processes.get(queue)!].every((pid) => !processAlive(pid)),
    'background processes to exit',
  );
}
