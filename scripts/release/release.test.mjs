import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import {
  assertPublicationRef,
  identifySource,
  prepare,
  run,
  sha256,
  verifyAssets,
} from './artifacts.mjs';
import { consume, verifyCliVersion } from './consumer.mjs';
import { publish } from './publish.mjs';
import { GitHubApi } from './github.mjs';

function fixture(
  t,
  { version = '0.1.1', lockVersion = version, cliVersion = version, incomplete = false } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'zmem-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src', 'cli'), { recursive: true });
  const git = (...args) =>
    run('git', ['-C', repo, ...args])
      .toString()
      .trim();
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  const cli = `#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('--version')) console.log(JSON.stringify({product:'zmem',version:${JSON.stringify(cliVersion)}}));
else if(args.includes('--help')) console.log('zmem <command>');
else if(args.includes('recall')) console.log(JSON.stringify({results:[execFileSync('git',['-C',args[args.indexOf('--repo')+1],'log','--format=%B'],{encoding:'utf8'})]}));
else console.log('{}');
`;
  const build = `import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('dist/src/cli',{recursive:true});writeFileSync('dist/src/cli/main.js',${JSON.stringify(cli)});`;
  writeFileSync(join(repo, 'build.mjs'), build);
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({
      name: 'zmem2',
      version,
      type: 'module',
      files: ['dist/src'],
      bin: { zmem: 'dist/src/cli/main.js' },
      scripts: { build: 'node build.mjs' },
    }),
  );
  writeFileSync(
    join(repo, 'package-lock.json'),
    JSON.stringify({
      name: 'zmem2',
      version: lockVersion,
      lockfileVersion: 3,
      packages: { '': { name: 'zmem2', version: lockVersion } },
    }),
  );
  writeFileSync(join(repo, 'tsconfig.json'), '{}');
  writeFileSync(join(repo, 'src', 'cli', 'main.ts'), '// source');
  if (incomplete) writeFileSync(join(repo, '.gitattributes'), 'tsconfig.json export-ignore\n');
  git('add', '.');
  git('commit', '-m', 'test: source');
  const sourceSha = git('rev-parse', 'HEAD');
  const out = join(root, 'assets');
  const make = () => prepare({ repo, sourceSha, defaultRef: 'main', out });
  return { repo, sourceSha, root, out, git, make };
}

class FakeApi {
  constructor() {
    this.tag = null;
    this.release = null;
    this.bytes = new Map();
    this.calls = [];
  }
  async getTag() {
    return this.tag;
  }
  async getRelease() {
    return this.release && structuredClone(this.release);
  }
  async createTag(tag, sha) {
    this.calls.push(['tag', tag, sha]);
    this.tag = sha;
  }
  async createRelease(tag, sha, notes) {
    this.calls.push(['draft', tag, sha, notes]);
    this.release = { id: 1, tag_name: tag, draft: true, prerelease: false, assets: [] };
    return structuredClone(this.release);
  }
  async uploadAsset(_release, name, bytes) {
    this.calls.push(['upload', name]);
    if (name === this.failUpload) throw new Error('simulated upload failure');
    const id = this.bytes.size + 1;
    this.bytes.set(id, Buffer.from(bytes));
    this.release.assets.push({ id, name });
  }
  async downloadAsset(asset) {
    return this.bytes.get(asset.id);
  }
  async publishRelease() {
    this.calls.push(['publish']);
    this.release.draft = false;
  }
}

function publication(t) {
  const f = fixture(t);
  const manifest = f.make();
  const api = new FakeApi();
  const options = {
    dir: f.out,
    sourceSha: f.sourceSha,
    version: manifest.version,
    archiveSha256: manifest.archiveSha256,
    repository: 'ZackaryW/zmem2',
    api,
    enabled: true,
  };
  return { f, manifest, api, options };
}

test('identity accepts an exact eligible source and rejects invalid, absent, and ineligible SHAs', (t) => {
  const f = fixture(t);
  assert.equal(identifySource(f.repo, f.sourceSha, 'main').version, '0.1.1');
  assert.throws(() => identifySource(f.repo, 'main', 'main'), /full lowercase/);
  assert.throws(() => identifySource(f.repo, '0'.repeat(40), 'main'));
  f.git('checkout', '--orphan', 'other');
  f.git('commit', '-m', 'test: independent history');
  assert.throws(() => identifySource(f.repo, f.git('rev-parse', 'HEAD'), 'main'));
});

test('identity rejects inconsistent or non-stable versions', (t) => {
  const f = fixture(t, { lockVersion: '0.1.2' });
  assert.throws(f.make, /agree/);
  const prerelease = fixture(t, { version: '0.1.1-beta' });
  assert.throws(prerelease.make, /agree/);
});

test('archive preparation is deterministic and contains committed files only', (t) => {
  const f = fixture(t);
  const manifest = f.make();
  const before = readFileSync(join(f.out, manifest.archive));
  writeFileSync(join(f.repo, 'untracked.txt'), 'not a release input');
  writeFileSync(join(f.repo, 'src', 'cli', 'main.ts'), 'uncommitted change');
  f.make();
  assert.deepEqual(readFileSync(join(f.out, manifest.archive)), before);
  const tar = gunzipSync(before).toString();
  assert.ok(tar.includes('package-lock.json'));
  assert.ok(tar.includes('// source'));
  assert.ok(!tar.includes('untracked.txt'));
  assert.ok(!tar.includes('uncommitted change'));
});

test('verification binds source identity and rejects extra or corrupted assets', (t) => {
  const f = fixture(t);
  const manifest = f.make();
  assert.throws(() => verifyAssets(f.out, { sourceSha: 'a'.repeat(40) }), /identity/);
  writeFileSync(join(f.out, manifest.archive), 'corruption');
  assert.throws(() => verifyAssets(f.out), /checksum/);
  f.make();
  writeFileSync(
    join(f.out, 'release.json'),
    `${readFileSync(join(f.out, 'release.json'), 'utf8')} `,
  );
  assert.throws(() => verifyAssets(f.out), /checksum/);
  f.make();
  writeFileSync(join(f.out, 'unexpected'), 'extra');
  assert.throws(() => verifyAssets(f.out), /asset set/);
});

test('archive consumer installs outside the checkout and checks CLI recall', (t) => {
  const f = fixture(t);
  f.make();
  assert.equal(consume(f.out).recall, 'passed');
});

test('archive consumer rejects missing build inputs and a mismatching installed CLI', (t) => {
  const missing = fixture(t, { incomplete: true });
  missing.make();
  assert.throws(() => consume(missing.out), /missing tsconfig/);
  const wrong = fixture(t, { cliVersion: '0.1.2' });
  wrong.make();
  assert.throws(() => consume(wrong.out), /CLI version/);
  assert.throws(
    () => verifyCliVersion('{"product":"zmem","version":"9.0.0"}', '0.1.1'),
    /CLI version/,
  );
});

test('preview uses no API and publication requires the default workflow ref', async (t) => {
  const { options } = publication(t);
  assert.equal((await publish({ ...options, enabled: false, api: undefined })).state, 'preview');
  assert.doesNotThrow(() => assertPublicationRef('refs/heads/main', 'main'));
  assert.throws(() => assertPublicationRef('refs/heads/topic', 'main'), /default-branch/);
  assert.throws(
    () =>
      run(
        process.execPath,
        [new URL('./cli.mjs', import.meta.url).pathname, 'check-ref', '--default-branch', 'main'],
        { env: { ...process.env, GITHUB_REF: 'refs/heads/topic' } },
      ),
    /default-branch/,
  );
});

test('publisher rejects an artifact substitution even with internally matching checksums', async (t) => {
  const { options, f } = publication(t);
  await assert.rejects(publish({ ...options, archiveSha256: '0'.repeat(64) }), /identity/);
  assert.throws(() => verifyAssets(f.out, { archiveSha256: '0'.repeat(64) }), /identity/);
});

test('first publication verifies delivered bytes and a repeat does not write', async (t) => {
  const { options, api, f } = publication(t);
  const first = await publish(options);
  assert.equal(first.state, 'published');
  assert.equal(api.tag, f.sourceSha);
  assert.equal(api.release.assets.length, 3);
  assert.equal(api.release.draft, false);
  assert.match(first.summary, /releases\/download\/v0.1.1\/zmem2-0.1.1-source.tar.gz/);
  const calls = structuredClone(api.calls);
  assert.equal((await publish(options)).state, 'already-published');
  assert.deepEqual(api.calls, calls);
});

test('wrong-commit tags and corrupt local artifacts cause no publication writes', async (t) => {
  const { options, api, f, manifest } = publication(t);
  api.tag = 'b'.repeat(40);
  await assert.rejects(publish(options), /another commit/);
  assert.deepEqual(api.calls, []);
  api.tag = null;
  writeFileSync(join(f.out, manifest.archive), 'bad');
  await assert.rejects(publish(options), /checksum/);
  assert.deepEqual(api.calls, []);
});

test('an interrupted matching draft resumes without re-uploading existing assets', async (t) => {
  const { options, api } = publication(t);
  api.failUpload = 'release.json';
  await assert.rejects(publish(options), /upload failure/);
  assert.equal(api.release.draft, true);
  assert.equal(api.release.assets.length, 1);
  api.failUpload = undefined;
  assert.equal((await publish(options)).state, 'published');
  assert.equal(api.calls.filter(([op, name]) => op === 'upload' && name.endsWith('.gz')).length, 1);
});

test('conflicting, unexpected, or missing published assets are never overwritten', async (t) => {
  const { options, api } = publication(t);
  await publish(options);
  const calls = structuredClone(api.calls);
  api.bytes.set(api.release.assets[0].id, Buffer.from('corrupt remote'));
  await assert.rejects(publish(options), /Conflicting remote/);
  assert.deepEqual(api.calls, calls);
  api.release.assets = [];
  await assert.rejects(publish(options), /missing assets/);
  api.release.draft = true;
  api.release.assets = [{ id: 99, name: 'surprise' }];
  await assert.rejects(publish(options), /Unexpected remote/);
  assert.deepEqual(api.calls, calls);
});

test('delivery corruption or a tag race leaves the draft unpublished', async (t) => {
  const { options, api } = publication(t);
  api.downloadAsset = async () => Buffer.from('corrupt delivery');
  await assert.rejects(publish(options), /Conflicting remote/);
  assert.equal(api.release.draft, true);
  assert.ok(!api.calls.some(([op]) => op === 'publish'));
  const raced = publication(t);
  const upload = raced.api.uploadAsset.bind(raced.api);
  raced.api.uploadAsset = async (...args) => {
    await upload(...args);
    raced.api.tag = 'c'.repeat(40);
  };
  await assert.rejects(publish(raced.options), /Tag changed/);
  assert.equal(raced.api.release.draft, true);
});

test('API adapter dereferences annotated tags and only treats HTTP 404 as absent', async () => {
  const seen = [];
  const api = new GitHubApi('ZackaryW/zmem2', 'test-token', async (url, init) => {
    seen.push({ url, init });
    const body = url.includes('git/ref/')
      ? { object: { type: 'tag', sha: 'a'.repeat(40) } }
      : { object: { type: 'commit', sha: 'b'.repeat(40) } };
    return Response.json(body);
  });
  assert.equal(await api.getTag('v0.1.1'), 'b'.repeat(40));
  await api.createTag('v0.1.1', 'b'.repeat(40));
  assert.deepEqual(JSON.parse(seen.at(-1).init.body), {
    ref: 'refs/tags/v0.1.1',
    sha: 'b'.repeat(40),
  });
  api.fetch = async () => new Response('', { status: 403 });
  await assert.rejects(api.getTag('v0.1.1'), /HTTP 403/);
  api.fetch = async () => new Response('', { status: 404 });
  assert.equal(await api.getTag('v0.1.1'), null);
  assert.equal(sha256(Buffer.from('test')).length, 64);
});

test('API adapter finds drafts, paginates assets, and uploads original bytes', async () => {
  const calls = [];
  const api = new GitHubApi('ZackaryW/zmem2', 'test-token', async (url, init) => {
    calls.push({ url, init });
    if (url.includes('releases?'))
      return Response.json([{ id: 7, tag_name: 'v0.1.1', draft: true }]);
    if (url.endsWith('page=1'))
      return Response.json(Array.from({ length: 100 }, (_, id) => ({ id, name: `asset-${id}` })));
    if (url.endsWith('page=2')) return Response.json([{ id: 100, name: 'last' }]);
    if (init.method === 'POST') return Response.json({ id: 9 });
    return new Response(Buffer.from('downloaded'));
  });
  const release = await api.getRelease('v0.1.1');
  assert.equal(release.draft, true);
  assert.equal(release.assets.length, 101);
  const bytes = Buffer.from('release source');
  await api.uploadAsset(release, 'source.tar.gz', bytes);
  assert.ok(calls.at(-1).url.startsWith('https://uploads.github.com/repos/ZackaryW/zmem2/'));
  assert.deepEqual(calls.at(-1).init.body, bytes);
  assert.deepEqual(await api.downloadAsset({ id: 9 }), Buffer.from('downloaded'));
});
