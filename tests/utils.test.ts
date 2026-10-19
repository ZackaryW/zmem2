import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache } from 'lru-cache';
import { fingerprint } from '../src/utils/fingerprint.js';
import { createSingleFlight, CapacityError } from '../src/utils/singleflight.js';
import { freezeData } from '../src/utils/freeze-data.js';

test('fingerprints preserve framing, order and empty components', () => {
  const f = (...parts: string[]) => fingerprint(parts.map((v) => Buffer.from(v)));
  assert.equal(f('a', 'bc'), f('a', 'bc'));
  assert.equal(f('a', 'bc'), 'f93982a2a35e41af3fda9fdbec53980fac1fcac01a026a78d1921dfefcc07c1a');
  assert.notEqual(f('a', 'bc'), f('ab', 'c'));
  assert.notEqual(f('a', 'b'), f('b', 'a'));
  assert.notEqual(f(), f(''));
});
test('pending work coalesces, bounds capacity and cleans rejection', async () => {
  const group = createSingleFlight<string, number>({ maxPending: 1 });
  let finish!: (v: number) => void;
  const first = group.run(
    'a',
    () =>
      new Promise<number>((r) => {
        finish = r;
      }),
  );
  assert.equal(
    first,
    group.run('a', () => 2),
  );
  await assert.rejects(
    group.run('b', () => 3),
    CapacityError,
  );
  finish(1);
  assert.equal(await first, 1);
  await assert.rejects(
    group.run('a', () => {
      throw Error('fail');
    }),
  );
  assert.equal(group.size, 0);
  assert.equal(await group.run('a', () => 4), 4);
});
test('standard LRU bounds bytes and disposes evicted values', () => {
  const disposed: string[] = [];
  const cache = new LRUCache<string, string>({
    max: 2,
    maxSize: 4,
    sizeCalculation: (v) => v.length,
    dispose: (_, k) => disposed.push(k),
  });
  cache.set('a', 'aa');
  cache.set('b', 'bb');
  cache.get('a');
  cache.set('c', 'cc');
  assert.equal(cache.has('b'), false);
  assert.deepEqual(disposed, ['b']);
});

test('plain-data freezing protects shared nested values and cycles', () => {
  const data: { items: { value: number }[]; self?: unknown } = { items: [{ value: 1 }] };
  data.self = data;
  const frozen = freezeData(data);
  assert.equal(frozen, data);
  assert.equal(frozen.self, frozen);
  assert.throws(() => {
    frozen.items[0]!.value = 2;
  }, TypeError);
  assert.throws(() => {
    frozen.items.push({ value: 3 });
  }, TypeError);
  assert.throws(() => freezeData(new Map()), TypeError);
});
