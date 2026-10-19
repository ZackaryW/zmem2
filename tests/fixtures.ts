import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';

export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zmem2-test-'));
  const repo = join(root, 'repo'),
    home = join(root, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  let n = 0;
  const commit = (message: string) => {
    writeFileSync(join(repo, 'value.txt'), String(++n));
    git('add', '.');
    git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const user = (config: unknown) => writeFileSync(join(home, 'config.yaml'), stringify(config));
  const clone = (name: string) => {
    const path = join(root, name);
    execFileSync('git', ['clone', '--no-hardlinks', repo, path], {
      stdio: 'pipe',
      windowsHide: true,
    });
    return path;
  };
  return {
    root,
    repo,
    home,
    git,
    commit,
    user,
    clone,
    clean: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}
