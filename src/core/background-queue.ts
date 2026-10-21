import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { identity, MemoryError } from './contracts.js';

export type AdmissionStatus =
  'accepted' | 'already_pending' | 'already_fulfilled' | 'ineligible' | 'queue_full' | 'failed';
export interface Admission {
  status: AdmissionStatus;
  job_id?: string;
  state?: string;
  reason?: string;
}
export interface BackfillTarget {
  repository: string;
  location: string;
  path: string;
  head: string;
  surface: string;
  version: string;
  max_commits: number;
  max_bytes: number;
}
export interface BackgroundJob {
  id: string;
  target: BackfillTarget;
  state: 'queued' | 'running' | 'paused' | 'cancelled' | 'failed' | 'completed';
  token: string | null;
  supervisor: string | null;
  pid: number | null;
  created: number;
  updated: number;
  attempts: number;
  commits: number;
  segment: string | null;
  error: string | null;
}
interface Service {
  enabled: number;
  token: string | null;
  pid: number | null;
  heartbeat: number;
}
export function processAlive(pid: number | null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A separate control plane. Construction and observation do not create files. */
export class BackgroundQueue {
  readonly file: string;
  constructor(readonly home: string) {
    this.file = join(home, 'background', 'control.sqlite');
  }
  private open(create: boolean) {
    if (!existsSync(this.file) && !create) return undefined;
    if (create) mkdirSync(join(this.home, 'background'), { recursive: true });
    const db = new DatabaseSync(this.file, { timeout: 250, readOnly: !create });
    if (create)
      db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS version(value INTEGER NOT NULL);
      INSERT INTO version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM version);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS service(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL, token TEXT, pid INTEGER, heartbeat INTEGER NOT NULL);
      INSERT OR IGNORE INTO service VALUES(1,1,NULL,NULL,0);`);
    if ((db.prepare('SELECT value FROM version').get() as { value: number }).value !== 1) {
      db.close();
      throw new MemoryError('incompatible', 'background database version mismatch');
    }
    return db;
  }
  private transaction<T>(fn: (db: DatabaseSync) => T): T {
    const db = this.open(true)!;
    try {
      db.exec('BEGIN IMMEDIATE');
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    } finally {
      db.close();
    }
  }
  private jobs(db: DatabaseSync): BackgroundJob[] {
    return (db.prepare('SELECT data FROM jobs ORDER BY rowid').all() as { data: string }[]).map(
      (r) => JSON.parse(r.data) as BackgroundJob,
    );
  }
  private save(db: DatabaseSync, job: BackgroundJob) {
    job.updated = Date.now();
    db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?,?)').run(
      job.id,
      job.state,
      JSON.stringify(job),
    );
  }
  private service(db: DatabaseSync) {
    return db.prepare('SELECT * FROM service WHERE id=1').get() as unknown as Service;
  }
  inspect() {
    const db = this.open(false);
    if (!db) return { service: { enabled: true, running: false }, jobs: [] as BackgroundJob[] };
    try {
      const s = this.service(db);
      return {
        service: {
          enabled: !!s.enabled,
          running: !!s.token && processAlive(s.pid),
          pid: s.pid,
          heartbeat: s.heartbeat,
        },
        jobs: this.jobs(db),
      };
    } finally {
      db.close();
    }
  }
  get(id: string) {
    return this.inspect().jobs.find((j) => j.id === id);
  }
  admit(target: BackfillTarget, fulfilled = false, reason?: string): Admission {
    if (reason) return { status: 'ineligible', reason };
    if (fulfilled) return { status: 'already_fulfilled' };
    try {
      return this.transaction((db) => {
        const id = identity(target),
          jobs = this.jobs(db),
          old = jobs.find((j) => j.id === id);
        if (old?.state === 'completed')
          return { status: 'already_fulfilled', job_id: id, state: old.state };
        if (old && ['queued', 'running'].includes(old.state))
          return { status: 'already_pending', job_id: id, state: old.state };
        if (old)
          return { status: 'ineligible', job_id: id, state: old.state, reason: `job_${old.state}` };
        if (!this.service(db).enabled) return { status: 'ineligible', reason: 'service_stopped' };
        if (jobs.filter((j) => j.state === 'queued').length >= 8)
          return { status: 'queue_full', reason: 'eight_waiting_targets' };
        this.save(db, {
          id,
          target,
          state: 'queued',
          token: null,
          supervisor: null,
          pid: null,
          created: Date.now(),
          updated: Date.now(),
          attempts: 0,
          commits: 0,
          segment: null,
          error: null,
        });
        return { status: 'accepted', job_id: id, state: 'queued' };
      });
    } catch (error) {
      return { status: 'failed', reason: String(error) };
    }
  }
  acquireSupervisor(): string | undefined {
    return this.transaction((db) => {
      const s = this.service(db);
      if (!s.enabled || (s.token && processAlive(s.pid))) return undefined;
      const token = randomUUID();
      db.prepare('UPDATE service SET token=?,pid=?,heartbeat=? WHERE id=1').run(
        token,
        process.pid,
        Date.now(),
      );
      return token;
    });
  }
  heartbeat(token: string) {
    return this.transaction((db) => {
      const s = this.service(db);
      if (s.token !== token) return false;
      db.prepare('UPDATE service SET heartbeat=? WHERE id=1').run(Date.now());
      return !!s.enabled;
    });
  }
  releaseSupervisor(token: string) {
    this.transaction((db) => {
      db.prepare('UPDATE service SET token=NULL,pid=NULL WHERE token=?').run(token);
    });
  }
  dispatch(supervisor: string): BackgroundJob | undefined {
    return this.transaction((db) => {
      const s = this.service(db);
      if (!s.enabled || s.token !== supervisor) return undefined;
      const jobs = this.jobs(db);
      // An orphaned wrapper remains capacity-accounted until it exits.
      for (const job of jobs.filter(
        (j) => j.state === 'running' && j.supervisor !== supervisor && !processAlive(j.pid),
      )) {
        job.supervisor = supervisor;
        job.pid = null;
        job.token = null;
        job.attempts++;
        job.error = 'interrupted supervisor';
        this.save(db, job);
      }
      let job = jobs.find((j) => j.state === 'running' && j.supervisor === supervisor && !j.token);
      if (!job) {
        if (jobs.filter((j) => j.state === 'running' || processAlive(j.pid)).length >= 2)
          return undefined;
        job = jobs.find(
          (j) =>
            j.state === 'queued' &&
            !jobs.some(
              (other) =>
                (other.state === 'running' || processAlive(other.pid)) &&
                other.target.location === j.target.location,
            ),
        );
      }
      if (!job) return undefined;
      job.state = 'running';
      job.supervisor = supervisor;
      job.token = randomUUID();
      job.pid = null;
      this.save(db, job);
      return job;
    });
  }
  attach(id: string, token: string, pid: number) {
    this.transaction((db) => {
      const job = this.jobs(db).find((j) => j.id === id);
      if (job?.token === token && job.state === 'running') {
        job.pid = pid;
        this.save(db, job);
      }
    });
  }
  guarded<T>(id: string, token: string, work: () => T): T {
    return this.transaction((db) => {
      const job = this.jobs(db).find((j) => j.id === id),
        s = this.service(db);
      if (
        !job ||
        job.state !== 'running' ||
        job.token !== token ||
        job.supervisor !== s.token ||
        !s.enabled ||
        !processAlive(s.pid)
      )
        throw new MemoryError('cancelled', 'background ownership revoked');
      return work();
    });
  }
  settle(
    id: string,
    token: string,
    outcome: {
      complete?: boolean;
      commits?: number;
      segment?: string;
      error?: string;
      retryable?: boolean;
    },
    maxAttempts: number,
  ) {
    this.transaction((db) => {
      const job = this.jobs(db).find((j) => j.id === id);
      if (!job || job.token !== token || job.state !== 'running') return;
      const progress = (outcome.commits ?? 0) > job.commits;
      job.commits = Math.max(job.commits, outcome.commits ?? 0);
      job.segment = outcome.segment ?? job.segment;
      job.attempts = progress ? 0 : outcome.error ? job.attempts + 1 : job.attempts;
      job.error = outcome.error ?? null;
      job.state = outcome.complete
        ? 'completed'
        : outcome.error && (!outcome.retryable || job.attempts >= maxAttempts)
          ? 'failed'
          : 'running';
      job.token = null;
      job.pid = null;
      this.save(db, job);
    });
  }
  control(id: string, action: 'pause' | 'resume' | 'cancel'): Admission {
    return this.transaction((db) => {
      const jobs = this.jobs(db),
        job = jobs.find((j) => j.id === id);
      if (!job) throw new MemoryError('invalid_input', 'unknown background job');
      if (action === 'resume') {
        if (job.state === 'completed') return { status: 'already_fulfilled', job_id: id };
        if (['queued', 'running'].includes(job.state))
          return { status: 'already_pending', job_id: id, state: job.state };
        if (processAlive(job.pid))
          return { status: 'ineligible', job_id: id, reason: 'worker_stopping' };
        if (jobs.filter((j) => j.state === 'queued').length >= 8) return { status: 'queue_full' };
        job.state = 'queued';
        job.attempts = 0;
        job.error = null;
      } else job.state = action === 'pause' ? 'paused' : 'cancelled';
      job.token = null;
      this.save(db, job);
      return {
        status: action === 'resume' ? 'accepted' : 'ineligible',
        job_id: id,
        state: job.state,
        reason: action,
      };
    });
  }
  setEnabled(enabled: boolean) {
    this.transaction((db) => {
      db.prepare('UPDATE service SET enabled=? WHERE id=1').run(Number(enabled));
      if (!enabled)
        for (const j of this.jobs(db).filter((j) => ['running', 'queued'].includes(j.state))) {
          j.state = 'paused';
          j.token = null;
          this.save(db, j);
        }
    });
  }
}
