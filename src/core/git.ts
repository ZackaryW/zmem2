import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { MemoryError, identity, type Commit, type Selection } from './contracts.js';
import { annotations } from './annotations.js';

export class GitRepo {
  readonly root: string;
  readonly common: string;
  constructor(path: string) {
    this.root = realpathSync(this.command(path, ['rev-parse', '--show-toplevel']).trim());
    this.common = realpathSync(
      this.git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(),
    );
  }
  private command(path: string, args: string[]): string {
    try {
      return execFileSync('git', ['-C', path, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new MemoryError('repository', `Git operation failed: ${String(error)}`);
    }
  }
  git(args: string[]) {
    return this.command(this.root, args);
  }
  resolve(ref = 'HEAD') {
    return this.git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  }
  unborn(): boolean {
    let branch: string;
    try {
      branch = this.git(['symbolic-ref', '--quiet', 'HEAD']).trim();
    } catch {
      return false;
    }
    return !this.git(['for-each-ref', '--format=%(refname)', branch])
      .trim()
      .split(/\r?\n/)
      .includes(branch);
  }
  ancestor(from: string, to: string): boolean {
    try {
      this.git(['merge-base', '--is-ancestor', from, to]);
      return true;
    } catch {
      return false;
    }
  }
  commit(oid: string, withPaths = true): Commit {
    const data = this.git(['show', '-s', '--format=%H%x00%P%x00%ct%x00%B', oid]).split('\0');
    const message = data.slice(3).join('\0').trimEnd();
    const paths = withPaths
      ? this.git([
          'diff-tree',
          '--root',
          '-m',
          '--no-commit-id',
          '--name-only',
          '-r',
          '--no-renames',
          oid,
          '--',
        ])
          .split(/\r?\n/)
          .filter(Boolean)
      : [];
    return {
      oid: data[0]!,
      parents: data[1]!.split(' ').filter(Boolean),
      time: Number(data[2]),
      message,
      paths: [...new Set(paths)],
      scope: message.split('\n')[0]?.match(/^\w+\(([^)]+)\)!?:/)?.[1] ?? null,
    };
  }
  select(ref = 'HEAD', commitLimit = 500, nodeLimit = 400, observed?: string): Selection {
    for (const value of [commitLimit, nodeLimit])
      if (!Number.isSafeInteger(value) || (value !== -1 && value <= 0))
        throw new MemoryError('invalid_input', 'attention limits must be positive or -1');
    const head = this.resolve(ref);
    if (observed && head !== observed)
      throw new MemoryError('stale_ref', 'Git reference moved', { observed, head });
    const rows = this.git([
      'rev-list',
      '--date-order',
      '--parents',
      ...(commitLimit === -1 ? [] : [`--max-count=${commitLimit + 1}`]),
      head,
    ])
      .trim()
      .split('\n')
      .filter(Boolean);
    const selected = new Map<string, Commit>();
    let nodes = 0;
    const reached: string[] = [];
    for (const row of rows) {
      if (commitLimit !== -1 && selected.size >= commitLimit) {
        reached.push('commits');
        break;
      }
      const [oid, ...parents] = row.trim().split(' ');
      const commit = this.commit(oid!, false);
      const count = annotations(commit.message).filter((a) => !a.error).length;
      if (nodeLimit !== -1 && nodes + count > nodeLimit) {
        reached.push('nodes');
        break;
      }
      nodes += count;
      // Do not retain every message and changed-path list while selecting history.
      selected.set(oid!, { ...commit, parents, message: '', paths: [] });
    }
    const commits: Commit[] = [];
    const done = new Set<string>();
    while (done.size < selected.size) {
      const ready = [...selected.values()]
        .filter((c) => !done.has(c.oid) && c.parents.every((p) => !selected.has(p) || done.has(p)))
        .sort((a, b) => (a.oid < b.oid ? -1 : 1));
      if (!ready.length) throw new MemoryError('repository', 'cyclic Git ancestry');
      for (const c of ready) {
        done.add(c.oid);
        commits.push(c);
      }
    }
    if (this.resolve(ref) !== head)
      throw new MemoryError('stale_ref', 'Git reference moved during selection');
    return {
      head,
      commits,
      attention: {
        commit_limit: commitLimit,
        node_limit: nodeLimit,
        commits: commits.length,
        nodes,
        truncated: reached.length > 0,
        reached,
      },
    };
  }
  locationKey() {
    return identity({
      path: process.platform === 'win32' ? this.root.toLowerCase() : this.root,
      common: this.common,
    });
  }
}

export function affectedAreas(paths: readonly string[]): string[] | null {
  const groups = new Map<string, string[][]>();
  for (const path of paths) {
    const parts = path.split('/');
    const key = parts.length === 1 ? '<root>' : parts[0]!;
    const list = groups.get(key) ?? [];
    list.push(parts.slice(0, -1));
    groups.set(key, list);
  }
  if (groups.size > 3) return null;
  return [...groups]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, parts]) => {
      if (key === '<root>') return key;
      const prefix = [...parts[0]!];
      for (const part of parts) while (prefix.some((v, i) => part[i] !== v)) prefix.pop();
      return prefix.join('/');
    });
}
