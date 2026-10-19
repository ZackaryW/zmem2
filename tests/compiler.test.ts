import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Compiler, publicEntry } from '../src/core/compiler.js';
import { GitRepo } from '../src/core/git.js';
import { StateMap } from '../src/core/state-map.js';
import { type Entry } from '../src/core/contracts.js';
import { surface } from '../src/ext/tseam/loader.js';
import { fixture, extension } from './fixtures.js';

test('compiler materializes closed operations and rolls back an invalid compound annotation', async () => {
  const f = fixture();
  try {
    const a = f.commit('feat: choose\n\nzmem(DECISION): first');
    extension(f.repo, {
      id: 'compound',
      version: '1',
      types: {
        RISK: { kind: 'entry', default_score: 0.7 },
        BAD: {
          kind: 'operation',
          operations: [
            { function: 'entry', type: 'RISK', content: '$annotation.content' },
            { function: 'cancel', target: { sha: a, index: 99 } },
          ],
        },
      },
    });
    const b = f.commit(
      `feat: derive\n\nzmem(DECAY)[${a}, 1, 0.5]\nzmem(RISK): useful\nzmem(BAD): rolled back`,
    );
    const repo = new GitRepo(f.repo);
    const selected = surface(
      f.repo,
      f.home,
      { extensions: [{ path: 'extensions/example' }] },
      false,
    );
    await selected.load();
    const state = new StateMap(null, () => {
      throw Error('absent page');
    });
    const compiler = new Compiler(repo, state, selected);
    for (const commit of repo.select('HEAD', -1, -1).commits)
      await compiler.commit(repo.commit(commit.oid));
    const entries = [...state.entries('entry:')].map(([, value]) => publicEntry(value as Entry));
    assert.equal(entries.length, 2);
    assert.equal(entries.find((entry) => entry.sha === a)?.score, 0.5);
    assert.equal(entries.find((entry) => entry.sha === b)?.score, 0.7);
    assert.equal(
      entries.some((entry) => entry.content === 'rolled back'),
      false,
    );
    assert.equal([...state.entries('diagnostic:')].length, 1);
    const expansions = compiler.expansions;
    const root = state.root;
    assert.equal(state.get<Entry>(`entry:${a}:1`)?.score, 0.5);
    assert.equal(state.root, root);
    assert.equal(compiler.expansions, expansions);
  } finally {
    f.clean();
  }
});

test('ambient or dynamic dependencies are not eligible for sharing', () => {
  const f = fixture();
  try {
    extension(
      f.repo,
      {
        id: 'ambient',
        version: '1.0.0',
        entry: 'extension.mjs',
        deterministic: true,
        types: { RISK: { kind: 'entry', handler: 'risk' } },
      },
      `export function register(r){ const variable=process.env.VALUE; r.extend('RISK',{expand(c){c.addEntry({type:'RISK',content:variable});}});}`,
    );
    const s = surface(f.repo, f.home, { extensions: [{ path: 'extensions/example' }] }, true);
    assert.equal(s.shareable, false);
  } finally {
    f.clean();
  }
});
