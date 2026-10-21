import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { MemoryEngine } from '../src/core/engine.js';
import { UserConfigSchema } from '../src/core/config.js';
import { fixture } from './fixtures.js';

test('fresh CLI uses 64 commits; full backfill remains complete after a new old-target effect', async () => {
  const f = fixture();
  try {
    const origins = Array.from({ length: 70 }, (_, i) =>
      f.commit(`feat: ${i}\n\nzmem(DECISION): batch ${i}`),
    );
    const child = spawnSync(
      process.execPath,
      [
        resolve('dist/src/cli/main.js'),
        '--repo',
        f.repo,
        '--home',
        f.home,
        'init',
        '--no-background',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(child.status, 0, child.stderr);
    const initial = JSON.parse(child.stdout);
    assert.equal(initial.attention.commit_limit, 64);
    assert.equal(initial.attention.commits, 64);
    assert.equal(initial.memory_coverage.complete, false);
    const full = new MemoryEngine(f.repo, { home: f.home });
    const original = await full.recall({ commitLimit: -1, nodeLimit: -1 });
    assert.equal(original.count, 70);
    f.commit(`feat: retire\n\nzmem(CANCEL)[${origins[0]}, 1]`);
    const next = new MemoryEngine(f.repo, { home: f.home });
    const result = await next.recall({ includeInvalid: true });
    assert.equal(result.attention.truncated, false);
    assert.equal(result.attention.commits, 71);
    assert.equal(result.results.find((e) => e.sha === origins[0])?.valid, false);
    assert.equal(next.metrics.computed_commits, 1);
    assert.equal(next.metrics.effects, 1);
    const old = await next.recall({ ref: origins.at(-1), includeInvalid: true });
    assert.equal(old.results.find((e) => e.sha === origins[0])?.valid, true);
    assert.equal((await next.recall({ commitLimit: 2 })).attention.commits, 2);
    const preview = await next.check('chore: preview');
    assert.equal(preview.ok, true);
    assert.equal(preview.attention.commit_limit, 500);
  } finally {
    f.clean();
  }
});

test('initial-window configuration and explicit environment limits are distinct', async () => {
  const f = fixture();
  const before = process.env.ZMEM_COMMIT_LIMIT;
  try {
    for (let i = 0; i < 5; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    f.user({ foreground: { initial_commits: 2 }, background: { timeout_ms: 1500 } });
    const e = new MemoryEngine(f.repo, { home: f.home });
    assert.equal((await e.recall()).attention.commits, 2);
    process.env.ZMEM_COMMIT_LIMIT = '4';
    assert.equal((await e.recall()).attention.commits, 4);
    assert.equal((await e.recall({ commitLimit: 1 })).attention.commits, 1);
    assert.equal(e.settings.user.background.timeout_ms, 1500);
    assert.equal(UserConfigSchema.parse({}).foreground.initial_commits, 64);
    assert.equal(UserConfigSchema.parse({}).background.timeout_ms, 90000);
    assert.throws(() => UserConfigSchema.parse({ foreground: { initial_commits: 0 } }));
  } finally {
    if (before === undefined) delete process.env.ZMEM_COMMIT_LIMIT;
    else process.env.ZMEM_COMMIT_LIMIT = before;
    f.clean();
  }
});

test('complete initial-window state extends without recomputation across attention policies', async () => {
  const f = fixture();
  try {
    const first = f.commit('feat: one\n\nzmem(DECISION): keep');
    const e = new MemoryEngine(f.repo, { home: f.home });
    const old = await e.recall();
    assert.equal(old.attention.truncated, false);
    assert.equal((await e.recall()).trail.id, old.trail.id);
    f.commit(`feat: cancel\n\nzmem(CANCEL)[${first}, 1]`);
    const next = new MemoryEngine(f.repo, { home: f.home });
    assert.equal((await next.recall()).count, 0);
    assert.equal(next.metrics.computed_commits, 1);
    assert.equal((await next.recall({ ref: first })).results[0]?.valid, true);
  } finally {
    f.clean();
  }
});
