import { join, resolve, relative, isAbsolute } from 'node:path';
import { existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { MemoryEngine } from './engine.js';
import { MemoryError, VERSION, identity, json } from './contracts.js';
import { BackgroundQueue, type BackfillTarget } from './background-queue.js';
import { historyPlan } from './history-plan.js';

export function backfillTarget(engine: MemoryEngine, ref?: string): BackfillTarget {
  const request = engine.computation({ ref, commitLimit: -1, nodeLimit: -1 });
  if (!request.selectedSurface.shareable)
    throw new MemoryError(
      'ineligible',
      'session-bound extension surface cannot resume in another worker',
    );
  return {
    repository: engine.registration.repository,
    location: engine.registration.location,
    path: engine.repo.root,
    head: request.head,
    surface: request.selectedSurface.id,
    version: VERSION,
    ...engine.settings.user.segments,
  };
}
function directoryBytes(path: string): number {
  if (!existsSync(path)) return 0;
  return readdirSync(path, { withFileTypes: true }).reduce((total, file) => {
    const child = join(path, file.name);
    return (
      total +
      (file.isDirectory() ? directoryBytes(child) : file.isFile() ? statSync(child).size : 0)
    );
  }, 0);
}
/** One replaceable worker invocation, with all computation private until complete. */
export async function computeBackfillSegment(
  home: string,
  id: string,
  token: string,
  cancelled: () => boolean = () => false,
) {
  const queue = new BackgroundQueue(home),
    job = queue.get(id);
  if (!job) throw new MemoryError('invalid_input', 'unknown backfill job');
  const guarded = <T>(work: () => T) => {
    if (cancelled()) throw new MemoryError('interrupted', 'worker deadline or stop requested');
    return queue.guarded(id, token, work);
  };
  guarded(() => {});
  const destination = new MemoryEngine(job.target.path, { home });
  if (
    !destination.settings.user.background.enabled ||
    destination.settings.repo.background?.enabled === false
  )
    throw new MemoryError('cancelled', 'background disabled by configuration');
  if (identity(backfillTarget(destination, job.target.head)) !== id)
    throw new MemoryError('incompatible', 'backfill inputs changed');
  const directory = join(destination.local.directory, 'backfill', id);
  const stage = new MemoryEngine(job.target.path, { home, localDirectory: directory });
  // The queue token, not a reusable OS PID, owns this private computation.
  // A killed thread/process can leave a building claim whose PID is live again.
  // Reclaim only this job's staging claims while holding current ownership.
  guarded(() => stage.local.db((db) => db.prepare('DELETE FROM claims').run()));
  const request = stage.computation({ ref: job.target.head, commitLimit: -1, nodeLimit: -1 });
  const budget = destination.settings.user.background.max_staging_bytes;
  const checkBudget = (extra = 0) => {
    if (directoryBytes(directory) + extra > budget)
      throw new MemoryError('storage_limit', 'background staging budget exceeded', {
        limit: budget,
      });
  };
  checkBudget();
  if (!stage.local.rows().length) {
    const candidates = destination.local.candidates(
      job.target.repository,
      job.target.surface,
      Number.MAX_SAFE_INTEGER,
      request.policy,
    );
    for (const candidate of candidates) {
      try {
        stage.copyComputed(
          destination,
          candidate.id,
          (work) => {
            guarded(() => {});
            checkBudget();
            return work();
          },
          (pack) => checkBudget(Buffer.byteLength(json(pack))),
        );
        break;
      } catch (error) {
        if (!(error instanceof MemoryError) || !['evicted', 'corrupt'].includes(error.code))
          throw error;
      }
    }
  }
  const pack = await stage.sync({
    ref: job.target.head,
    observed: job.target.head,
    commitLimit: -1,
    nodeLimit: -1,
    preview: true,
    selection: historyPlan(
      stage.repo,
      directory,
      id,
      job.target.head,
      budget,
      guarded,
      checkBudget,
    ),
    guard: () => {
      guarded(() => {});
      checkBudget();
    },
    beforeSegment: (pack) => checkBudget(Buffer.byteLength(json(pack))),
    onSegment: (pack) => {
      stage.local.db((db) =>
        db
          .prepare('INSERT OR IGNORE INTO meta VALUES(?,?)')
          .run(`background-computed:${pack.id}`, String(Date.now())),
      );
      return false;
    },
  });
  checkBudget();
  const complete = stage.local.view(request.key) === pack.id;
  if (complete) {
    if (identity(backfillTarget(destination, job.target.head)) !== id)
      throw new MemoryError('incompatible', 'surface changed before publication');
    await destination.publishBackfill(stage, pack.id, job.target.head, `backfill:${id}`, guarded);
    const stagingRoot = resolve(destination.local.directory, 'backfill');
    const within = relative(stagingRoot, resolve(directory));
    if (!within || within.startsWith('..') || isAbsolute(within))
      throw new MemoryError('invalid_input', 'unsafe staging cleanup path');
    guarded(() => rmSync(directory, { recursive: true, force: true }));
  }
  return { complete, commits: pack.attention.commits, segment: pack.id };
}
