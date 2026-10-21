import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { BackgroundQueue } from '../core/background-queue.js';
import { computeBackfillSegment } from '../core/background-compute.js';
import { configuration } from '../core/config.js';
import { MemoryError } from '../core/contracts.js';

interface Input {
  home: string;
  id: string;
  token: string;
  stop: SharedArrayBuffer;
}
if (!isMainThread) {
  const input = workerData as Input,
    stop = new Int32Array(input.stop);
  try {
    const result = await computeBackfillSegment(
      input.home,
      input.id,
      input.token,
      () => Atomics.load(stop, 0) !== 0,
    );
    parentPort!.postMessage({ result });
  } catch (error) {
    parentPort!.postMessage({
      error: String(error),
      retryable: error instanceof MemoryError && ['interrupted', 'cancelled'].includes(error.code),
    });
  }
} else {
  const [home, id, token] = process.argv.slice(2);
  if (!home || !id || !token) process.exitCode = 2;
  else {
    const queue = new BackgroundQueue(home),
      job = queue.get(id);
    if (job?.token === token && job.state === 'running') {
      const config = configuration(job.target.path, home).user.background;
      const stop = new SharedArrayBuffer(4),
        flag = new Int32Array(stop);
      const thread = new Worker(new URL(import.meta.url), {
        workerData: { home, id, token, stop } satisfies Input,
      });
      let finished = false,
        requested = 0;
      const finish = (outcome: {
        complete?: boolean;
        commits?: number;
        segment?: string;
        error?: string;
        retryable?: boolean;
      }) => {
        if (finished) return;
        finished = true;
        clearInterval(monitor);
        clearTimeout(deadline);
        queue.settle(id, token, outcome, config.max_attempts);
      };
      const stopWork = () => {
        if (!requested) requested = Date.now();
        Atomics.store(flag, 0, 1);
      };
      const deadline = setTimeout(stopWork, config.timeout_ms);
      const monitor = setInterval(() => {
        try {
          queue.guarded(id, token, () => {});
        } catch {
          stopWork();
        }
        if (requested && Date.now() - requested >= config.grace_ms) {
          finish({ error: 'worker hard timeout or revoked ownership', retryable: true });
          // The watchdog is outside the computation thread: stuck JavaScript cannot block it.
          process.exit(124);
        }
      }, 50);
      thread.once(
        'message',
        (message: {
          result?: { complete: boolean; commits: number; segment: string };
          error?: string;
          retryable?: boolean;
        }) => {
          finish(
            message.result ?? {
              error: message.error ?? 'worker failed',
              retryable: message.retryable,
            },
          );
          void thread.terminate();
        },
      );
      thread.once('error', (error) => finish({ error: String(error) }));
      thread.once('exit', () => finish({ error: 'worker interrupted', retryable: true }));
      process.on('SIGTERM', stopWork);
      process.on('SIGINT', stopWork);
    }
  }
}
