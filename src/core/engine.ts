import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { Catalog, type Pack, type PackRow } from './catalog.js';
import { Coordinator } from './coordinator.js';
import { configuration } from './config.js';
import { GitRepo } from './git.js';
import { StateMap } from './state-map.js';
import { Compiler, publicEntry, type Diagnostic } from './compiler.js';
import { surface } from '../ext/tseam/loader.js';
import {
  identity,
  json,
  MemoryError,
  VERSION,
  type Entry,
  type Attention,
  type Surface,
} from './contracts.js';
import { annotations } from './annotations.js';
import { createSingleFlight } from '../utils/singleflight.js';

export interface EngineOptions {
  home?: string;
  associate?: string;
  trust?: boolean;
  fault?: (stage: string) => void;
}
export interface IndexOptions {
  ref?: string;
  commitLimit?: number;
  nodeLimit?: number;
  observed?: string;
  force?: boolean;
  preview?: boolean;
}
export interface QueryOptions extends IndexOptions {
  event?: string[];
  scope?: string;
  areas?: string[];
  since?: string;
  minScore?: number;
  includeInvalid?: boolean;
  limit?: number;
}
export interface Snapshot {
  segment: Pack;
  state: StateMap;
  release(): void;
  central: string[];
}
export class MemoryEngine {
  readonly repo: GitRepo;
  readonly local: Catalog;
  readonly coordinator: Coordinator | undefined;
  readonly settings: ReturnType<typeof configuration>;
  readonly registration: { repository: string; location: string; trusted: boolean };
  readonly metrics = {
    computed_commits: 0,
    expansions: 0,
    effects: 0,
    adopted_segments: 0,
    peak_construction_bytes: 0,
  };
  private work = createSingleFlight<string, Pack>({ maxPending: 8 });
  private session = randomUUID();
  constructor(
    path = '.',
    readonly options: EngineOptions = {},
  ) {
    this.repo = new GitRepo(path);
    this.settings = configuration(this.repo.root, options.home);
    this.local = new Catalog(
      join(this.repo.root, '.zmem', 'index', `${process.platform}-${process.arch}`),
    );
    const ignored = join(this.local.directory, '.gitignore');
    if (!existsSync(ignored)) writeFileSync(ignored, '*\n');
    let coordinator: Coordinator | undefined;
    try {
      coordinator = new Coordinator(
        new Catalog(join(this.settings.home, 'v2')),
        this.settings.user,
      );
    } catch {
      /* Bounded user-catalog failure leaves local indexing available. */
    }
    let registered: MemoryEngine['registration'] | undefined;
    if (coordinator) {
      try {
        registered = coordinator.register(this.repo, options.associate, options.trust);
      } catch (error) {
        if (error instanceof MemoryError) throw error;
        coordinator = undefined;
      }
    }
    this.coordinator = coordinator;
    if (registered) this.registration = registered;
    else {
      if (options.associate)
        throw new MemoryError('unavailable', 'association requires the user registry');
      this.registration = this.local.transaction((db) => {
        const previous = db.prepare("SELECT value FROM meta WHERE key='registration'").get() as
          { value: string } | undefined;
        const registration = previous
          ? (JSON.parse(previous.value) as MemoryEngine['registration'])
          : { repository: randomUUID(), location: randomUUID(), trusted: false };
        if (options.trust !== undefined) registration.trusted = options.trust;
        db.prepare("INSERT OR REPLACE INTO meta VALUES ('registration',?)").run(json(registration));
        return registration;
      });
    }
    this.local.db((db) =>
      db
        .prepare("INSERT OR REPLACE INTO meta VALUES ('registration',?)")
        .run(json(this.registration)),
    );
  }
  private surface(): Surface {
    try {
      return surface(
        this.repo.root,
        this.settings.home,
        this.settings.repo,
        this.registration.trusted,
        this.session,
      );
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new MemoryError('missing_inputs', 'selected extension inputs are unavailable');
      throw new MemoryError('extension', String(error));
    }
  }
  /** Explicit repository setup; configuration and extension sources remain trackable. */
  async init(options: IndexOptions = {}) {
    const config = join(this.repo.root, '.zmem', 'config.yaml');
    if (!existsSync(config)) {
      try {
        writeFileSync(config, 'extensions: []\n', { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const ignore = join(this.repo.root, '.zmem', '.gitignore');
    const content = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
    if (!content.split(/\r?\n/).some((line) => ['/index/', 'index/'].includes(line.trim()))) {
      const eol = content.includes('\r\n') ? '\r\n' : '\n';
      appendFileSync(ignore, `${content && !content.endsWith('\n') ? eol : ''}/index/${eol}`);
    }
    const pack = !options.ref && this.repo.unborn() ? null : await this.sync(options);
    return {
      repository: this.registration,
      home: this.settings.home,
      segment: pack?.id ?? null,
      coverage: pack?.coverage ?? [],
      attention: pack?.attention ?? null,
      metrics: this.metrics,
    };
  }
  /** Synchronize selected history through the same computed-segment engine. */
  async sync(options: IndexOptions = {}): Promise<Pack> {
    return this.index(options);
  }
  private coverageOf(pack: Pack): string[] {
    const chunks: string[][] = [];
    const seen = new Set<string>();
    let current: Pack | undefined = pack;
    while (current) {
      if (seen.has(current.id)) throw new MemoryError('corrupt', 'cyclic coverage chain');
      seen.add(current.id);
      chunks.push(current.commits);
      const baseId: string | null = current.base;
      if (!baseId) {
        current = undefined;
        continue;
      }
      const row = this.local.row(baseId) ?? this.coordinator?.catalog.row(baseId);
      if (!row) throw new MemoryError('missing_inputs', 'coverage descriptor is unavailable');
      current = JSON.parse(row.manifest) as Pack;
    }
    return chunks.reverse().flat();
  }
  private manifest(id: string): { catalog: Catalog; pack: Pack; row: PackRow } {
    const row = this.local.row(id);
    if (row?.resident) return { catalog: this.local, pack: JSON.parse(row.manifest) as Pack, row };
    const central = this.coordinator?.catalog;
    const shared = central?.row(id);
    if (shared?.resident)
      return { catalog: central!, pack: JSON.parse(shared.manifest) as Pack, row: shared };
    throw new MemoryError('evicted', 'required segment is unavailable', { segment: id });
  }
  snapshot(id: string, demand = false): Snapshot {
    const items = new Map<string, { catalog: Catalog; pack: Pack; row: PackRow }>();
    const visit = (key: string) => {
      if (items.has(key)) return;
      const item = this.manifest(key);
      items.set(key, item);
      for (const dep of item.pack.deps) visit(dep);
    };
    visit(id);
    const local = new Set(
      [...items].filter(([, v]) => v.catalog === this.local).map(([key]) => key),
    );
    const central = new Set(
      [...items].filter(([, v]) => v.catalog !== this.local).map(([key]) => key),
    );
    const localRows = new Map(
      [...items]
        .filter(([, item]) => item.catalog === this.local)
        .map(([key, item]) => [key, item.row]),
    );
    const centralRows = new Map(
      [...items]
        .filter(([, item]) => item.catalog !== this.local)
        .map(([key, item]) => [key, item.row]),
    );
    const releaseLocal = this.local.lease([...local]);
    let releaseCentral: () => void = () => {};
    try {
      if (central.size) releaseCentral = this.coordinator!.catalog.lease([...central]);
      for (const item of items.values()) item.catalog.loadRow(item.row);
      const primary = items.get(id)!;
      const segment = primary.catalog.loadRow(primary.row);
      const state = new StateMap(segment.root, (hash) => {
        try {
          return this.local.page(hash, local, localRows);
        } catch (error) {
          if (!(error instanceof MemoryError) || error.code !== 'evicted') throw error;
        }
        if (this.coordinator) return this.coordinator.catalog.page(hash, central, centralRows);
        throw new MemoryError('evicted', 'required state page is unavailable');
      });
      if (demand && central.size) this.coordinator!.catalog.demand([...central]);
      return {
        segment,
        state,
        central: [...central],
        release() {
          releaseLocal();
          releaseCentral();
        },
      };
    } catch (error) {
      releaseLocal();
      releaseCentral();
      throw error;
    }
  }
  private request(options: IndexOptions) {
    const head = this.repo.resolve(options.ref);
    if (options.observed && options.observed !== head)
      throw new MemoryError('stale_ref', 'reference differs from observed commit');
    const selectedSurface = this.surface();
    const commitLimit = options.commitLimit ?? Number(process.env.ZMEM_COMMIT_LIMIT ?? 500),
      nodeLimit = options.nodeLimit ?? Number(process.env.ZMEM_NODE_LIMIT ?? 400);
    if ([commitLimit, nodeLimit].some((n) => !Number.isSafeInteger(n) || (n <= 0 && n !== -1)))
      throw new MemoryError('invalid_input', 'attention must be positive or -1');
    const policy = identity({ version: VERSION, commitLimit, nodeLimit });
    const key = identity({
      repository: this.registration.repository,
      head,
      surface: selectedSurface.id,
      policy,
    });
    return { head, selectedSurface, commitLimit, nodeLimit, policy, key };
  }
  async index(options: IndexOptions = {}): Promise<Pack> {
    const { head, selectedSurface, commitLimit, nodeLimit, policy, key } = this.request(options);
    return this.work.run(key, async () => {
      const known = this.local.view(key) ?? this.coordinator?.catalog.view(key);
      if (!options.force) {
        if (known)
          try {
            const snapshot = this.snapshot(known);
            try {
              if (snapshot.segment.attention.commits <= commitLimit || commitLimit === -1) {
                const ready = this.limitsSatisfied(known) ? snapshot.segment : this.compact(known);
                if (this.coordinator?.catalog.row(ready.id)?.resident) {
                  this.adopt(ready.id);
                  this.local.setView(key, ready.id);
                }
                return ready;
              }
            } finally {
              snapshot.release();
            }
          } catch (error) {
            if (!(error instanceof MemoryError) || !['evicted', 'corrupt'].includes(error.code))
              throw error;
          }
      }
      const claimKey = `index:${key}:${identity(this.settings.user.segments)}`;
      const claim = this.local.claim(claimKey);
      if (claim === 'failed')
        throw new MemoryError('failed', 'a previous indexing job failed; retry explicitly', {
          job: claimKey,
        });
      if (claim === 'busy')
        throw new MemoryError('busy', 'repository computation is already running', {
          job: claimKey,
        });
      const knownDescriptor = known
        ? (this.local.row(known) ?? this.coordinator?.catalog.row(known))
        : undefined;
      let centralClaim: string | undefined;
      if (
        knownDescriptor &&
        selectedSurface.shareable &&
        this.coordinator &&
        this.coordinator.eligible(this.repo, JSON.parse(knownDescriptor.manifest) as Pack)
      ) {
        centralClaim = `rebuild:${known}`;
        const admission = this.coordinator.catalog.claim(centralClaim);
        if (admission !== 'owned') {
          this.local.finishClaim(claimKey);
          throw new MemoryError(
            admission === 'busy' ? 'pending' : 'failed',
            'qualified shared computation is already claimed',
            { job: centralClaim },
          );
        }
      }
      let failed = false;
      try {
        if (
          known &&
          !options.force &&
          knownDescriptor &&
          knownDescriptor.size <= this.settings.user.segments.max_bytes
        ) {
          const descriptor = JSON.parse(knownDescriptor.manifest) as Pack;
          if (descriptor.commits.length <= this.settings.user.segments.max_commits) {
            const rebuilt = await this.reconstruct(known, selectedSurface, !options.preview);
            if (
              this.coordinator &&
              selectedSurface.shareable &&
              this.coordinator.eligible(this.repo, rebuilt)
            )
              this.coordinator.promote(this.repo, rebuilt, this.local, (id) =>
                this.resolvePack(id),
              );
            if (this.coordinator?.catalog.row(rebuilt.id)?.resident) this.adopt(rebuilt.id);
            this.local.setView(key, rebuilt.id);
            return rebuilt;
          }
        }
        const selection = this.repo.select(options.ref ?? 'HEAD', commitLimit, nodeLimit, head);
        const coverage = selection.commits.map((c) => c.oid);
        let base: Pack | undefined;
        let snapshot: Snapshot | undefined;
        if (!options.force) {
          const candidates = [
            ...this.local.candidates(
              this.registration.repository,
              selectedSurface.id,
              coverage.length,
              policy,
            ),
            ...(this.coordinator?.catalog.candidates(
              this.registration.repository,
              selectedSurface.id,
              coverage.length,
              policy,
            ) ?? []),
          ]
            .filter((p) => this.coverageOf(p).every((oid, i) => coverage[i] === oid))
            .sort((a, b) => b.attention.commits - a.attention.commits);
          for (const candidate of candidates)
            try {
              snapshot = this.snapshot(candidate.id);
              base = snapshot.segment;
              if (!this.limitsSatisfied(base.id)) {
                const replacement = this.compact(base.id);
                snapshot.release();
                snapshot = this.snapshot(replacement.id);
                base = replacement;
              }
              break;
            } catch (error) {
              snapshot?.release();
              snapshot = undefined;
              if (!(error instanceof MemoryError) || !['evicted', 'corrupt'].includes(error.code))
                throw error;
            }
          // Different numeric limits can select precisely the same complete history.
          // Publish a new attention identity referencing the already-computed state.
          if (!base) {
            const equivalent = [
              ...this.local.candidates(
                this.registration.repository,
                selectedSurface.id,
                coverage.length,
              ),
              ...(this.coordinator?.catalog.candidates(
                this.registration.repository,
                selectedSurface.id,
                coverage.length,
              ) ?? []),
            ].find(
              (p) =>
                p.attention.commits === coverage.length &&
                this.coverageOf(p).every((oid, i) => coverage[i] === oid) &&
                p.attention.truncated === selection.attention.truncated,
            );
            if (equivalent)
              try {
                const source = this.snapshot(equivalent.id);
                try {
                  const alias: Pack = {
                    ...source.segment,
                    id: identity({
                      source: source.segment.id,
                      policy,
                      attention: selection.attention,
                    }),
                    policy,
                    attention: selection.attention,
                    coverage: [],
                    commits: [],
                    checkpoints: [],
                    base: source.segment.id,
                    deps: [source.segment.id],
                    pages: {},
                  };
                  this.local.publish(alias, this.settings.user.segments.max_bytes);
                  this.local.setView(key, alias.id);
                  return alias;
                } finally {
                  source.release();
                }
              } catch (error) {
                if (!(error instanceof MemoryError) || !['evicted', 'corrupt'].includes(error.code))
                  throw error;
              }
          }
        }
        try {
          if (base && this.coordinator?.catalog.row(base.id)?.resident) this.adopt(base.id);
          if (base?.attention.commits === coverage.length) {
            this.local.setView(key, base.id);
            if (this.coordinator?.catalog.row(base.id)?.resident) this.adopt(base.id);
            return base;
          }
          await selectedSurface.load();
          const state =
            snapshot?.state ??
            new StateMap(null, () => {
              throw new MemoryError('evicted', 'missing base page');
            });
          state.limit(this.settings.user.segments.max_bytes * 4);
          const compiler = new Compiler(
            this.repo,
            state,
            selectedSurface,
            undefined,
            selection.attention.truncated,
          );
          let chunk: string[] = [];
          let prefix = base ? this.coverageOf(base) : [];
          let previous = base;
          let frontier = new Set(base?.frontier ?? []);
          let checkpoints: NonNullable<Pack['checkpoints']> = [];
          let nodes = base?.attention.nodes ?? 0;
          const makePack = (): Pack => {
            const all = [...prefix, ...chunk];
            const content = {
              version: VERSION,
              repository: this.registration.repository,
              surface: selectedSurface.id,
              policy,
              base: previous?.id ?? null,
              root: state.root,
              coverage: [...chunk],
              commits: [...chunk],
              deps: previous ? [previous.id] : [],
              frontier: [...frontier].sort(),
              attention: { ...selection.attention, commits: all.length, nodes },
              head: all.at(-1) ?? selection.head,
              checkpoints: [...checkpoints],
            };
            return { ...content, id: identity(content), pages: state.owned() };
          };
          const publish = async () => {
            if (!chunk.length) return;
            const pack = makePack();
            this.local.publish(pack, this.settings.user.segments.max_bytes, this.options.fault);
            if (!options.preview && this.coordinator) {
              try {
                this.coordinator.observe(
                  pack,
                  this.registration.location,
                  `${Date.now()}:${randomUUID()}`,
                );
                if (selectedSurface.shareable && this.coordinator.eligible(this.repo, pack)) {
                  this.coordinator.promote(this.repo, pack, this.local, (id) =>
                    this.resolvePack(id),
                  );
                }
              } catch (error) {
                if (!(error instanceof MemoryError) && !(error instanceof Error)) throw error;
              }
            }
            if (!options.preview && selectedSurface.hooks.size) {
              const ledger = this.coordinator?.catalog ?? this.local;
              // Delivery identity follows source commits and hook code, not a
              // cache partition, session nonce, or repacking generation.
              for (const [name, hook] of selectedSurface.hooks)
                for (const oid of pack.commits)
                  await ledger.hook(`${pack.repository}:${name}:${oid}`, () =>
                    hook(
                      Object.freeze({ segment: pack.id, repository: pack.repository, head: oid }),
                    ),
                  );
            }
            previous = pack;
            prefix.push(...chunk);
            chunk = [];
            checkpoints = [];
            state.clearPending();
          };
          // New pages become readable after every publication without an overlay-chain walk.
          state.addReader((hash) => this.local.page(hash));
          for (const header of selection.commits.slice(prefix.length)) {
            if (chunk.length >= this.settings.user.segments.max_commits) await publish();
            const commit = this.repo.commit(header.oid);
            let checkpoint = state.checkpoint();
            const priorFrontier = new Set(frontier);
            const count = annotations(commit.message).filter((a) => !a.error).length;
            try {
              await compiler.commit(commit);
            } catch (error) {
              if (
                !(error instanceof MemoryError) ||
                error.code !== 'segment_too_large' ||
                !chunk.length
              )
                throw error;
              state.restore(checkpoint);
              await publish();
              checkpoint = state.checkpoint();
              await compiler.commit(commit);
            }
            chunk.push(commit.oid);
            nodes += count;
            commit.parents.forEach((p) => frontier.delete(p));
            frontier.add(commit.oid);
            checkpoints.push({ oid: commit.oid, root: state.root, nodes });
            state.retain(state.root);
            if (Buffer.byteLength(json(makePack())) > this.settings.user.segments.max_bytes) {
              state.restore(checkpoint);
              frontier = new Set(priorFrontier);
              chunk.pop();
              nodes -= count;
              checkpoints.pop();
              if (chunk.length) await publish();
              await compiler.commit(commit);
              chunk.push(commit.oid);
              nodes += count;
              commit.parents.forEach((p) => frontier.delete(p));
              frontier.add(commit.oid);
              checkpoints.push({ oid: commit.oid, root: state.root, nodes });
              state.retain(state.root);
              if (Buffer.byteLength(json(makePack())) > this.settings.user.segments.max_bytes)
                throw new MemoryError(
                  'segment_too_large',
                  'single commit result exceeds configured limit',
                  { commit: commit.oid, limit: this.settings.user.segments.max_bytes },
                );
            }
            state.prune();
            this.metrics.computed_commits++;
          }
          await publish();
          this.metrics.expansions += compiler.expansions;
          this.metrics.effects += compiler.effects;
          this.metrics.peak_construction_bytes = Math.max(
            this.metrics.peak_construction_bytes,
            state.peakPendingBytes,
          );
          if (!previous) {
            const empty = makePack();
            this.local.publish(empty, this.settings.user.segments.max_bytes);
            previous = empty;
          }
          if (this.repo.resolve(options.ref) !== head)
            throw new MemoryError('stale_ref', 'reference moved before publication');
          this.local.setView(key, previous.id);
          if (this.coordinator?.catalog.row(previous.id)?.resident) {
            this.coordinator.catalog.setView(key, previous.id);
            this.adopt(previous.id);
          }
          return previous;
        } finally {
          snapshot?.release();
        }
      } catch (error) {
        failed = true;
        this.local.finishClaim(claimKey, String(error));
        if (centralClaim) this.coordinator!.catalog.finishClaim(centralClaim, String(error));
        throw error;
      } finally {
        if (!failed) {
          this.local.finishClaim(claimKey);
          if (centralClaim) this.coordinator!.catalog.finishClaim(centralClaim);
        }
      }
    });
  }
  private resolvePack(id: string): Pack {
    const item = this.manifest(id);
    return item.catalog.load(id);
  }
  /** Repartition sealed checkpoints by copying calculated pages, never handlers. */
  compact(id: string): Pack {
    const source = this.snapshot(id);
    const bounds = this.settings.user.segments;
    const rewritten = new Map<string, Pack>();
    const knownPages = new Set<string>();
    try {
      const visit = (old: Pack): Pack => {
        const existing = rewritten.get(old.id);
        if (existing) return existing;
        let previous: Pack | undefined;
        for (const dep of old.deps) previous = visit(this.resolvePack(dep));
        const checkpoints = old.checkpoints ?? [];
        if (old.commits.length && !checkpoints.length)
          throw new MemoryError(
            'incompatible',
            'segment has no computed checkpoints for repartitioning',
          );
        let chunk: NonNullable<Pack['checkpoints']> = [],
          pages: Pack['pages'] = {};
        let covered = previous?.attention.commits ?? 0;
        let frontier = new Set(previous?.frontier ?? []);
        const collect = (root: string | null, target: Pack['pages']) => {
          if (!root || knownPages.has(root) || target[root]) return;
          const page = source.state.page(root);
          target[root] = page;
          if ('branches' in page)
            for (const child of Object.values(page.branches)) collect(child, target);
          if ('namespaces' in page)
            for (const child of Object.values(page.namespaces)) collect(child, target);
        };
        const make = (): Pack => {
          const root = chunk.at(-1)?.root ?? old.root;
          const cp = [...chunk];
          const commits = cp.map((p) => p.oid);
          const coverage = [...commits];
          const content = {
            version: VERSION,
            repository: old.repository,
            surface: old.surface,
            policy: old.policy,
            base: previous?.id ?? null,
            root,
            coverage,
            commits,
            deps: previous ? [previous.id] : [],
            frontier: [...frontier].sort(),
            attention: {
              ...old.attention,
              commits: covered + commits.length,
              nodes: chunk.at(-1)?.nodes ?? old.attention.nodes,
            },
            head: commits.at(-1) ?? old.head,
            checkpoints: cp,
          };
          return { ...content, id: identity({ repartitioned_from: old.id, ...content }), pages };
        };
        const flush = () => {
          const pack = make();
          this.local.publish(pack, bounds.max_bytes);
          previous = pack;
          covered = pack.attention.commits;
          for (const hash of Object.keys(pages)) knownPages.add(hash);
          chunk = [];
          pages = {};
        };
        if (!checkpoints.length) {
          collect(old.root, pages);
          flush();
        } else
          for (const checkpoint of checkpoints) {
            const beforePages = { ...pages };
            const before = [...chunk];
            const priorFrontier = new Set(frontier);
            const parents =
              source.state.get<{ parents: string[] }>(`commit:${checkpoint.oid}`)?.parents ?? [];
            parents.forEach((p) => frontier.delete(p));
            frontier.add(checkpoint.oid);
            collect(checkpoint.root, pages);
            chunk.push(checkpoint);
            if (
              chunk.length > bounds.max_commits ||
              Buffer.byteLength(json(make())) > bounds.max_bytes
            ) {
              pages = beforePages;
              chunk = before;
              frontier = priorFrontier;
              if (chunk.length) flush();
              collect(checkpoint.root, pages);
              chunk.push(checkpoint);
              parents.forEach((p) => frontier.delete(p));
              frontier.add(checkpoint.oid);
              if (Buffer.byteLength(json(make())) > bounds.max_bytes)
                throw new MemoryError(
                  'segment_too_large',
                  'one computed checkpoint cannot fit configured size',
                  { commit: checkpoint.oid, limit: bounds.max_bytes },
                );
            }
            if (chunk.length === bounds.max_commits) flush();
          }
        if (chunk.length) flush();
        if (!previous) throw new MemoryError('corrupt', 'missing compacted result');
        rewritten.set(old.id, previous);
        return previous;
      };
      const result = visit(source.segment);
      this.local.db((db) => {
        for (const [old, replacement] of rewritten)
          db.prepare('UPDATE views SET segment=? WHERE segment=?').run(replacement.id, old);
      });
      return result;
    } finally {
      source.release();
    }
  }
  private limitsSatisfied(id: string): boolean {
    const seen = new Set<string>();
    const visit = (key: string): boolean => {
      if (seen.has(key)) return true;
      seen.add(key);
      const { catalog, pack } = this.manifest(key);
      const row = catalog.row(key)!;
      return (
        row.size <= this.settings.user.segments.max_bytes &&
        pack.commits.length <= this.settings.user.segments.max_commits &&
        pack.deps.every(visit)
      );
    };
    return visit(id);
  }
  /** Recreate the recorded boundaries/base instead of choosing a different recipe. */
  private async reconstruct(
    id: string,
    selectedSurface: Surface,
    record = true,
    seen = new Set<string>(),
  ): Promise<Pack> {
    try {
      const available = this.snapshot(id);
      try {
        return available.segment;
      } finally {
        available.release();
      }
    } catch (error) {
      if (!(error instanceof MemoryError) || !['evicted', 'corrupt'].includes(error.code))
        throw error;
    }
    if (seen.has(id)) throw new MemoryError('corrupt', 'cyclic reconstruction dependencies');
    seen.add(id);
    const row = this.local.row(id) ?? this.coordinator?.catalog.row(id);
    if (!row)
      throw new MemoryError('missing_inputs', 'reconstruction descriptor is unavailable', {
        segment: id,
      });
    const descriptor = JSON.parse(row.manifest) as Pack;
    if (descriptor.surface !== selectedSurface.id)
      throw new MemoryError('missing_inputs', 'required extension generation is unavailable');
    if (
      row.size > this.settings.user.segments.max_bytes ||
      descriptor.commits.length > this.settings.user.segments.max_commits
    )
      throw new MemoryError(
        'segment_too_large',
        'reconstruction needs repartitioning under new limits',
      );
    for (const dep of descriptor.deps) await this.reconstruct(dep, selectedSurface, record, seen);
    const base = descriptor.base ? this.snapshot(descriptor.base) : undefined;
    try {
      await selectedSurface.load();
      const state =
        base?.state ??
        new StateMap(null, () => {
          throw new MemoryError('missing_inputs', 'missing reconstruction page');
        });
      state.addReader((hash) => this.local.page(hash));
      state.limit(this.settings.user.segments.max_bytes * 4);
      const compiler = new Compiler(
        this.repo,
        state,
        selectedSurface,
        undefined,
        descriptor.attention.truncated,
      );
      for (const oid of descriptor.commits) {
        let commit;
        try {
          commit = this.repo.commit(oid);
        } catch {
          throw new MemoryError('missing_inputs', 'required Git commit is unavailable', {
            commit: oid,
          });
        }
        await compiler.commit(commit);
        state.retain(state.root);
        state.prune();
        this.metrics.computed_commits++;
      }
      if (state.root !== descriptor.root)
        throw new MemoryError('incompatible', 'reconstruction did not reproduce recorded state');
      const pack = { ...descriptor, pages: state.owned() };
      this.local.publish(pack, this.settings.user.segments.max_bytes);
      this.metrics.expansions += compiler.expansions;
      this.metrics.effects += compiler.effects;
      if (record && descriptor.commits.length && this.coordinator)
        try {
          this.coordinator.observe(
            pack,
            this.registration.location,
            `${Date.now()}:${randomUUID()}`,
          );
        } catch {
          /* A failed coordinator receipt cannot invalidate a completed local result. */
        }
      // Reconstruction deliberately dispatches no historical hooks.
      return pack;
    } finally {
      base?.release();
      seen.delete(id);
    }
  }
  adopt(id: string) {
    const central = this.coordinator?.catalog;
    if (!central) return;
    const existing = this.local.row(id);
    if (existing?.pointer && central.row(id)?.payload === existing.payload) return;
    const packs: Pack[] = [];
    const seen = new Set<string>();
    const visit = (key: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      const pack = central.load(key);
      for (const dep of pack.deps) visit(dep);
      packs.push(pack);
    };
    visit(id);
    const release = central.lease([...seen]);
    try {
      for (const pack of packs)
        if (this.local.point(pack, central, this.options.fault)) this.metrics.adopted_segments++;
    } finally {
      release();
    }
  }
  async read(options: IndexOptions = {}): Promise<Snapshot> {
    if (!options.force) {
      const { key } = this.request(options);
      const known = this.local.view(key) ?? this.coordinator?.catalog.view(key);
      if (known)
        try {
          const ready = this.limitsSatisfied(known) ? known : this.compact(known).id;
          if (this.coordinator?.catalog.row(ready)?.resident) this.adopt(ready);
          const snapshot = this.snapshot(ready, !options.preview);
          this.local.setView(key, ready);
          return snapshot;
        } catch (error) {
          if (!(error instanceof MemoryError) || !['evicted', 'corrupt'].includes(error.code))
            throw error;
        }
    }
    const pack = await this.index(options);
    try {
      return this.snapshot(pack.id, !options.preview);
    } catch (error) {
      if (error instanceof MemoryError && ['evicted', 'corrupt'].includes(error.code)) {
        const rebuilt = await this.index(options);
        return this.snapshot(rebuilt.id, !options.preview);
      }
      throw error;
    }
  }
  async recall(options: QueryOptions = {}) {
    this.validateQuery(options);
    const snapshot = await this.read(options);
    try {
      let entries = [...snapshot.state.entries('entry:')].map(([, v]) => publicEntry(v as Entry));
      entries = entries.filter(
        (e) =>
          (options.includeInvalid || e.valid) &&
          (!options.event?.length || options.event.includes(e.type)) &&
          (!options.scope || e.scope === options.scope) &&
          e.score >= (options.minScore ?? 0),
      );
      if (options.areas?.length)
        entries = entries.filter(
          (e) =>
            e.affected_areas === null ||
            options.areas!.some((a) =>
              e.affected_areas!.some(
                (b) =>
                  a === b ||
                  (a !== '<root>' &&
                    b !== '<root>' &&
                    (a.startsWith(`${b}/`) || b.startsWith(`${a}/`))),
              ),
            ),
        );
      if (options.since) {
        const date = Date.parse(options.since);
        if (Number.isNaN(date)) {
          const since = this.repo.resolve(options.since);
          entries = entries.filter((e) => e.sha !== since && this.repo.ancestor(since, e.sha));
        } else entries = entries.filter((e) => e.commit_time >= date / 1000);
      }
      entries.sort((a, b) => b.commit_time - a.commit_time || (a.id < b.id ? -1 : 1));
      const limit = options.limit ?? entries.length;
      if (!Number.isSafeInteger(limit) || limit < 0)
        throw new MemoryError('invalid_input', 'limit must be nonnegative');
      const diagnostics = [...snapshot.state.entries('diagnostic:')].map(
        ([, v]) => v as Diagnostic,
      );
      return {
        command: 'recall',
        count: Math.min(limit, entries.length),
        results: entries.slice(0, limit),
        truncated: entries.length > limit,
        attention: snapshot.segment.attention,
        diagnostics,
        trail: {
          id: snapshot.segment.id,
          head: snapshot.segment.head,
          surface: snapshot.segment.surface,
        },
      };
    } finally {
      snapshot.release();
    }
  }
  private validateQuery(options: QueryOptions) {
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 0))
      throw new MemoryError('invalid_input', 'limit must be a nonnegative integer');
    if (
      options.minScore !== undefined &&
      (!Number.isFinite(options.minScore) || options.minScore < 0 || options.minScore > 1)
    )
      throw new MemoryError('invalid_input', 'minScore must be between zero and one');
  }
  async search(query: string, options: QueryOptions = {}) {
    this.validateQuery(options);
    const result = await this.recall({ ...options, limit: undefined });
    const matches = result.results.filter((e) =>
      e.content.toLowerCase().includes(query.toLowerCase()),
    );
    const limit = options.limit ?? matches.length;
    return {
      ...result,
      command: 'search',
      count: Math.min(matches.length, limit),
      results: matches.slice(0, limit),
      truncated: matches.length > limit,
    };
  }
  async links(options: QueryOptions = {}) {
    this.validateQuery(options);
    const snapshot = await this.read(options);
    try {
      const all = [...snapshot.state.entries('relationship:')]
        .map(([, v]) => v as { score: number })
        .filter((v) => v.score >= (options.minScore ?? 0));
      const results = all.slice(0, options.limit ?? all.length);
      return {
        command: 'links',
        count: results.length,
        results,
        truncated: results.length < all.length,
        attention: snapshot.segment.attention,
      };
    } finally {
      snapshot.release();
    }
  }
  async show(ref: string, options: QueryOptions = {}) {
    const commit = this.repo.commit(this.repo.resolve(ref));
    const results = await this.recall({ ...options, includeInvalid: true });
    return {
      command: 'show',
      commit,
      annotations: annotations(commit.message),
      results: results.results.filter((e) => e.sha === commit.oid),
      attention: results.attention,
    };
  }
  async check(
    message: string,
    options: IndexOptions & {
      deep?: boolean;
      requireAnnotation?: boolean;
      conventional?: boolean;
      maxSubjectLength?: number;
    } = {},
  ) {
    const selectedSurface = this.surface();
    await selectedSurface.load();
    const proposed = annotations(message);
    const nodeLimit = options.nodeLimit ?? Number(process.env.ZMEM_NODE_LIMIT ?? 400);
    const commitLimit = options.commitLimit ?? Number(process.env.ZMEM_COMMIT_LIMIT ?? 500);
    if ([commitLimit, nodeLimit].some((n) => !Number.isSafeInteger(n) || (n <= 0 && n !== -1)))
      throw new MemoryError('invalid_input', 'attention must be positive or -1');
    if (
      options.maxSubjectLength !== undefined &&
      (!Number.isSafeInteger(options.maxSubjectLength) || options.maxSubjectLength <= 0)
    )
      throw new MemoryError('invalid_input', 'maxSubjectLength must be positive');
    const reserved = proposed.filter((a) => !a.error).length;
    if (nodeLimit !== -1 && reserved > nodeLimit)
      throw new MemoryError('validation', 'proposal exceeds node attention');
    const remaining = nodeLimit === -1 ? -1 : nodeLimit - reserved;
    let snapshot: Snapshot | undefined;
    let state: StateMap;
    if (options.deep || remaining === 0) {
      state = new StateMap(null, () => {
        throw new MemoryError('evicted', 'audit has no persistent base');
      });
    } else {
      snapshot = await this.read({ ...options, commitLimit, nodeLimit: remaining, preview: true });
      state = snapshot.state;
    }
    try {
      const parent = snapshot?.segment.head ?? this.repo.resolve(options.ref);
      const oid = identity({ parent, message, preview: true }).slice(0, parent.length);
      let attention: Attention = snapshot?.segment.attention ?? {
        commit_limit: commitLimit,
        node_limit: nodeLimit,
        commits: 0,
        nodes: 0,
        truncated: remaining === 0,
        reached: remaining === 0 ? ['nodes'] : [],
      };
      const selection =
        options.deep && remaining !== 0
          ? this.repo.select(options.ref ?? 'HEAD', commitLimit, remaining, parent)
          : undefined;
      if (selection) attention = selection.attention;
      const compiler = new Compiler(
        this.repo,
        state,
        selectedSurface,
        { oid, parent },
        attention.truncated,
      );
      for (const header of selection?.commits ?? [])
        await compiler.commit(this.repo.commit(header.oid));
      const priorDiagnostics = new Set([...state.entries('diagnostic:')].map(([k]) => k));
      const effects = await compiler.commit({
        oid,
        parents: [parent],
        time: Math.floor(Date.now() / 1000),
        message,
        paths: [],
        scope: message.split('\n')[0]?.match(/^\w+\(([^)]+)\):/)?.[1] ?? null,
      });
      const diagnostics = [...state.entries('diagnostic:')]
        .filter(([k]) => !priorDiagnostics.has(k))
        .map(([, v]) => v as Diagnostic);
      if (options.requireAnnotation && !proposed.length)
        diagnostics.push({
          id: 'policy',
          sha: oid,
          index: 0,
          code: 'policy',
          message: 'annotation required',
        });
      if (!message.trim() || (options.conventional && !/^\w+(?:\([^)]+\))?!?: .+/.test(message)))
        diagnostics.push({
          id: 'subject',
          sha: oid,
          index: 0,
          code: 'policy',
          message: 'invalid commit subject',
        });
      if (
        options.maxSubjectLength &&
        (message.split('\n')[0]?.length ?? 0) > options.maxSubjectLength
      )
        diagnostics.push({
          id: 'length',
          sha: oid,
          index: 0,
          code: 'policy',
          message: 'subject is too long',
        });
      return {
        command: 'check',
        ok: diagnostics.length === 0,
        parent,
        mode: options.deep ? 'deep' : 'computed',
        hooks: 'skipped',
        annotation_count: proposed.length,
        attention: { ...attention, node_limit: nodeLimit, nodes: attention.nodes + reserved },
        effects,
        diagnostics,
        entries: [...state.entries('entry:')]
          .map(([, v]) => publicEntry(v as Entry))
          .filter((e) => e.sha === oid),
      };
    } finally {
      snapshot?.release();
    }
  }
  status() {
    const central = this.coordinator?.catalog;
    const bytes = central?.bytes();
    return {
      repository: this.registration,
      metrics: this.metrics,
      local: this.local.status(),
      central: central
        ? {
            ...central.status(),
            resident_bytes: bytes,
            budget_bytes: this.settings.user.cache.max_bytes,
            over_capacity: bytes! > this.settings.user.cache.max_bytes,
          }
        : { unavailable: true },
    };
  }
}
