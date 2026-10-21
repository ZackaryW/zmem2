import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BackgroundQueue } from './background-queue.js';
import { UserConfigSchema, readYaml } from './config.js';
import { join } from 'node:path';

export async function launchSupervisor(home: string): Promise<string | undefined> {
  const q = new BackgroundQueue(home),
    status = q.inspect().service;
  if (!status.enabled) return 'service_stopped';
  if (status.running) return undefined;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../cli/background-supervisor.js', import.meta.url)), home],
      {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    child.once('error', (error) => resolve(String(error)));
    child.once('spawn', () => {
      child.unref();
      resolve(undefined);
    });
  });
}

export async function supervise(home: string) {
  const queue = new BackgroundQueue(home),
    token = queue.acquireSupervisor();
  if (!token) return;
  const children = new Map<string, ChildProcess>();
  let idle = 0;
  try {
    while (true) {
      const enabled = queue.heartbeat(token);
      if (enabled) {
        for (let slot = children.size; slot < 2; slot++) {
          const job = queue.dispatch(token, [...children.keys()]);
          if (!job) break;
          const config = UserConfigSchema.parse(readYaml(join(home, 'config.yaml'))).background;
          if (job.attempts >= config.max_attempts) {
            queue.settle(
              job.id,
              job.token!,
              { error: 'interruption retry limit reached' },
              config.max_attempts,
            );
            continue;
          }
          const child = spawn(
            process.execPath,
            [
              fileURLToPath(new URL('../cli/background-worker.js', import.meta.url)),
              home,
              job.id,
              job.token!,
            ],
            {
              windowsHide: true,
              detached: true,
              stdio: 'ignore',
            },
          );
          children.set(job.id, child);
          if (child.pid) queue.attach(job.id, job.token!, child.pid);
          let exited = false;
          const finish = (error?: string) => {
            if (exited) return;
            exited = true;
            children.delete(job.id);
            const current = queue.get(job.id);
            if (current?.token === job.token)
              queue.settle(
                job.id,
                job.token!,
                { error: error ?? 'worker exited without a result', retryable: true },
                config.max_attempts,
              );
            if (child.pid) queue.clearWorker(job.id, child.pid);
          };
          child.once('error', (error) => finish(String(error)));
          child.once('exit', () => finish());
        }
      }
      // Worker wrappers observe revocation themselves, including when this process dies.
      const active = queue
        .inspect()
        .jobs.some((j) => j.state === 'running' || j.state === 'queued');
      if (!children.size && (!enabled || !active)) {
        if (++idle >= 10 && queue.releaseIfIdle(token)) break;
      } else idle = 0;
      await delay(100);
    }
  } finally {
    queue.releaseSupervisor(token);
  }
}
