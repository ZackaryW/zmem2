import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fixture } from './fixtures.js';
import { MemoryEngine } from '../src/core/engine.js';
import { Catalog } from '../src/core/catalog.js';

test('lowering commit caps repartitions precalculated state with zero expansion', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 6; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): item ${i}`);
    const original = new MemoryEngine(f.repo, { home: f.home });
    const result = await original.recall();
    f.user({ segments: { max_commits: 2 } });
    const smaller = new MemoryEngine(f.repo, { home: f.home });
    const repacked = await smaller.recall();
    assert.deepEqual(repacked.results, result.results);
    assert.equal(smaller.metrics.expansions, 0);
    const snapshot = await smaller.read();
    try {
      const seen = new Set<string>();
      const visit = (id: string) => {
        if (seen.has(id)) return;
        seen.add(id);
        const pack = smaller.local.load(id);
        assert.ok(pack.commits.length <= 2);
        assert.ok(smaller.local.row(id)!.size <= 16777216);
        pack.deps.forEach(visit);
      };
      visit(snapshot.segment.id);
    } finally {
      snapshot.release();
    }
  } finally {
    f.clean();
  }
});

test('incremental referenced recipes rebuild with the exact result identity', async () => {
  const f = fixture();
  try {
    f.commit('feat: first\n\nzmem(DECISION): first');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    await engine.recall();
    f.commit('feat: second\n\nzmem(DECISION): second');
    const before = await engine.recall();
    engine.local.evict(0);
    const after = await engine.recall();
    assert.equal(after.trail.id, before.trail.id);
    assert.deepEqual(after.results, before.results);
  } finally {
    f.clean();
  }
});

test('payload corruption is detected and reconstructs the sealed content', async () => {
  const f = fixture();
  try {
    f.commit('feat: first\n\nzmem(DECISION): first');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const before = await engine.recall();
    const row = engine.local.row(before.trail.id)!;
    writeFileSync(row.path, 'broken payload');
    const fresh = new MemoryEngine(f.repo, { home: f.home });
    const after = await fresh.recall();
    assert.deepEqual(after.results, before.results);
    assert.equal(after.trail.id, before.trail.id);
  } finally {
    f.clean();
  }
});

test('process death before catalog commit never exposes a ready segment', () => {
  const f = fixture();
  try {
    f.commit('feat: first\n\nzmem(DECISION): first');
    const module = pathToFileURL(resolve('dist/src/core/engine.js')).href;
    const script = `import {MemoryEngine} from ${JSON.stringify(module)};const engine=new MemoryEngine(${JSON.stringify(f.repo)},{home:${JSON.stringify(f.home)},fault(stage){if(stage==='payload')process.exit(79);}});await engine.index();`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(child.status, 79, child.stderr);
    const fresh = new MemoryEngine(f.repo, { home: f.home });
    assert.equal(fresh.local.rows().filter((r) => r.resident).length, 0);
    const failed = fresh.local.status().claims;
    assert.ok(failed.some((row) => row.state === 'failed'));
  } finally {
    f.clean();
  }
});

test('leases protect payloads across processes and dead owners are recovered', async () => {
  const f = fixture();
  try {
    f.commit('feat: first\n\nzmem(DECISION): first');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const result = await engine.recall();
    const catalog = new Catalog(engine.local.directory);
    catalog.db((db) =>
      db
        .prepare('INSERT INTO leases VALUES (?,?,?,?)')
        .run('dead', result.trail.id, 'dead', 2147483647),
    );
    assert.ok(catalog.leased(result.trail.id));
    catalog.recover();
    assert.equal(catalog.leased(result.trail.id), false);
    const release = catalog.lease([result.trail.id]);
    assert.equal(catalog.evict(0).over_capacity, true);
    release();
    assert.equal(catalog.evict(0).over_capacity, false);
  } finally {
    f.clean();
  }
});

test('lowered byte limits repartition computed checkpoints while old readers remain valid', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 8; i++)
      f.commit(`feat: ${i}\n\nzmem(DECISION): ${'value '.repeat(40)}${i}`);
    const original = new MemoryEngine(f.repo, { home: f.home });
    const before = await original.recall();
    const active = await original.read();
    try {
      const limit = Math.floor(original.local.row(before.trail.id)!.size * 0.6);
      f.user({ segments: { max_bytes: limit } });
      const smaller = new MemoryEngine(f.repo, { home: f.home });
      const after = await smaller.recall();
      assert.deepEqual(after.results, before.results);
      assert.equal(smaller.metrics.expansions, 0);
      assert.equal([...active.state.entries('entry:')].length, 8);
      assert.notEqual(after.trail.id, before.trail.id);
      const visit = (id: string) => {
        const row = smaller.local.row(id)!;
        assert.ok(row.size <= limit);
        smaller.local.load(id).deps.forEach(visit);
      };
      visit(after.trail.id);
    } finally {
      active.release();
    }
  } finally {
    f.clean();
  }
});

test('missing historical Git objects fail reconstruction explicitly', async () => {
  const f = fixture();
  try {
    const first = f.commit('feat: first\n\nzmem(DECISION): first');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    await engine.recall();
    f.commit('feat: second\n\nzmem(DECISION): second');
    await engine.recall();
    engine.local.evict(0);
    unlinkSync(join(f.repo, '.git', 'objects', first.slice(0, 2), first.slice(2)));
    await assert.rejects(
      engine.recall(),
      (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'missing_inputs',
    );
  } finally {
    f.clean();
  }
});

test('death inside the catalog transaction rolls back all ready coverage and cleans orphans', () => {
  const f = fixture();
  try {
    f.commit('feat: first\n\nzmem(DECISION): first');
    const module = pathToFileURL(resolve('dist/src/core/engine.js')).href;
    const script = `import {MemoryEngine} from ${JSON.stringify(module)};await new MemoryEngine(${JSON.stringify(f.repo)},{home:${JSON.stringify(f.home)},fault(stage){if(stage==='catalog')process.exit(79);}}).index();`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(child.status, 79, child.stderr);
    const reopened = new MemoryEngine(f.repo, { home: f.home });
    assert.equal(reopened.local.rows().length, 0);
    assert.equal(reopened.local.bytes(), 0);
    assert.ok(reopened.local.status().claims.some((r) => r.state === 'failed'));
  } finally {
    f.clean();
  }
});

test('pointer handoff survives process death on both sides of its transaction', async () => {
  for (const stage of ['before_pointer', 'after_pointer']) {
    const f = fixture();
    try {
      f.commit('feat: first\n\nzmem(DECISION): first');
      const registration = new MemoryEngine(f.repo, { home: f.home }).registration;
      f.user({
        promotion: { stable_boundaries: [{ repository: registration.repository, ref: 'main' }] },
      });
      const a = new MemoryEngine(f.repo, { home: f.home });
      const result = await a.recall();
      await new MemoryEngine(f.clone('b'), {
        home: f.home,
        associate: registration.repository,
      }).recall();
      const module = pathToFileURL(resolve('dist/src/core/engine.js')).href;
      const script = `import {MemoryEngine} from ${JSON.stringify(module)};await new MemoryEngine(${JSON.stringify(f.repo)},{home:${JSON.stringify(f.home)},fault(s){if(s===${JSON.stringify(stage)})process.exit(79);}}).recall();`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.equal(child.status, 79, child.stderr);
      const reopened = new MemoryEngine(f.repo, { home: f.home });
      assert.equal(
        reopened.local.row(result.trail.id)?.pointer,
        stage === 'before_pointer' ? 0 : 1,
      );
      if (stage === 'after_pointer') assert.equal(reopened.local.bytes(), 0);
      assert.deepEqual((await reopened.recall()).results, result.results);
      assert.equal(reopened.metrics.expansions, 0);
    } finally {
      f.clean();
    }
  }
});

test('demand LRU accounts each payload once and read leases protect the complete closure', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 4; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    f.user({ segments: { max_commits: 1 } });
    const engine = new MemoryEngine(f.repo, { home: f.home });
    await engine.recall();
    const rows = engine.local.rows();
    assert.equal(
      engine.local.bytes(),
      rows.reduce((n, r) => n + r.size, 0),
    );
    assert.ok(rows.every((r) => r.demand === null));
    const protectedRead = await engine.read();
    assert.equal(engine.local.evict(0).removed.length, 0);
    protectedRead.release();
    const hot = rows[0]!;
    engine.local.demand([hot.id], 100);
    const result = engine.local.evict(hot.size);
    assert.equal(result.bytes, hot.size);
    assert.equal(engine.local.row(hot.id)?.resident, 1);
    const expected = rows
      .filter((r) => r.id !== hot.id)
      .map((r) => r.id)
      .sort();
    assert.deepEqual(result.removed, expected);
  } finally {
    f.clean();
  }
});

test('a live query in another process protects its full dependency closure from eviction', async () => {
  const f = fixture();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    for (let i = 0; i < 3; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    f.user({ segments: { max_commits: 1 } });
    const engine = new MemoryEngine(f.repo, { home: f.home });
    await engine.recall();
    const module = pathToFileURL(resolve('dist/src/core/engine.js')).href;
    const script = `import {MemoryEngine} from ${JSON.stringify(module)};const snapshot=await new MemoryEngine(${JSON.stringify(f.repo)},{home:${JSON.stringify(f.home)}}).read();process.stdout.write('ready');process.stdin.once('data',()=>{snapshot.release();process.exit(0);});`;
    child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      windowsHide: true,
      stdio: 'pipe',
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('reader timed out')), 15000);
      child!.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child!.once('exit', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(Error(`reader exited ${code}`));
      });
      child!.stdout!.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const eviction = engine.local.evict(0);
    assert.equal(eviction.over_capacity, true);
    assert.equal(eviction.removed.length, 0);
    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.stdin!.write('release');
    await exited;
    assert.equal(engine.local.evict(0).over_capacity, false);
  } finally {
    child?.kill();
    f.clean();
  }
});
