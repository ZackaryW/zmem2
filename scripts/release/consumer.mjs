import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { run, verifyAssets } from './artifacts.mjs';

export function verifyCliVersion(output, version) {
  const actual = JSON.parse(output);
  if (actual.product !== 'zmem' || actual.version !== version) {
    throw new Error('Built CLI version does not match release metadata');
  }
}

export function consume(dir, expected = {}) {
  const manifest = verifyAssets(dir, expected);
  const root = mkdtempSync(join(tmpdir(), 'zmem-release-consumer-'));
  try {
    const archive = resolve(dir, manifest.archive);
    const prefix = `zmem2-${manifest.version}/`;
    const entries = run('tar', ['-tzf', archive]).toString().trim().split('\n');
    if (entries.some((p) => !p.startsWith(prefix) || p.split('/').includes('..'))) {
      throw new Error('Unsafe source archive paths');
    }
    for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'src/cli/main.ts']) {
      if (!entries.includes(`${prefix}${path}`))
        throw new Error(`Source archive is missing ${path}`);
    }
    run('tar', ['-xzf', archive, '-C', root]);
    const source = join(root, `zmem2-${manifest.version}`);
    const userConfig = join(root, 'npmrc');
    writeFileSync(userConfig, '');
    const env = {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      GH_TOKEN: '',
      GITHUB_TOKEN: '',
      NODE_OPTIONS: '',
      npm_config_userconfig: userConfig,
      npm_config_cache: join(root, 'npm-cache'),
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    };
    const npm = (...args) => run('npm', args, { cwd: source, env });
    npm('ci', '--ignore-scripts');
    npm('run', 'build');
    const [packed] = JSON.parse(npm('pack', '--ignore-scripts', '--json').toString());
    if (!packed || packed.filename !== `zmem2-${manifest.version}.tgz`)
      throw new Error('Unexpected npm package');
    const runtime = join(root, 'runtime');
    npm(
      'install',
      '--global',
      '--ignore-scripts',
      '--prefix',
      runtime,
      join(source, packed.filename),
    );
    const executable = join(runtime, 'bin', 'zmem');
    const cli = (...args) => run(executable, args, { cwd: root, env }).toString();
    verifyCliVersion(cli('--version'), manifest.version);
    if (!cli('--help').includes('zmem <command>'))
      throw new Error('Installed CLI help is unavailable');
    const repo = join(root, 'repository');
    mkdirSync(repo);
    const git = (...args) => run('git', ['-C', repo, ...args]);
    git('init', '--initial-branch=main');
    const marker = 'release archive consumer annotation';
    git(
      '-c',
      'user.name=Release Test',
      '-c',
      'user.email=release@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      `test: release consumer\n\nzmem(DECISION): ${marker}`,
    );
    const home = join(root, 'zmem-home');
    cli('--repo', repo, '--home', home, '--no-background', 'init');
    cli('--repo', repo, '--home', home, '--no-background', 'sync');
    const recalled = JSON.parse(cli('--repo', repo, '--home', home, '--no-background', 'recall'));
    if (!Array.isArray(recalled.results) || !JSON.stringify(recalled.results).includes(marker)) {
      throw new Error('Installed archive CLI did not recall the known annotation');
    }
    return { version: manifest.version, sourceSha: manifest.sourceSha, recall: 'passed' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
