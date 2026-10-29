import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const fullSha = /^[a-f0-9]{40}$/;

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    maxBuffer: 128 * 1024 * 1024,
    timeout: 180000,
    stdio: 'pipe',
    ...options,
  });
}

export function identifySource(repo, sourceSha, defaultRef) {
  if (!fullSha.test(sourceSha)) throw new Error('source_sha must be a full lowercase commit SHA');
  const git = (...args) => run('git', ['-C', repo, ...args]);
  const resolved = git('rev-parse', '--verify', `${sourceSha}^{commit}`).toString().trim();
  if (resolved !== sourceSha) throw new Error('Source does not identify the requested commit');
  git('merge-base', '--is-ancestor', sourceSha, defaultRef);
  const metadata = (name) => JSON.parse(git('show', `${sourceSha}:${name}`).toString());
  const pkg = metadata('package.json');
  const lock = metadata('package-lock.json');
  if (
    pkg.name !== 'zmem2' ||
    lock.name !== pkg.name ||
    lock.packages?.['']?.name !== pkg.name ||
    !stableVersion.test(pkg.version) ||
    lock.version !== pkg.version ||
    lock.packages?.['']?.version !== pkg.version
  )
    throw new Error('Package and lockfile must agree on the zmem2 stable version');
  for (const path of ['tsconfig.json', 'src/cli/main.ts'])
    git('cat-file', '-e', `${sourceSha}:${path}`);
  return {
    schema: 1,
    name: pkg.name,
    version: pkg.version,
    tag: `v${pkg.version}`,
    sourceSha,
    archive: `zmem2-${pkg.version}-source.tar.gz`,
  };
}

export function prepare({ repo, sourceSha, defaultRef, out }) {
  const identity = identifySource(repo, sourceSha, defaultRef);
  const tar = run('git', [
    '-C',
    repo,
    'archive',
    '--format=tar',
    `--prefix=zmem2-${identity.version}/`,
    sourceSha,
  ]);
  const archive = gzipSync(tar, { level: 9 });
  const manifest = { ...identity, archiveSha256: sha256(archive) };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, manifest.archive), archive);
  writeFileSync(join(out, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const sums = [manifest.archive, 'release.json']
    .map((name) => `${sha256(readFileSync(join(out, name)))}  ${name}\n`)
    .join('');
  writeFileSync(join(out, 'SHA256SUMS'), sums);
  return verifyAssets(out, { sourceSha, version: manifest.version });
}

export function verifyAssets(dir, { sourceSha, version, archiveSha256 } = {}) {
  const names = readdirSync(dir).sort();
  for (const name of names) {
    if (!lstatSync(join(dir, name)).isFile()) throw new Error('Assets must be regular files');
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
  if (
    manifest.schema !== 1 ||
    manifest.name !== 'zmem2' ||
    !stableVersion.test(manifest.version) ||
    !fullSha.test(manifest.sourceSha) ||
    manifest.tag !== `v${manifest.version}` ||
    manifest.archive !== `zmem2-${manifest.version}-source.tar.gz` ||
    !/^[a-f0-9]{64}$/.test(manifest.archiveSha256) ||
    (sourceSha !== undefined && manifest.sourceSha !== sourceSha) ||
    (version !== undefined && manifest.version !== version) ||
    (archiveSha256 !== undefined && manifest.archiveSha256 !== archiveSha256)
  )
    throw new Error('Invalid release manifest or unexpected release identity');
  const expected = [manifest.archive, 'release.json', 'SHA256SUMS'].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected))
    throw new Error('Unexpected release asset set');
  const archiveHash = sha256(readFileSync(join(dir, manifest.archive)));
  const sums = [manifest.archive, 'release.json']
    .map((name) => `${sha256(readFileSync(join(dir, name)))}  ${name}\n`)
    .join('');
  if (
    archiveHash !== manifest.archiveSha256 ||
    readFileSync(join(dir, 'SHA256SUMS'), 'utf8') !== sums
  ) {
    throw new Error('Release checksum verification failed');
  }
  return manifest;
}

export function releaseSummary(manifest, repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  return [
    `zmem2 ${manifest.version}`,
    `Tag: ${manifest.tag}`,
    `Source commit: ${manifest.sourceSha}`,
    `Source: https://github.com/${repository}/releases/download/${manifest.tag}/${manifest.archive}`,
    `SHA-256: ${manifest.archiveSha256}`,
  ].join('\n');
}

export function assertPublicationRef(ref, defaultBranch) {
  if (!defaultBranch || ref !== `refs/heads/${defaultBranch}`) {
    throw new Error('Publication requires the default-branch workflow ref');
  }
}

export function requireOutsideRepo(repo, out) {
  const root = resolve(repo);
  const target = resolve(out);
  if (target === root || target.startsWith(`${root}/`)) {
    throw new Error('Release output must be outside the source checkout');
  }
}
