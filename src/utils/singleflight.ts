export class CapacityError extends Error {}

export function createSingleFlight<K, V>({ maxPending }: { maxPending: number }) {
  if (!Number.isSafeInteger(maxPending) || maxPending <= 0)
    throw new RangeError('maxPending must be positive');
  const pending = new Map<K, Promise<V>>();
  return {
    get size() {
      return pending.size;
    },
    run(key: K, work: () => V | Promise<V>): Promise<V> {
      const existing = pending.get(key);
      if (existing) return existing;
      if (pending.size >= maxPending)
        return Promise.reject(new CapacityError('pending work capacity exceeded'));
      const result = Promise.resolve()
        .then(work)
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, result);
      return result;
    },
  };
}
