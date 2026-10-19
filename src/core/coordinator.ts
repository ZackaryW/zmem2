import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { Catalog, type Pack } from './catalog.js';
import { GitRepo } from './git.js';
import { identity, MemoryError } from './contracts.js';
import type { UserConfig } from './config.js';

export class Coordinator {
  constructor(
    readonly catalog: Catalog,
    readonly config: UserConfig,
  ) {
    const now = Date.now(),
      expiry = now - config.profiles.retention_days * 86400000;
    catalog.transaction((db) => {
      const stale = db
        .prepare(
          'SELECT key FROM profiles WHERE updated<? OR updated>? UNION SELECT key FROM (SELECT key FROM profiles ORDER BY updated DESC,key LIMIT -1 OFFSET ?)',
        )
        .all(expiry, now, config.profiles.max_entries) as { key: string }[];
      if (stale.length)
        db.prepare("INSERT OR REPLACE INTO meta VALUES ('profile_watermark',?)").run(String(now));
      for (const row of stale) {
        db.prepare('DELETE FROM observations WHERE key=?').run(row.key);
        db.prepare('DELETE FROM profiles WHERE key=?').run(row.key);
      }
    });
    const previousLimit = catalog.db(
      (db) =>
        (
          db.prepare("SELECT value FROM meta WHERE key='cache_limit'").get() as
            { value: string } | undefined
        )?.value,
    );
    if (previousLimit !== String(config.cache.max_bytes)) {
      const pressure = catalog.evict(config.cache.max_bytes);
      if (!pressure.over_capacity)
        catalog.db((db) =>
          db
            .prepare("INSERT OR REPLACE INTO meta VALUES ('cache_limit',?)")
            .run(String(config.cache.max_bytes)),
        );
    }
  }
  register(repo: GitRepo, associate?: string, trust?: boolean) {
    const path = process.platform === 'win32' ? repo.root.toLowerCase() : repo.root;
    return this.catalog.transaction((db) => {
      let prior = db.prepare('SELECT * FROM locations WHERE path=?').get(path) as
        | {
            repository: string;
            location: string;
            trusted: number;
            common_dir: string;
            witness: string | null;
          }
        | undefined;
      if (prior?.witness) {
        try {
          this.repoWitness(repo, prior.witness);
        } catch {
          db.prepare('DELETE FROM locations WHERE path=?').run(path);
          prior = undefined;
        }
      }
      if (prior && prior.common_dir === repo.common && !associate) {
        if (trust !== undefined)
          db.prepare('UPDATE locations SET trusted=? WHERE path=?').run(Number(trust), path);
        if (!prior.witness)
          try {
            db.prepare('UPDATE locations SET witness=? WHERE path=?').run(repo.resolve(), path);
          } catch {
            /* still unborn */
          }
        return {
          repository: prior.repository,
          location: prior.location,
          trusted: trust ?? !!prior.trusted,
        };
      }
      let repository = associate;
      const common = db
        .prepare('SELECT repository FROM locations WHERE common_dir=? LIMIT 1')
        .get(repo.common) as { repository: string } | undefined;
      if (!repository) repository = common?.repository ?? randomUUID();
      const known = db
        .prepare('SELECT witness FROM locations WHERE repository=? AND witness IS NOT NULL LIMIT 1')
        .get(repository) as { witness: string } | undefined;
      if (associate) {
        if (!known) throw new MemoryError('invalid_input', 'unknown repository identity');
        try {
          repo.resolve(known.witness);
        } catch {
          throw new MemoryError('repository', 'association witness commit is not present');
        }
      }
      let currentHead: string | null = null;
      try {
        currentHead = repo.resolve();
      } catch {
        /* An unborn Git repository can be registered before its first commit. */
      }
      const witness = known?.witness ?? currentHead;
      const location = prior?.location ?? randomUUID();
      db.prepare('INSERT OR REPLACE INTO locations VALUES (?,?,?,?,?,?)').run(
        path,
        repo.common,
        repository,
        location,
        Number(trust ?? prior?.trusted ?? false),
        witness,
      );
      return { repository, location, trusted: trust ?? !!prior?.trusted };
    });
  }
  private repoWitness(repo: GitRepo, oid: string) {
    repo.resolve(oid);
  }
  stable(repo: GitRepo, pack: Pack): string | undefined {
    for (const boundary of this.config.promotion.stable_boundaries.filter(
      (b) => b.repository === pack.repository,
    )) {
      try {
        const oid = repo.resolve(boundary.oid ?? boundary.ref!);
        if (pack.frontier.length && pack.frontier.every((commit) => repo.ancestor(commit, oid)))
          return oid;
      } catch {
        /* Missing refs fail closed. */
      }
    }
    return undefined;
  }
  observe(pack: Pack, location: string, event: string, now = Date.now()): number {
    const expiry = now - this.config.profiles.retention_days * 86400000;
    return this.catalog.transaction((db) => {
      const expired = db.prepare('SELECT 1 FROM profiles WHERE updated<? LIMIT 1').get(expiry);
      if (expired)
        db.prepare("INSERT OR REPLACE INTO meta VALUES ('profile_watermark',?)").run(String(now));
      db.prepare(
        'DELETE FROM observations WHERE key IN (SELECT key FROM profiles WHERE updated<?)',
      ).run(expiry);
      db.prepare('DELETE FROM profiles WHERE updated<?').run(expiry);
      let profile = db
        .prepare('SELECT generation,created FROM profiles WHERE key=?')
        .get(pack.id) as { generation: string; created: number } | undefined;
      const time = Number(event.split(':')[0]);
      if (!Number.isSafeInteger(time) || time < expiry || time > now) return 0;
      if (!profile) {
        const watermark = Number(
          (
            db.prepare("SELECT value FROM meta WHERE key='profile_watermark'").get() as
              { value: string } | undefined
          )?.value ?? 0,
        );
        if (time <= watermark) return 0;
        profile = { generation: randomUUID(), created: now };
        db.prepare('INSERT INTO profiles VALUES (?,?,?,?)').run(
          pack.id,
          profile.generation,
          now,
          now,
        );
      }
      const prior = db
        .prepare('SELECT last_time,credits FROM observations WHERE key=? AND location=?')
        .get(pack.id, location) as { last_time: number; credits: number } | undefined;
      // A bounded per-location high-water mark rejects duplicates and delayed old
      // deliveries. Dropped out-of-order observations only reduce promotion.
      if (!prior || time > prior.last_time)
        db.prepare('INSERT OR REPLACE INTO observations VALUES (?,?,?,?,?,?)').run(
          pack.id,
          location,
          profile.generation,
          time,
          event,
          Math.min(Number.MAX_SAFE_INTEGER, 1 + (prior?.credits ?? 0)),
        );
      db.prepare(
        'DELETE FROM observations WHERE key=? AND location NOT IN (SELECT location FROM observations WHERE key=? ORDER BY last_time DESC,location LIMIT 64)',
      ).run(pack.id, pack.id);
      db.prepare('UPDATE profiles SET updated=? WHERE key=?').run(now, pack.id);
      const stale = db
        .prepare('SELECT key FROM profiles ORDER BY updated DESC,key LIMIT -1 OFFSET ?')
        .all(this.config.profiles.max_entries) as { key: string }[];
      if (stale.length)
        db.prepare("INSERT OR REPLACE INTO meta VALUES ('profile_watermark',?)").run(String(now));
      for (const row of stale) {
        db.prepare('DELETE FROM observations WHERE key=?').run(row.key);
        db.prepare('DELETE FROM profiles WHERE key=?').run(row.key);
      }
      const observations = db
        .prepare('SELECT credits FROM observations WHERE key=?')
        .all(pack.id) as { credits: number }[];
      return observations.length >= 2
        ? observations.reduce((n, v) => Math.min(Number.MAX_SAFE_INTEGER, n + v.credits), 0)
        : 0;
    });
  }
  count(key: string): number {
    return this.catalog.db((db) => {
      const profile = db.prepare('SELECT updated FROM profiles WHERE key=?').get(key) as
        { updated: number } | undefined;
      if (!profile || profile.updated < Date.now() - this.config.profiles.retention_days * 86400000)
        return 0;
      const rows = db.prepare('SELECT credits FROM observations WHERE key=?').all(key) as {
        credits: number;
      }[];
      return rows.length >= 2
        ? rows.reduce((n, v) => Math.min(Number.MAX_SAFE_INTEGER, n + v.credits), 0)
        : 0;
    });
  }
  eligible(repo: GitRepo, pack: Pack) {
    return (
      this.config.promotion.enabled &&
      this.count(pack.id) >= this.config.promotion.min_computations &&
      !!this.stable(repo, pack)
    );
  }
  promote(repo: GitRepo, pack: Pack, source: Catalog, resolve: (id: string) => Pack) {
    const proof = this.stable(repo, pack);
    if (!proof || !this.eligible(repo, pack)) return false;
    const claim = this.catalog.claim(`promotion:${pack.id}`);
    if (claim !== 'owned') return false;
    let admission = false;
    let failed = false;
    try {
      const seen = new Set<string>();
      const closure: Pack[] = [];
      const visit = (p: Pack) => {
        if (seen.has(p.id)) return;
        seen.add(p.id);
        for (const id of p.deps) visit(resolve(id));
        closure.push(p);
      };
      visit(pack);
      if (this.stable(repo, pack) !== proof) return false;
      if (this.catalog.claim('cache:admission') !== 'owned') return false;
      admission = true;
      const leases: (() => void)[] = [];
      try {
        for (const item of closure)
          if (this.catalog.row(item.id)?.resident) leases.push(this.catalog.lease([item.id]));
        const incoming = closure
          .filter((p) => !this.catalog.row(p.id)?.resident)
          .reduce((n, p) => n + Buffer.byteLength(JSON.stringify(p)), 0);
        this.catalog.evict(Math.max(0, this.config.cache.max_bytes - incoming));
        if (this.catalog.bytes() + incoming > this.config.cache.max_bytes) return false;
        for (const item of closure) {
          if (!this.catalog.row(item.id)?.resident)
            this.catalog.publish(
              item,
              this.config.segments.max_bytes,
              (stage) => {
                if (stage === 'catalog' && this.stable(repo, pack) !== proof)
                  throw new MemoryError('unstable', 'stable boundary moved before publication');
              },
              { boundary: proof, policy: identity(this.config.promotion) },
            );
          leases.push(this.catalog.lease([item.id]));
        }
        if (this.stable(repo, pack) !== proof) return false;
      } finally {
        leases.forEach((release) => release());
      }
      return true;
    } catch (error) {
      failed = true;
      this.catalog.finishClaim(`promotion:${pack.id}`, String(error));
      throw error;
    } finally {
      if (admission) this.catalog.finishClaim('cache:admission');
      if (!failed) this.catalog.finishClaim(`promotion:${pack.id}`);
    }
  }
}
