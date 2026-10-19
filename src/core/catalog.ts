import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
  readdirSync,
  openSync,
  fsyncSync,
  closeSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { identity, json, MemoryError, VERSION, type Attention } from './contracts.js';
import { validatePage, type Page } from './state-map.js';
import { freezeData } from '../utils/freeze-data.js';

export interface Pack {
  version: string;
  id: string;
  repository: string;
  surface: string;
  policy: string;
  base: string | null;
  root: string | null;
  coverage: string[];
  commits: string[];
  deps: string[];
  frontier: string[];
  pages: Record<string, Page>;
  attention: Attention;
  head: string;
  checkpoints?: { oid: string; root: string | null; nodes: number }[];
}
export interface PackRow {
  id: string;
  payload: string;
  path: string;
  size: number;
  resident: number;
  pointer: number;
  manifest: string;
  demand: number | null;
}
const owner = `${process.pid}:${randomUUID()}`;
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Short-lived SQLite handles: no connection survives a catalog operation. */
export class Catalog {
  readonly filename: string;
  readonly directory: string;
  private cache = new LRUCache<string, Pack>({
    max: 8,
    maxSize: 32 * 1024 * 1024,
    sizeCalculation: (p) => Buffer.byteLength(json(p)),
  });
  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
    this.filename = join(directory, 'catalog.sqlite');
    this.db((db) => {
      db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS packs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,path TEXT NOT NULL,size INTEGER NOT NULL,resident INTEGER NOT NULL,pointer INTEGER NOT NULL DEFAULT 0,manifest TEXT NOT NULL,demand INTEGER);
        CREATE TABLE IF NOT EXISTS pages(hash TEXT NOT NULL,owner TEXT NOT NULL,PRIMARY KEY(hash,owner));
        CREATE TABLE IF NOT EXISTS views(key TEXT PRIMARY KEY,segment TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS locations(path TEXT PRIMARY KEY,common_dir TEXT NOT NULL,repository TEXT NOT NULL,location TEXT NOT NULL,trusted INTEGER NOT NULL DEFAULT 0,witness TEXT);
        CREATE TABLE IF NOT EXISTS profiles(key TEXT PRIMARY KEY,generation TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts(event TEXT PRIMARY KEY,key TEXT NOT NULL,generation TEXT NOT NULL,location TEXT NOT NULL,created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS observations(key TEXT NOT NULL,location TEXT NOT NULL,generation TEXT NOT NULL,last_time INTEGER NOT NULL,event TEXT NOT NULL,credits INTEGER NOT NULL,PRIMARY KEY(key,location));
        CREATE TABLE IF NOT EXISTS claims(key TEXT PRIMARY KEY,owner TEXT NOT NULL,pid INTEGER NOT NULL,state TEXT NOT NULL,error TEXT);
        CREATE TABLE IF NOT EXISTS leases(token TEXT NOT NULL,segment TEXT NOT NULL,owner TEXT NOT NULL,pid INTEGER NOT NULL,PRIMARY KEY(token,segment));
        CREATE TABLE IF NOT EXISTS hooks(key TEXT PRIMARY KEY,state TEXT NOT NULL,error TEXT);
        CREATE TABLE IF NOT EXISTS writers(token TEXT PRIMARY KEY,pid INTEGER NOT NULL,resources TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS qualifications(segment TEXT PRIMARY KEY,boundary TEXT NOT NULL,policy TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS coverage_index(id TEXT PRIMARY KEY,repository TEXT NOT NULL,surface TEXT NOT NULL,policy TEXT NOT NULL,total INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS coverage_lookup ON coverage_index(repository,surface,policy,total DESC);
      `);
      const version = db.prepare('SELECT value FROM meta WHERE key=?').get('version') as
        { value: string } | undefined;
      if (version && version.value !== VERSION)
        throw new MemoryError('incompatible', 'unsupported catalog version');
      db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('version', VERSION);
      const environment = `${process.platform}-${process.arch}`;
      const existingEnvironment = db
        .prepare("SELECT value FROM meta WHERE key='environment'")
        .get() as { value: string } | undefined;
      if (existingEnvironment && existingEnvironment.value !== environment)
        throw new MemoryError(
          'incompatible',
          'catalog belongs to a different runtime environment; use a separate home',
        );
      db.prepare("INSERT OR IGNORE INTO meta VALUES ('environment',?)").run(environment);
    });
    this.recover();
  }
  db<T>(work: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.filename, { timeout: 250 });
    try {
      db.exec('PRAGMA foreign_keys=ON');
      return work(db);
    } finally {
      db.close();
    }
  }
  transaction<T>(work: (db: DatabaseSync) => T): T {
    return this.db((db) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = work(db);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
  }
  row(id: string): PackRow | undefined {
    return this.db(
      (db) =>
        db.prepare('SELECT * FROM packs WHERE id=?').get(id) as unknown as PackRow | undefined,
    );
  }
  rows(): PackRow[] {
    return this.db((db) => db.prepare('SELECT * FROM packs').all() as unknown as PackRow[]);
  }
  candidates(repository: string, surface: string, limit: number, policy?: string): Pack[] {
    return this.db((db) => {
      const statement = db.prepare(
        `SELECT p.manifest FROM packs p JOIN coverage_index c ON c.id=p.id WHERE c.repository=? AND c.surface=? AND c.total<=? ${policy ? 'AND c.policy=?' : ''} ORDER BY c.total DESC,c.id LIMIT 256`,
      );
      const rows = statement.all(
        ...(policy ? [repository, surface, limit, policy] : [repository, surface, limit]),
      ) as { manifest: string }[];
      return rows.map((r) => JSON.parse(r.manifest) as Pack);
    });
  }
  view(key: string): string | undefined {
    return this.db(
      (db) =>
        (
          db.prepare('SELECT segment FROM views WHERE key=?').get(key) as
            { segment: string } | undefined
        )?.segment,
    );
  }
  setView(key: string, id: string) {
    this.db((db) => db.prepare('INSERT OR REPLACE INTO views VALUES (?,?)').run(key, id));
  }
  load(id: string): Pack {
    const row = this.row(id);
    if (!row?.resident)
      throw new MemoryError('evicted', `segment payload unavailable: ${id}`, { segment: id });
    return this.loadRow(row);
  }
  /** A leased reader keeps its original immutable payload generation at handoff. */
  loadRow(row: PackRow): Pack {
    const id = row.id;
    // A cached object does not make a removed or modified file authoritative.
    if (!existsSync(row.path))
      throw new MemoryError('evicted', 'segment file is missing', { segment: id });
    const stat = statSync(row.path);
    const cacheKey = `${row.payload}:${stat.mtimeMs}:${stat.size}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (json({ ...cached, pages: undefined }) !== row.manifest)
        throw new MemoryError('corrupt', 'catalog and payload manifests disagree');
      return cached;
    }
    const bytes = readFileSync(row.path);
    if (identity(bytes.toString('utf8')) !== row.payload)
      throw new MemoryError('corrupt', 'segment integrity mismatch', { segment: id });
    let pack: Pack;
    try {
      pack = JSON.parse(bytes.toString('utf8')) as Pack;
    } catch {
      throw new MemoryError('corrupt', 'malformed segment');
    }
    if (
      pack.id !== id ||
      pack.version !== VERSION ||
      !Array.isArray(pack.coverage) ||
      !Array.isArray(pack.deps)
    )
      throw new MemoryError('corrupt', 'segment manifest mismatch');
    for (const [hash, page] of Object.entries(pack.pages)) {
      validatePage(page);
      if (identity(page) !== hash)
        throw new MemoryError('corrupt', 'state page integrity mismatch');
    }
    if (json({ ...pack, pages: undefined }) !== row.manifest)
      throw new MemoryError('corrupt', 'catalog and payload manifests disagree');
    const frozen = freezeData(pack);
    this.cache.set(cacheKey, frozen);
    return frozen;
  }
  page(hash: string, allowed?: Set<string>, captured?: Map<string, PackRow>): Page {
    const candidates = this.db(
      (db) =>
        db
          .prepare(
            captured
              ? 'SELECT owner FROM pages WHERE hash=? ORDER BY owner'
              : 'SELECT owner FROM pages JOIN packs ON packs.id=pages.owner WHERE hash=? AND resident=1 ORDER BY owner',
          )
          .all(hash) as { owner: string }[],
    );
    const segment = candidates.find((row) => !allowed || allowed.has(row.owner))?.owner;
    if (!segment) throw new MemoryError('evicted', 'state page is unavailable', { page: hash });
    const page = (
      captured?.has(segment) ? this.loadRow(captured.get(segment)!) : this.load(segment)
    ).pages[hash];
    if (!page) throw new MemoryError('corrupt', 'state page is absent from its owner');
    return page;
  }
  publish(
    pack: Pack,
    maxBytes: number,
    fault?: (stage: string) => void,
    qualification?: { boundary: string; policy: string },
  ): number {
    const data = json(pack);
    const size = Buffer.byteLength(data);
    if (size > maxBytes)
      throw new MemoryError('segment_too_large', 'segment exceeds byte limit', {
        limit: maxBytes,
        required: size,
      });
    const payload = identity(data);
    const path = join(this.directory, 'segments', `${payload}.json`);
    mkdirSync(dirname(path), { recursive: true });
    const sealed = this.row(pack.id);
    if (sealed && sealed.payload !== payload)
      throw new MemoryError(
        'incompatible',
        'computed segment identity already has a different sealed payload',
        { segment: pack.id },
      );
    const writer = randomUUID();
    const temporary = `${path}.${randomUUID()}.tmp`;
    this.db((db) =>
      db
        .prepare('INSERT INTO writers VALUES (?,?,?)')
        .run(writer, process.pid, json([path, temporary])),
    );
    try {
      if (!existsSync(path) || identity(readFileSync(path, 'utf8')) !== payload) {
        writeFileSync(temporary, data, { flag: 'wx' });
        const descriptor = openSync(temporary, 'r+');
        try {
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        fault?.('staged');
        renameSync(temporary, path);
      }
      fault?.('payload');
      this.transaction((db) => {
        db.prepare(
          'INSERT OR REPLACE INTO packs(id,payload,path,size,resident,pointer,manifest,demand) VALUES (?,?,?,?,1,0,?,(SELECT demand FROM packs WHERE id=?))',
        ).run(pack.id, payload, path, size, json({ ...pack, pages: undefined }), pack.id);
        for (const hash of Object.keys(pack.pages))
          db.prepare('INSERT OR REPLACE INTO pages VALUES (?,?)').run(hash, pack.id);
        db.prepare('INSERT OR REPLACE INTO coverage_index VALUES (?,?,?,?,?)').run(
          pack.id,
          pack.repository,
          pack.surface,
          pack.policy,
          pack.attention.commits,
        );
        fault?.('catalog');
        if (qualification)
          db.prepare('INSERT OR REPLACE INTO qualifications VALUES (?,?,?)').run(
            pack.id,
            qualification.boundary,
            qualification.policy,
          );
      });
      return size;
    } finally {
      this.db((db) => db.prepare('DELETE FROM writers WHERE token=?').run(writer));
    }
  }
  point(pack: Pack, central: Catalog, fault?: (stage: string) => void) {
    const row = central.row(pack.id);
    if (!row) throw new MemoryError('evicted', 'central result disappeared');
    const previous = this.row(pack.id);
    if (previous?.pointer && previous.payload === row.payload) return false;
    fault?.('before_pointer');
    this.transaction((db) => {
      db.prepare('INSERT OR REPLACE INTO packs VALUES (?,?,?,?,0,1,?,NULL)').run(
        pack.id,
        row.payload,
        row.path,
        row.size,
        json({ ...pack, pages: undefined }),
      );
      for (const hash of Object.keys(pack.pages))
        db.prepare('INSERT OR REPLACE INTO pages VALUES (?,?)').run(hash, pack.id);
      db.prepare('INSERT OR REPLACE INTO coverage_index VALUES (?,?,?,?,?)').run(
        pack.id,
        pack.repository,
        pack.surface,
        pack.policy,
        pack.attention.commits,
      );
    });
    fault?.('after_pointer');
    // Existing readers hold their immutable loaded pages or catalog leases.
    if (previous?.resident && previous.path !== row.path) {
      if (!this.leased(pack.id) && existsSync(previous.path)) unlinkSync(previous.path);
      else this.db((db) => db.prepare("INSERT OR REPLACE INTO meta VALUES ('needs_gc','1')").run());
    }
    return true;
  }
  lease(ids: string[]): () => void {
    const token = randomUUID();
    this.transaction((db) => {
      for (const id of ids) {
        const row = db.prepare('SELECT resident FROM packs WHERE id=?').get(id) as
          { resident: number } | undefined;
        if (!row?.resident) throw new MemoryError('evicted', 'cannot lease missing payload');
        db.prepare('INSERT INTO leases VALUES (?,?,?,?)').run(token, id, owner, process.pid);
      }
    });
    return () => {
      this.db((db) => db.prepare('DELETE FROM leases WHERE token=?').run(token));
      const pending = this.db((db) => db.prepare("SELECT 1 FROM meta WHERE key='needs_gc'").get());
      if (pending) this.recover();
    };
  }
  leased(id: string) {
    return this.db((db) => !!db.prepare('SELECT 1 FROM leases WHERE segment=? LIMIT 1').get(id));
  }
  claim(key: string): 'owned' | 'busy' | 'failed' {
    return this.transaction((db) => {
      const prior = db.prepare('SELECT * FROM claims WHERE key=?').get(key) as
        { owner: string; pid: number; state: string } | undefined;
      if (prior?.state === 'failed') return 'failed';
      if (prior && alive(prior.pid)) return 'busy';
      db.prepare("INSERT OR REPLACE INTO claims VALUES (?,?,?,'building',NULL)").run(
        key,
        owner,
        process.pid,
      );
      return 'owned';
    });
  }
  finishClaim(key: string, error?: string) {
    this.db((db) => {
      if (error)
        db.prepare("UPDATE claims SET state='failed',error=? WHERE key=? AND owner=?").run(
          error,
          key,
          owner,
        );
      else db.prepare('DELETE FROM claims WHERE key=? AND owner=?').run(key, owner);
    });
  }
  demand(ids: string[], now = Date.now()) {
    this.db((db) => {
      for (const id of ids) db.prepare('UPDATE packs SET demand=? WHERE id=?').run(now, id);
    });
  }
  evict(maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new MemoryError('invalid_input', 'cache limit must be a nonnegative integer');
    this.recover();
    let bytes = this.bytes();
    const removed: string[] = [];
    for (const row of this.rows()
      .filter((r) => r.resident)
      .sort((a, b) => (a.demand ?? 0) - (b.demand ?? 0) || (a.id < b.id ? -1 : 1))) {
      if (bytes <= maxBytes) break;
      const deleted = this.transaction((db) => {
        const current = db
          .prepare('SELECT resident,path,payload FROM packs WHERE id=?')
          .get(row.id) as { resident: number; path: string; payload: string } | undefined;
        if (!current?.resident || current.path !== row.path || current.payload !== row.payload)
          return false;
        if (db.prepare('SELECT 1 FROM leases WHERE segment=? LIMIT 1').get(row.id)) return false;
        const writers = db.prepare('SELECT resources FROM writers').all() as {
          resources: string;
        }[];
        if (writers.some((writer) => (JSON.parse(writer.resources) as string[]).includes(row.path)))
          return false;
        db.prepare('UPDATE packs SET resident=0 WHERE id=?').run(row.id);
        // Keep unlink and the visibility transition under the same writer lock.
        // A new lease or publication cannot race between them.
        if (existsSync(row.path)) unlinkSync(row.path);
        return true;
      });
      if (deleted) {
        bytes -= row.size;
        removed.push(row.id);
      }
    }
    bytes = this.bytes();
    return { bytes, removed, over_capacity: bytes > maxBytes };
  }
  bytes() {
    const directory = join(this.directory, 'segments');
    return existsSync(directory)
      ? readdirSync(directory, { withFileTypes: true })
          .filter((f) => f.isFile())
          .reduce((sum, f) => sum + statSync(join(directory, f.name)).size, 0)
      : 0;
  }
  recover() {
    this.transaction((db) => {
      for (const row of db.prepare('SELECT DISTINCT pid FROM leases').all() as { pid: number }[])
        if (!alive(row.pid)) db.prepare('DELETE FROM leases WHERE pid=?').run(row.pid);
      for (const row of db.prepare("SELECT key,pid FROM claims WHERE state='building'").all() as {
        key: string;
        pid: number;
      }[])
        if (!alive(row.pid))
          db.prepare("UPDATE claims SET state='failed',error='interrupted owner' WHERE key=?").run(
            row.key,
          );
      for (const row of db.prepare('SELECT id,path FROM packs WHERE resident=1').all() as {
        id: string;
        path: string;
      }[])
        if (!existsSync(row.path)) db.prepare('UPDATE packs SET resident=0 WHERE id=?').run(row.id);
      for (const row of db.prepare('SELECT token,pid FROM writers').all() as {
        token: string;
        pid: number;
      }[])
        if (!alive(row.pid)) db.prepare('DELETE FROM writers WHERE token=?').run(row.token);
      // A live snapshot may still use an old local materialization after pointer
      // commit. Reclaim unreferenced files only after all such readers drain.
      if (!db.prepare('SELECT 1 FROM leases LIMIT 1').get()) {
        const protectedPaths = new Set<string>(
          (db.prepare('SELECT path FROM packs WHERE resident=1').all() as { path: string }[]).map(
            (r) => r.path,
          ),
        );
        for (const row of db.prepare('SELECT resources FROM writers').all() as {
          resources: string;
        }[])
          for (const path of JSON.parse(row.resources) as string[]) protectedPaths.add(path);
        const directory = join(this.directory, 'segments');
        if (existsSync(directory))
          for (const file of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, file.name);
            if (file.isFile() && !protectedPaths.has(path)) unlinkSync(path);
          }
        db.prepare("DELETE FROM meta WHERE key='needs_gc'").run();
      }
    });
  }
  retry(key: string) {
    this.db((db) => {
      db.prepare("DELETE FROM claims WHERE key=? AND state='failed'").run(key);
      db.prepare("DELETE FROM hooks WHERE key=? AND state IN ('failed','running')").run(key);
    });
  }
  async hook(key: string, work: () => void | Promise<void>) {
    const admitted = this.transaction((db) => {
      if (db.prepare('SELECT 1 FROM hooks WHERE key=?').get(key)) return false;
      db.prepare("INSERT INTO hooks VALUES (?,'running',NULL)").run(key);
      return true;
    });
    if (!admitted) return;
    try {
      await work();
      this.db((db) => db.prepare("UPDATE hooks SET state='done' WHERE key=?").run(key));
    } catch (error) {
      this.db((db) =>
        db.prepare("UPDATE hooks SET state='failed',error=? WHERE key=?").run(String(error), key),
      );
    }
  }
  status() {
    return this.db((db) => ({
      segments: db.prepare('SELECT id,resident,pointer,size,demand FROM packs').all(),
      claims: db.prepare('SELECT key,state,error FROM claims').all(),
      hooks: db.prepare('SELECT key,state,error FROM hooks').all(),
      qualifications: db.prepare('SELECT segment,boundary,policy FROM qualifications').all(),
    }));
  }
}
