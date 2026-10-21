import { MemoryEngine, type IndexOptions } from './engine.js';
import { BackgroundQueue, type Admission } from './background-queue.js';
import { backfillTarget } from './background-compute.js';
import { launchSupervisor } from './background-service.js';
import { MemoryError, type Attention } from './contracts.js';

/** Attach scheduling to a completed real foreground operation, never a preview. */
export async function withBackfill<T extends { attention?: Attention | null }>(
  engine: MemoryEngine,
  options: IndexOptions,
  result: T,
  disabled = false,
) {
  const attention = result.attention;
  let target: string | null = null,
    admission: Admission;
  const coverage: { target_commit: string | null; complete: boolean; commits: number } = {
    target_commit: target,
    complete: !!attention && !attention.truncated,
    commits: attention?.commits ?? 0,
  };
  try {
    target = !options.ref && engine.repo.unborn() ? null : engine.repo.resolve(options.ref);
    coverage.target_commit = target;
    const reason = disabled
      ? 'command_disabled'
      : !engine.settings.user.background.enabled
        ? 'user_disabled'
        : engine.settings.repo.background?.enabled === false
          ? 'repository_disabled'
          : !target
            ? 'unborn_repository'
            : undefined;
    if (reason) admission = { status: 'ineligible', reason };
    else if (coverage.complete) admission = { status: 'already_fulfilled' };
    else {
      const request = backfillTarget(engine, target!);
      const queue = new BackgroundQueue(engine.settings.home);
      const full = engine.computation({ ref: target!, commitLimit: -1, nodeLimit: -1 });
      const materialized =
        engine.local.view(full.key) ?? engine.coordinator?.catalog.view(full.key);
      admission = queue.admit(request, !!materialized);
      if (admission.status === 'accepted' || admission.status === 'already_pending') {
        const error = await launchSupervisor(engine.settings.home);
        if (error)
          admission = {
            ...admission,
            status: 'failed',
            reason: `dispatcher unavailable; durable job retained: ${error}`,
          };
      }
    }
  } catch (error) {
    admission = {
      status: error instanceof MemoryError && error.code === 'ineligible' ? 'ineligible' : 'failed',
      reason: String(error),
    };
  }
  return { ...result, memory_coverage: coverage, backfill: admission };
}
