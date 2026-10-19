import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fixture } from './fixtures.js';
import { MemoryEngine } from '../src/core/engine.js';

test('documented CLI operations agree with the library and isolated audit', async () => {
  const f = fixture();
  try {
    const a = f.commit('feat(cache): initial\n\nzmem(DECISION): SQLite');
    const call = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [resolve('dist/src/cli/main.js'), '--repo', f.repo, '--home', f.home, ...args],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 },
      );
    const init = call('init');
    assert.equal(init.status, 0, init.stderr);
    assert.equal(JSON.parse(call('--version').stdout).product, 'zmem');
    assert.match(call('--help').stdout, /^zmem <command>/);
    assert.ok(JSON.parse(init.stdout).repository.repository);
    const configured = call('config', '--user', '--stable-ref', 'main');
    assert.equal(configured.status, 0, configured.stderr);
    const previousConfig = JSON.parse(call('config', '--user').stdout);
    assert.equal(call('config', '--user', '--stable-oid', 'abc').status, 2);
    assert.deepEqual(JSON.parse(call('config', '--user').stdout), previousConfig);
    const engine = new MemoryEngine(f.repo, { home: f.home });
    const expected = await engine.recall();
    const result = call('recall', '--event', 'DECISION');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).results, expected.results);
    assert.equal(JSON.parse(call('search', 'SQLite').stdout).count, 1);
    assert.equal(JSON.parse(call('show', a).stdout).commit.oid, a);
    const message = join(f.root, 'COMMIT_EDITMSG');
    writeFileSync(message, `feat: cancel\n\nzmem(CANCEL)[${a}, 1]`);
    const preview = call('check', '--file', message);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).effects[0].after.valid, false);
    const deep = call('check', '--file', message, '--deep');
    assert.equal(deep.status, 0, deep.stderr);
    assert.equal(JSON.parse(deep.stdout).mode, 'deep');
    assert.equal((await engine.recall()).results[0]?.valid, true);
    writeFileSync(message, 'ordinary message');
    assert.equal(call('check', '--file', message, '--require-annotation').status, 5);
    assert.equal(call('search', 'SQLite', '--limit', '-1').status, 2);
    const status = call('status');
    assert.equal(status.status, 0, status.stderr);
  } finally {
    f.clean();
  }
});

test('init can register an unborn repository and later establish an association witness', () => {
  const f = fixture();
  try {
    const initial = new MemoryEngine(f.repo, { home: f.home });
    assert.ok(initial.registration.repository);
    f.commit('feat: first');
    const refreshed = new MemoryEngine(f.repo, { home: f.home });
    assert.equal(refreshed.registration.repository, initial.registration.repository);
    const clone = new MemoryEngine(f.clone('clone'), {
      home: f.home,
      associate: initial.registration.repository,
    });
    assert.equal(clone.registration.repository, initial.registration.repository);
  } finally {
    f.clean();
  }
});

test('init sets up a trackable repository and sync incrementally reuses its computed index', () => {
  const f = fixture();
  try {
    f.commit('feat: first\n\nzmem(DECISION): first');
    mkdirSync(join(f.repo, '.zmem'), { recursive: true });
    const existingConfig = '# repository choices\nextensions: []\n';
    writeFileSync(join(f.repo, '.zmem', 'config.yaml'), existingConfig);
    const previousIgnore = 'node_modules/\r\n# keep this comment';
    writeFileSync(join(f.repo, '.gitignore'), previousIgnore);
    const call = (command: string, ...extra: string[]) =>
      spawnSync(
        process.execPath,
        [resolve('dist/src/cli/main.js'), command, f.repo, '--home', f.home, ...extra],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 },
      );
    const initial = call('init');
    assert.equal(initial.status, 0, initial.stderr);
    assert.equal(JSON.parse(initial.stdout).metrics.computed_commits, 1);
    const expectedIgnore = `${previousIgnore}\r\n/.zmem/index/\r\n`;
    assert.equal(readFileSync(join(f.repo, '.gitignore'), 'utf8'), expectedIgnore);
    assert.equal(readFileSync(join(f.repo, '.zmem', 'config.yaml'), 'utf8'), existingConfig);
    assert.ok(f.git('check-ignore', '.zmem/index/example.sqlite'));
    assert.throws(() => f.git('check-ignore', '.zmem/config.yaml'));
    assert.throws(() => f.git('check-ignore', '.zmem/extensions/example/extension.mjs'));
    assert.equal(call('init').status, 0);
    assert.equal(readFileSync(join(f.repo, '.gitignore'), 'utf8'), expectedIgnore);
    const warm = call('sync');
    assert.equal(warm.status, 0, warm.stderr);
    assert.equal(JSON.parse(warm.stdout).metrics.expansions, 0);
    f.commit('feat: next\n\nzmem(LESSON_LEARNT): next');
    const next = call('sync');
    assert.equal(next.status, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout).metrics.computed_commits, 1);
    assert.equal(JSON.parse(next.stdout).command, 'sync');
    const alias = call('index');
    assert.equal(alias.status, 0, alias.stderr);
    assert.equal(JSON.parse(alias.stdout).segment, JSON.parse(next.stdout).segment);
    assert.equal(JSON.parse(alias.stdout).metrics.expansions, 0);
    assert.equal(call('status').status, 0);
  } finally {
    f.clean();
  }
});

test('CLI init supports an unborn repository and creates the default config without a commit', () => {
  const f = fixture();
  try {
    const call = (command: string) =>
      spawnSync(
        process.execPath,
        [resolve('dist/src/cli/main.js'), command, f.repo, '--home', f.home],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 },
      );
    const initial = call('init');
    assert.equal(initial.status, 0, initial.stderr);
    assert.equal(JSON.parse(initial.stdout).segment, null);
    assert.equal(JSON.parse(initial.stdout).metrics.computed_commits, 0);
    assert.equal(readFileSync(join(f.repo, '.zmem', 'config.yaml'), 'utf8'), 'extensions: []\n');
    assert.equal(existsSync(join(f.repo, '.gitignore')), true);
    assert.throws(() => f.git('rev-parse', '--verify', 'HEAD'));
    f.commit('feat: first\n\nzmem(DECISION): first');
    const synced = call('sync');
    assert.equal(synced.status, 0, synced.stderr);
    assert.equal(JSON.parse(synced.stdout).metrics.computed_commits, 1);
  } finally {
    f.clean();
  }
});
