export class GitHubApi {
  constructor(repository, token, request = fetch) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
      throw new Error('Repository and token are required');
    this.repository = repository;
    this.token = token;
    this.fetch = request;
  }

  async request(path, { method = 'GET', body, binary = false, upload = false } = {}) {
    const base = upload ? 'https://uploads.github.com' : 'https://api.github.com';
    const response = await this.fetch(`${base}/repos/${this.repository}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(body === undefined
          ? {}
          : { 'Content-Type': upload ? 'application/octet-stream' : 'application/json' }),
      },
      ...(body === undefined ? {} : { body: upload ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      const error = new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  }

  async optional(path) {
    try {
      return await this.request(path);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async getTag(tag) {
    const ref = await this.optional(`git/ref/tags/${tag}`);
    if (!ref) return null;
    let object = ref.object;
    for (let depth = 0; object.type === 'tag' && depth < 8; depth++) {
      object = (await this.request(`git/tags/${object.sha}`)).object;
    }
    if (object.type !== 'commit') throw new Error('Tag does not resolve to a commit');
    return object.sha;
  }

  createTag(tag, sha) {
    return this.request('git/refs', { method: 'POST', body: { ref: `refs/tags/${tag}`, sha } });
  }

  async getRelease(tag) {
    // Listing with repository write access includes interrupted draft releases.
    let release;
    for (let page = 1; ; page++) {
      const releases = await this.request(`releases?per_page=100&page=${page}`);
      release = releases.find((item) => item.tag_name === tag);
      if (release || releases.length < 100) break;
    }
    if (!release) return null;
    release.assets = [];
    for (let page = 1; ; page++) {
      const assets = await this.request(`releases/${release.id}/assets?per_page=100&page=${page}`);
      release.assets.push(...assets);
      if (assets.length < 100) break;
    }
    return release;
  }

  createRelease(tag, sha, notes) {
    return this.request('releases', {
      method: 'POST',
      body: {
        tag_name: tag,
        target_commitish: sha,
        name: tag,
        body: notes,
        draft: true,
        prerelease: false,
      },
    });
  }

  uploadAsset(release, name, bytes) {
    return this.request(`releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: bytes,
      upload: true,
    });
  }

  downloadAsset(asset) {
    return this.request(`releases/assets/${asset.id}`, { binary: true });
  }
  publishRelease(release) {
    return this.request(`releases/${release.id}`, { method: 'PATCH', body: { draft: false } });
  }
}
