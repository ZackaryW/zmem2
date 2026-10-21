import {
  existsSync,
  readFileSync,
  statSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { identity, json, MemoryError, type Selection } from './contracts.js';
import type { GitRepo } from './git.js';

/** A full pinned header selection, never a partial or disconnected graph. */
export function validFullSelection(value: unknown, head: string): value is Selection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as Selection;
  const attention = selection.attention;
  if (
    selection.head !== head ||
    !Array.isArray(selection.commits) ||
    !attention ||
    attention.commit_limit !== -1 ||
    attention.node_limit !== -1 ||
    attention.truncated !== false ||
    !Array.isArray(attention.reached) ||
    attention.reached.length ||
    attention.commits !== selection.commits.length ||
    !Number.isSafeInteger(attention.nodes) ||
    attention.nodes < 0
  )
    return false;
  const seen = new Set<string>(),
    leaves = new Set<string>();
  for (const commit of selection.commits) {
    if (
      !commit ||
      typeof commit !== 'object' ||
      typeof commit.oid !== 'string' ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.oid) ||
      seen.has(commit.oid) ||
      !Array.isArray(commit.parents) ||
      commit.parents.some((parent) => !seen.has(parent)) ||
      new Set(commit.parents).size !== commit.parents.length ||
      !Number.isSafeInteger(commit.time) ||
      commit.message !== '' ||
      !Array.isArray(commit.paths) ||
      commit.paths.length ||
      !(commit.scope === null || typeof commit.scope === 'string')
    )
      return false;
    seen.add(commit.oid);
    leaves.add(commit.oid);
    for (const parent of commit.parents) leaves.delete(parent);
  }
  return leaves.size === 1 && leaves.has(head);
}

/** Private disposable planning data. Its checksum detects damage, not hostile user edits. */
export function historyPlan(
  repo: GitRepo,
  directory: string,
  target: string,
  head: string,
  maxBytes: number,
  guard: <T>(work: () => T) => T,
  beforeWrite: (bytes: number) => void,
): Selection {
  guard(() => {});
  const filename = join(directory, 'selection.json');
  if (existsSync(filename)) {
    if (statSync(filename).size > maxBytes)
      throw new MemoryError('storage_limit', 'background selection exceeds staging budget');
    let stored: {
      version?: number;
      target?: string;
      selection?: unknown;
      checksum?: string;
    } | null = null;
    try {
      stored = JSON.parse(readFileSync(filename, 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (
      stored?.version === 1 &&
      stored.target === target &&
      validFullSelection(stored.selection, head) &&
      stored.checksum === identity({ version: 1, target, selection: stored.selection })
    ) {
      guard(() => {});
      return stored.selection;
    }
  }
  const selection = repo.select(head, -1, -1, head);
  if (!validFullSelection(selection, head))
    throw new MemoryError('repository', 'invalid complete history selection');
  const body = { version: 1, target, selection };
  const content = json({ ...body, checksum: identity(body) });
  const size = Buffer.byteLength(content);
  if (size > maxBytes)
    throw new MemoryError('storage_limit', 'background selection exceeds staging budget');
  const temporary = join(directory, `selection-${randomUUID()}.tmp`);
  guard(() => {
    beforeWrite(size);
    try {
      const fd = openSync(temporary, 'wx');
      try {
        writeFileSync(fd, content);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, filename);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  });
  return selection;
}
