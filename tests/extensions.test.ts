import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, cpSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, extension } from './fixtures.js';
import { MemoryEngine } from '../src/core/engine.js';
import { surface } from '../src/ext/tseam/loader.js';
import { MemoryError } from '../src/core/contracts.js';

test('declarative types and executable types use the same operation contract', async () => {
  const f = fixture();
  try {
    extension(f.repo, { id: 'example', version: '1.0.0', types: { RISK: { kind: 'entry' } } });
    f.commit('feat: risk\n\nzmem(RISK): API instability');
    const a = new MemoryEngine(f.repo, { home: f.home });
    const entry = (await a.recall()).results[0]!;
    assert.equal(entry.type, 'RISK');
    assert.equal(entry.content, 'API instability');
    extension(
      f.repo,
      {
        id: 'example',
        version: '1.0.0',
        entry: 'extension.mjs',
        deterministic: true,
        types: { RISK: { kind: 'entry', handler: 'risk' } },
      },
      `export function register(registry){registry.extend('RISK',{expand(ctx){ctx.addEntry({type:'RISK',content:ctx.annotation.content});}});}`,
    );
    await assert.rejects(new MemoryEngine(f.repo, { home: f.home }).recall(), /Trust executable/);
    const b = new MemoryEngine(f.repo, { home: f.home, trust: true });
    assert.deepEqual((await b.recall()).results[0], entry);
  } finally {
    f.clean();
  }
});

test('trust, registration conflicts, and effective surface identity are explicit', async () => {
  const f = fixture();
  try {
    const manifest = {
      id: 'example',
      version: '1.0.0',
      entry: 'extension.mjs',
      deterministic: true,
      types: { RISK: { kind: 'entry', handler: 'risk' } },
    };
    const code = `export function register(registry){registry.extend('RISK',{expand(ctx){ctx.addEntry({type:'RISK',content:ctx.annotation.content});}});}`;
    const root = extension(f.repo, manifest, code);
    f.commit('feat: risk\n\nzmem(RISK): API instability');
    await assert.rejects(new MemoryEngine(f.repo, { home: f.home }).recall(), /Trust executable/);
    const engine = new MemoryEngine(f.repo, { home: f.home, trust: true });
    assert.equal((await engine.recall()).results[0]?.type, 'RISK');
    const count = engine.metrics.expansions;
    await engine.recall();
    assert.equal(engine.metrics.expansions, count);
    const first = surface(f.repo, f.home, { extensions: [{ path: 'extensions/example' }] }, true);
    const installed = join(f.home, 'extensions', 'example', '1.0.0');
    mkdirSync(installed, { recursive: true });
    cpSync(root, installed, { recursive: true });
    const same = surface(
      f.repo,
      f.home,
      { extensions: [{ id: 'example', version: '1.0.0' }] },
      true,
    );
    assert.equal(first.id, same.id);
    assert.equal(first.shareable, true);
    writeFileSync(join(root, 'helper.mjs'), 'export const value=2;');
    assert.notEqual(
      first.id,
      surface(f.repo, f.home, { extensions: [{ path: 'extensions/example' }] }, true).id,
    );
    extension(f.repo, { id: 'bad', version: '1.0.0', types: { DECISION: { kind: 'entry' } } });
    await assert.rejects(new MemoryEngine(f.repo, { home: f.home }).recall(), /duplicate type/);
  } finally {
    f.clean();
  }
});

test('declarative compound DSL expands once and preserves cancellation results', async () => {
  const f = fixture();
  try {
    const a = f.commit('feat: old\n\nzmem(DECISION): JSON');
    extension(f.repo, {
      id: 'replace',
      version: '1.0.0',
      inputs: { replacementType: 'DECISION' },
      types: {
        SUPERSEDE: {
          kind: 'operation',
          operations: [
            { function: 'entry', type: '$inputs.replacementType', content: '$annotation.content' },
            { function: 'cancel', target: '$annotation.target' },
            {
              function: 'relationship',
              source: '$currentEntry',
              target: `${a}:1`,
              relation: 'supersedes',
            },
          ],
        },
      },
    });
    f.commit(`feat: replace\n\nzmem(SUPERSEDE)[${a}, 1]: SQLite`);
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const result = await engine.recall({ includeInvalid: true });
    assert.equal(result.results.filter((e) => e.valid).length, 1);
    assert.equal(result.results.find((e) => e.sha === a)?.valid, false);
    assert.equal((await engine.links()).results.length, 1);
    const expansions = engine.metrics.expansions;
    await engine.recall();
    assert.equal(engine.metrics.expansions, expansions);
    extension(f.repo, {
      id: 'unknown',
      version: '1.0.0',
      types: { CUSTOM: { kind: 'operation', operations: [{ function: 'REORDER' }] } },
    });
    await assert.rejects(
      new MemoryEngine(f.repo, { home: f.home }).recall(),
      /unknown DSL function/,
    );
  } finally {
    f.clean();
  }
});

test('changing sessions or pack boundaries does not retry a failed historical hook', async () => {
  const f = fixture();
  const globals = globalThis as unknown as Record<string, unknown>;
  try {
    globals.zmemHookTestCount = 0;
    extension(
      f.repo,
      {
        id: 'observer',
        version: '1.0.0',
        entry: 'extension.mjs',
        types: { RISK: { kind: 'entry', handler: 'risk' } },
      },
      `export function register(r){r.extend('RISK',{expand(c){c.addEntry({type:'RISK',content:c.annotation.content});}});r.afterIndex('notify',()=>{globalThis.zmemHookTestCount++;throw Error('uncertain delivery');});}`,
    );
    f.commit('feat: risk\n\nzmem(RISK): API');
    const first = new MemoryEngine(f.repo, { home: f.home, trust: true });
    await first.recall();
    assert.equal(globals.zmemHookTestCount, 1);
    first.local.evict(0);
    const second = new MemoryEngine(f.repo, { home: f.home });
    await second.recall();
    assert.equal(globals.zmemHookTestCount, 1);
  } finally {
    delete globals.zmemHookTestCount;
    f.clean();
  }
});

test('changed helper modules execute under a fresh captured generation', async () => {
  const f = fixture();
  try {
    const root = extension(
      f.repo,
      {
        id: 'helper',
        version: '1.0.0',
        entry: 'extension.mjs',
        deterministic: true,
        types: { RISK: { kind: 'entry', handler: 'risk' } },
      },
      `import {value} from './helper.mjs';export function register(r){r.extend('RISK',{expand(c){c.addEntry({type:'RISK',content:value});}});}`,
    );
    writeFileSync(join(root, 'helper.mjs'), `export const value='first';`);
    f.commit('feat: risk\n\nzmem(RISK): input');
    const first = await new MemoryEngine(f.repo, { home: f.home, trust: true }).recall();
    writeFileSync(join(root, 'helper.mjs'), `export const value='second';`);
    const second = await new MemoryEngine(f.repo, { home: f.home }).recall();
    assert.equal(first.results[0]?.content, 'first');
    assert.equal(second.results[0]?.content, 'second');
    assert.notEqual(first.trail.surface, second.trail.surface);
    assert.notEqual(first.trail.id, second.trail.id);
  } finally {
    f.clean();
  }
});

test('invalid API versions and non-void expansions cannot publish partial annotation effects', async () => {
  const f = fixture();
  try {
    const manifest = {
      id: 'invalid',
      version: '1',
      api_version: 2,
      types: { RISK: { kind: 'entry' } },
    };
    extension(f.repo, manifest);
    f.commit('feat: risk\n\nzmem(RISK): text');
    await assert.rejects(new MemoryEngine(f.repo, { home: f.home }).recall());
    extension(
      f.repo,
      {
        ...manifest,
        api_version: 1,
        entry: 'extension.mjs',
        types: { RISK: { kind: 'entry', handler: 'risk' } },
      },
      `export function register(r){r.extend('RISK',{expand(c){c.addEntry({type:'RISK',content:'must roll back'});return 42;}});}`,
    );
    const result = await new MemoryEngine(f.repo, { home: f.home, trust: true }).recall();
    assert.equal(result.results.length, 0);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0]!.message, /return|nothing|void/);
  } finally {
    f.clean();
  }
});

test('missing selected extension inputs return explicit unavailability after eviction', async () => {
  const f = fixture();
  try {
    const root = extension(f.repo, {
      id: 'risk',
      version: '1',
      types: { RISK: { kind: 'entry' } },
    });
    f.commit('feat: risk\n\nzmem(RISK): risk');
    const engine = new MemoryEngine(f.repo, { home: f.home });
    await engine.recall();
    engine.local.evict(0);
    renameSync(root, `${root}-removed`);
    await assert.rejects(
      engine.recall(),
      (e) => e instanceof MemoryError && e.code === 'missing_inputs',
    );
  } finally {
    f.clean();
  }
});
