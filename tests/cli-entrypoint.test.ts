import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entrypoint = resolve('dist/src/cli/main.js');
const run = (...args: string[]) =>
  spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });

test('CLI starts through a filesystem link as well as its real path', () => {
  const root = mkdtempSync(join(tmpdir(), 'zmem-cli-link-'));
  const link = join(root, 'zmem');
  const directoryLink = process.platform === 'win32';
  let linked = false;
  try {
    // Windows junctions exercise canonicalization without file-symlink privileges.
    symlinkSync(
      directoryLink ? dirname(entrypoint) : entrypoint,
      link,
      directoryLink ? 'junction' : 'file',
    );
    linked = true;
    for (const executable of [entrypoint, directoryLink ? join(link, 'main.js') : link]) {
      const version = run(executable, '--version');
      assert.equal(version.status, 0, version.stderr);
      assert.notEqual(version.stdout.trim(), '', 'CLI must not silently exit through a link');
      assert.deepEqual(JSON.parse(version.stdout), {
        product: 'zmem',
        version: JSON.parse(readFileSync('package.json', 'utf8')).version,
      });
      for (const args of [[], ['--help']]) {
        const help = run(executable, ...args);
        assert.equal(help.status, 0, help.stderr);
        assert.match(help.stdout, /^zmem <command>/);
      }
    }
  } finally {
    if (linked) {
      if (directoryLink) rmdirSync(link);
      else unlinkSync(link);
    }
    rmdirSync(root);
  }
});

test('importing the CLI does not run it', () => {
  const result = run(
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(pathToFileURL(entrypoint).href)})`,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
