import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseSummary, sha256, verifyAssets } from './artifacts.mjs';

export async function publish({
  dir,
  sourceSha,
  version,
  archiveSha256,
  repository,
  api,
  enabled = false,
}) {
  const manifest = verifyAssets(dir, { sourceSha, version, archiveSha256 });
  const summary = releaseSummary(manifest, repository);
  if (!enabled) return { state: 'preview', summary };
  if (!sourceSha || !version || !archiveSha256)
    throw new Error('Expected source SHA, version and archive checksum are required');
  const files = new Map(
    [manifest.archive, 'release.json', 'SHA256SUMS'].map((name) => [
      name,
      readFileSync(join(dir, name)),
    ]),
  );
  const verifyRemote = async (release, complete = false) => {
    if (release.tag_name !== manifest.tag || release.prerelease)
      throw new Error('Conflicting release identity');
    const names = new Set();
    for (const asset of release.assets) {
      if (!files.has(asset.name) || names.has(asset.name))
        throw new Error('Unexpected remote release asset');
      names.add(asset.name);
      if (sha256(await api.downloadAsset(asset)) !== sha256(files.get(asset.name))) {
        throw new Error(`Conflicting remote asset: ${asset.name}`);
      }
    }
    if (complete && names.size !== files.size)
      throw new Error('Published release has missing assets');
    return names;
  };
  const tagged = await api.getTag(manifest.tag);
  if (tagged && tagged !== sourceSha) throw new Error('Existing tag points to another commit');
  let release = await api.getRelease(manifest.tag);
  if (release && !tagged) throw new Error('Existing release has no matching tag');
  let existing = release ? await verifyRemote(release, !release.draft) : new Set();
  if (release && !release.draft) return { state: 'already-published', summary };
  if (!tagged) await api.createTag(manifest.tag, sourceSha);
  if (!release) release = await api.createRelease(manifest.tag, sourceSha, summary);
  for (const [name, bytes] of files) {
    if (!existing.has(name)) await api.uploadAsset(release, name, bytes);
  }
  if ((await api.getTag(manifest.tag)) !== sourceSha)
    throw new Error('Tag changed during publication');
  release = await api.getRelease(manifest.tag);
  if (!release) throw new Error('Draft disappeared during publication');
  await verifyRemote(release, true);
  if (release.draft) await api.publishRelease(release);
  return { state: 'published', summary };
}
