import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { StateMap } from '../src/core/state-map.js';
import { identity, json, MemoryError, OperationSchema, VERSION } from '../src/core/contracts.js';
import { UserConfigSchema, RepoConfigSchema } from '../src/core/config.js';
import { Catalog, type Pack } from '../src/core/catalog.js';
import { fixture } from './fixtures.js';

test('catalog publication seals integrity and releases handles and leases independently of eviction', () => {
  const f = fixture();
  try {
    const catalog = new Catalog(join(f.home, 'catalog'));
    const state = new StateMap(null, () => {
      throw Error('absent page');
    });
    state.set('entry:example', { content: 'computed value' });
    const head = identity('commit').slice(0, 40);
    const content = {
      version: VERSION,
      repository: 'fixture',
      surface: identity('surface'),
      policy: identity('policy'),
      base: null,
      root: state.root,
      coverage: [head],
      commits: [head],
      deps: [],
      frontier: [head],
      attention: {
        commit_limit: 500,
        node_limit: 400,
        commits: 1,
        nodes: 1,
        truncated: false,
        reached: [],
      },
      head,
      checkpoints: [{ oid: head, root: state.root, nodes: 1 }],
    };
    const pack: Pack = { ...content, id: identity(content), pages: state.owned() };
    assert.throws(
      () => catalog.publish(pack, 1),
      (error) => error instanceof MemoryError && error.code === 'segment_too_large',
    );
    assert.equal(catalog.rows().length, 0);
    catalog.publish(pack, 1024 * 1024);
    assert.deepEqual(catalog.load(pack.id), pack);
    const reopened = new Catalog(catalog.directory);
    const release = reopened.lease([pack.id]);
    assert.equal(catalog.evict(0).over_capacity, true);
    release();
    assert.equal(catalog.evict(0).over_capacity, false);
    assert.throws(
      () => reopened.load(pack.id),
      (error) => error instanceof MemoryError && error.code === 'evicted',
    );
    reopened.publish(pack, 1024 * 1024);
    assert.equal(reopened.load(pack.id).root, pack.root);
    reopened.db((db) =>
      db.prepare("UPDATE meta SET value='unsupported' WHERE key='version'").run(),
    );
    assert.throws(
      () => new Catalog(catalog.directory),
      (error) => error instanceof MemoryError && error.code === 'incompatible',
    );
  } finally {
    f.clean();
  }
});

test('state map uses immutable pages and bounded key lookup', () => {
  const map = new StateMap(null, () => {
    throw Error('missing');
  });
  for (let i = 0; i < 1000; i++) map.set(`key${i}`, i);
  const pages = map.owned(),
    root = map.root;
  const next = new StateMap(root, (h) => pages[h]!);
  next.set('key4', 99);
  assert.equal(map.get('key4'), 4);
  assert.equal(next.get('key4'), 99);
  const before = next.visits;
  assert.equal(next.get('key999'), 999);
  assert.ok(next.visits - before <= 66);
  assert.throws(() =>
    OperationSchema.parse({ kind: 'decay', target: { sha: 'abc', index: 1 }, factor: NaN }),
  );
});

test('entry iteration skips unrelated state namespaces', () => {
  const map = new StateMap(null, () => {
    throw Error('missing');
  });
  for (let i = 0; i < 500; i++) map.set(`commit:${i}`, { parents: [] });
  map.set('entry:one', { content: 'one' });
  const before = map.visits;
  assert.deepEqual([...map.entries('entry:')], [['entry:one', { content: 'one' }]]);
  assert.equal(map.visits - before, 2);
});

test('runtime contracts validate versions, values, and policy ownership', () => {
  const defaults = UserConfigSchema.parse({});
  assert.equal(defaults.promotion.min_computations, 2);
  assert.equal(defaults.segments.max_bytes, 16777216);
  assert.throws(() => UserConfigSchema.parse({ segments: { max_bytes: 0 } }));
  assert.throws(() => UserConfigSchema.parse({ promotion: { min_computations: -1 } }));
  assert.throws(() => RepoConfigSchema.parse({ segments: { max_bytes: 999999999 } }));
  const op = OperationSchema.parse({ kind: 'entry', type: 'RISK', content: 'x' });
  assert.deepEqual(OperationSchema.parse(JSON.parse(json(op))), op);
});

test('failed and uncertain hooks survive cache cleanup and restart', async () => {
  const f = fixture();
  try {
    const catalog = new Catalog(join(f.home, 'v2'));
    let calls = 0;
    await catalog.hook('a', () => {
      calls++;
      throw Error('uncertain');
    });
    catalog.evict(0);
    const reopened = new Catalog(join(f.home, 'v2'));
    await reopened.hook('a', () => {
      calls++;
    });
    assert.equal(calls, 1);
    reopened.retry('a');
    await reopened.hook('a', () => {
      calls++;
    });
    assert.equal(calls, 2);
  } finally {
    f.clean();
  }
});
