import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { consumerEnv, launcher, npm, run, temporary } from './process.mjs';

export function verifySourceInstall(input) {
  const hostNpmVersion = npm(['--version']).toString().trim();
  const sourceNpm = (args, options) =>
    npm(['exec', '--yes', '--package=npm@12.2.1', '--', 'npm', ...args], options);
  const temp = temporary('zmem source ');
  try {
    const source = join(temp.root, 'source');
    copySource(resolve(input), source);
    const env = consumerEnv(temp.root);
    const npmVersion = sourceNpm(['--version'], { cwd: temp.root, env }).toString().trim();
    assert.equal(npmVersion, '12.2.1', 'Source installation must use the selected npm');
    const version = JSON.parse(readFileSync(join(source, 'package.json'))).version;
    const check = (prefix) => {
      const options = { cwd: temp.root, env };
      for (const kind of process.platform === 'win32' ? ['default', 'powershell'] : ['default'])
        assert.deepEqual(JSON.parse(launcher(prefix, ['--version'], options, kind)), {
          product: 'zmem',
          version,
        });
    };
    assert.equal(existsSync(join(source, 'dist')), false);
    assert.equal(existsSync(join(source, 'node_modules')), false);
    sourceNpm(['ci'], { cwd: source, env });
    assert.ok(existsSync(join(source, 'dist/src/cli/main.js')));
    const linked = join(temp.root, 'linked');
    sourceNpm(['link'], { cwd: source, env: { ...env, npm_config_prefix: linked } });
    check(linked);
    const local = join(temp.root, 'local');
    sourceNpm(['install', '--global', '--prefix', local, source], { cwd: temp.root, env });
    check(local);

    // A clean committed source snapshot must be sufficient for Git installation.
    const gitSource = join(temp.root, 'git-source');
    copySource(input, gitSource);
    const git = (...args) => run('git', ['-C', gitSource, ...args], { env });
    git('init', '--initial-branch=main');
    git('add', '.');
    git(
      '-c',
      'user.name=Install Test',
      '-c',
      'user.email=install@example.invalid',
      'commit',
      '-m',
      'test: clean source fixture',
    );
    const sha = git('rev-parse', 'HEAD').toString().trim();
    const gitPrefix = join(temp.root, 'git-install');
    sourceNpm(
      [
        'install',
        '--global',
        '--prefix',
        gitPrefix,
        `git+${pathToFileURL(gitSource).href}#${sha}`,
        '--foreground-scripts',
        '--allow-git=root',
      ],
      { cwd: temp.root, env },
    );
    renameSync(gitSource, `${gitSource}-unavailable`);
    check(gitPrefix);

    const disabled = join(temp.root, 'disabled');
    copySource(input, disabled);
    sourceNpm(['ci', '--ignore-scripts'], { cwd: disabled, env });
    assert.equal(existsSync(join(disabled, 'dist')), false);
    sourceNpm(['run', 'build'], { cwd: disabled, env });
    assert.deepEqual(
      JSON.parse(
        run(process.execPath, [join(disabled, 'dist/src/cli/main.js'), '--version'], {
          cwd: temp.root,
          env,
        }),
      ),
      { product: 'zmem', version },
    );
    return {
      sourceInstall: 'passed',
      npm: npmVersion,
      hostNpm: hostNpmVersion,
      version,
      checkout: 'prepared',
      git: 'pinned-clean-source',
      scriptsDisabled: 'explicit-build',
      launchers: process.platform === 'win32' ? ['cmd', 'powershell'] : ['posix'],
    };
  } finally {
    temp.dispose();
  }
}

function copySource(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const path of [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'src',
    'tests',
    'scripts',
    'docs',
    'skills',
    'README.md',
    'LICENSE',
  ])
    cpSync(join(source, path), join(destination, path), { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(verifySourceInstall(process.argv[2] ?? '.'), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
