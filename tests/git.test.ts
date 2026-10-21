import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { GitRepo } from '../src/core/git.js';
import { fixture } from './fixtures.js';

test('batched metadata matches Git for Unicode multiline messages and merge ordering', () => {
  const f = fixture();
  try {
    const root = f.commit(
      'feat(memory)!: café 日本語\n\nfirst paragraph\nsecond line\n\nzmem(DECISION): Unicode ✓',
    );
    f.git('commit', '--allow-empty', '-m', 'feat: main\n\nzmem(DECISION): main');
    const main = f.git('rev-parse', 'HEAD');
    f.git('checkout', '-b', 'side', root);
    f.git('commit', '--allow-empty', '-m', 'feat: side\n\nzmem(DECISION): side');
    const side = f.git('rev-parse', 'HEAD');
    f.git('checkout', 'main');
    f.git('merge', '--no-ff', 'side', '-m', 'feat: merge\n\nzmem(DECISION): merged');
    const head = f.git('rev-parse', 'HEAD');
    const repo = new GitRepo(f.repo);
    const selected = repo.select('HEAD', -1, -1);
    assert.deepEqual(
      selected.commits.map((c) => c.oid),
      [root, ...[main, side].sort(), head],
    );
    for (const oid of [root, main, side, head]) {
      const fields = f.git('show', '-s', '--format=%H%x00%P%x00%ct%x00%B', oid).split('\0');
      const actual = repo.commit(oid, false);
      assert.equal(actual.message, fields.slice(3).join('\0').trimEnd());
      assert.deepEqual(actual.parents, fields[1]!.split(' ').filter(Boolean));
      assert.equal(actual.time, Number(fields[2]));
      actual.parents.push('caller-mutation');
      assert.ok(!repo.commit(oid, false).parents.includes('caller-mutation'));
    }
    assert.equal(repo.commit(root).scope, 'memory');
    assert.deepEqual(repo.commit(root).paths, ['value.txt']);
    assert.deepEqual(new Set(repo.commit(head).parents), new Set([main, side]));
    const bounded = repo.select('HEAD', -1, 2);
    assert.equal(bounded.attention.nodes, 2);
    assert.equal(bounded.attention.commits, 2);
    assert.deepEqual(bounded.attention.reached, ['nodes']);
    assert.equal(repo.select('HEAD', 1, -1).attention.commits, 1);
  } finally {
    f.clean();
  }
});

test('selection uses bounded metadata batches instead of one process per commit', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 70; i++) f.commit(`feat: ${i}\n\nzmem(DECISION): ${i}`);
    const repo = new GitRepo(f.repo),
      calls: string[][] = [];
    const git = repo.git.bind(repo);
    repo.git = (args) => {
      calls.push(args);
      return git(args);
    };
    const selected = repo.select('HEAD', -1, -1);
    assert.equal(selected.commits.length, 70);
    const metadata = calls.filter((args) => args[0] === 'show');
    assert.equal(metadata.length, 2);
    assert.ok(
      metadata.every((args) => args.filter((value) => /^[a-f0-9]{40}$/.test(value)).length <= 64),
    );
    for (const commit of selected.commits) repo.commit(commit.oid, false);
    assert.equal(calls.filter((args) => args[0] === 'show').length, 2);
    assert.throws(() => repo.prefetch(['--all']), /resolved commit/);
  } finally {
    f.clean();
  }
});

test('unusual raw commit messages retain single-commit Git decoding semantics', () => {
  const f = fixture();
  try {
    const parent = f.commit('feat: root');
    const raw = `tree ${f.git('rev-parse', 'HEAD^{tree}')}\nparent ${parent}\nauthor Test <test@example.invalid> 1700000000 +0000\ncommitter Test <test@example.invalid> 1700000000 +0000\n\nfeat: unusual\n\nbefore\0after\n`;
    const oid = execFileSync(
      'git',
      ['-C', f.repo, 'hash-object', '--literally', '-t', 'commit', '-w', '--stdin'],
      { input: raw, encoding: 'utf8', windowsHide: true },
    ).trim();
    const repo = new GitRepo(f.repo);
    repo.prefetch([oid, parent]);
    const expected = f
      .git('show', '-s', '--format=%H%x00%P%x00%ct%x00%B', oid)
      .split('\0')
      .slice(3)
      .join('\0')
      .trimEnd();
    assert.equal(repo.commit(oid, false).message, expected);
    assert.equal(repo.commit(parent, false).message, 'feat: root');
  } finally {
    f.clean();
  }
});
