import { annotations } from './annotations.js';
import { context } from '../ext/tseam/context.js';
import { affectedAreas, GitRepo } from './git.js';
import {
  identity,
  MemoryError,
  type Annotation,
  type Commit,
  type Entry,
  type Operation,
  type Surface,
  type TargetRef,
} from './contracts.js';
import { StateMap } from './state-map.js';
import { LRUCache } from 'lru-cache';

export interface Diagnostic {
  id: string;
  sha: string;
  index: number;
  message: string;
  code: string;
}
interface Assignment {
  source: string;
  sequence: number;
  value: string[] | string | null;
}
interface StoredEntry extends Entry {
  base_score: number;
  decays: Record<string, number>;
  cancellations: string[];
  assignments: Record<string, Assignment[]>;
}
export interface EffectOutcome {
  annotation: number;
  target: string;
  before: Entry;
  after: Entry;
}
export class Compiler {
  expansions = 0;
  effects = 0;
  private ancestry = new LRUCache<string, boolean>({ max: 4096 });
  constructor(
    readonly repo: GitRepo,
    readonly state: StateMap,
    readonly surface: Surface,
    private hypothetical?: { oid: string; parent: string },
    private incomplete = false,
  ) {}
  private ancestor(from: string, to: string) {
    const target = to === this.hypothetical?.oid ? this.hypothetical.parent : to;
    const key = `${from}:${target}`;
    const known = this.ancestry.get(key);
    if (known !== undefined) return known;
    const pending = [target],
      seen = new Set<string>();
    let missing = false;
    while (pending.length) {
      const oid = pending.pop()!;
      if (oid === from) {
        this.ancestry.set(key, true);
        return true;
      }
      if (seen.has(oid)) continue;
      seen.add(oid);
      const commit = this.state.get<{ parents: string[] }>(`commit:${oid}`);
      if (commit) pending.push(...commit.parents);
      else missing = true;
    }
    const result = missing ? this.repo.ancestor(from, target) : false;
    this.ancestry.set(key, result);
    return result;
  }
  diagnostic(commit: Commit, annotation: Annotation, message: string, code = 'semantic') {
    const id = `${commit.oid}:${annotation.index}:${identity(message)}`;
    this.state.set(`diagnostic:${id}`, {
      id,
      sha: commit.oid,
      index: annotation.index,
      message,
      code,
    });
  }
  async commit(commit: Commit): Promise<EffectOutcome[]> {
    this.state.set(`commit:${commit.oid}`, {
      oid: commit.oid,
      parents: commit.parents,
      time: commit.time,
      scope: commit.scope,
      areas: affectedAreas(commit.paths),
    });
    const outcomes: EffectOutcome[] = [];
    for (const annotation of annotations(commit.message)) {
      if (annotation.error) {
        this.diagnostic(commit, annotation, annotation.error, 'parse');
        continue;
      }
      const handler = this.surface.handlers.get(annotation.type);
      if (!handler) {
        this.diagnostic(
          commit,
          annotation,
          `Unsupported annotation type: ${annotation.type}`,
          'unsupported',
        );
        continue;
      }
      const operations: Operation[] = [];
      const point = this.state.checkpoint();
      const priorOutcomes = outcomes.length;
      try {
        this.expansions++;
        const returned = await handler.expand(context(annotation, commit, operations));
        if (returned !== undefined) throw Error('expand must return nothing');
        for (const [position, operation] of operations.entries()) {
          const result = this.apply(operation, commit, annotation, position);
          if (result) outcomes.push(result);
        }
      } catch (error) {
        this.state.restore(point);
        outcomes.length = priorOutcomes;
        if (error instanceof MemoryError && error.code === 'segment_too_large') throw error;
        this.diagnostic(
          commit,
          annotation,
          String(error),
          String(error).includes('incomplete') ? 'incomplete_history' : 'semantic',
        );
      }
    }
    return outcomes;
  }
  private target(target: TargetRef, commit: Commit): StoredEntry {
    const oid = this.repo.resolve(target.sha);
    if (oid === commit.oid || !this.ancestor(oid, commit.oid))
      throw Error('target must precede the annotation in reachable ancestry');
    const value = this.state.get<StoredEntry>(`entry:${oid}:${target.index}`);
    if (!value)
      throw Error(
        this.incomplete
          ? 'incomplete history: target is outside selected state'
          : 'target annotation does not exist',
      );
    return structuredClone(value);
  }
  private apply(
    operation: Operation,
    commit: Commit,
    annotation: Annotation,
    position: number,
  ): EffectOutcome | undefined {
    const origin = `${commit.oid}:${annotation.index}:${position}`;
    if (this.state.get(`effect:${origin}`)) return;
    switch (operation.kind) {
      case 'entry': {
        const id = `${commit.oid}:${annotation.index}`;
        if (this.state.get(`entry:${id}`))
          throw Error('one annotation cannot create duplicate entry identities');
        const value: StoredEntry = {
          id,
          sha: commit.oid,
          index: annotation.index,
          type: operation.type,
          content: operation.content,
          score: operation.score,
          base_score: operation.score,
          valid: true,
          commit_time: commit.time,
          scope: commit.scope,
          affected_areas: affectedAreas(commit.paths),
          owner: null,
          tags: [],
          metadata_conflicts: {},
          decays: {},
          cancellations: [],
          assignments: {},
        };
        this.state.set(`entry:${id}`, value);
        break;
      }
      case 'decay':
      case 'cancel': {
        const target = this.target(operation.target, commit);
        const before = publicEntry(target);
        if (operation.kind === 'cancel') {
          if (target.type !== 'DECISION') throw Error('CANCEL can target only DECISION');
          target.cancellations.push(origin);
          target.valid = false;
          target.score = 0;
        } else {
          target.decays[origin] = operation.factor;
          target.score = target.valid
            ? target.base_score *
              Object.keys(target.decays)
                .sort()
                .reduce((p, k) => p * target.decays[k]!, 1)
            : 0;
        }
        this.state.set(`entry:${target.id}`, target);
        this.state.set(`effect:${origin}`, {
          kind: operation.kind,
          target: target.id,
          source: commit.oid,
        });
        this.effects++;
        return {
          annotation: annotation.index,
          target: target.id,
          before,
          after: publicEntry(target),
        };
      }
      case 'relationship': {
        for (const id of [operation.source, operation.target])
          if (!this.state.get(`entry:${id}`)) throw Error('relationship endpoint is absent');
        this.state.set(`relationship:${origin}`, { id: origin, ...operation, sha: commit.oid });
        break;
      }
      case 'diagnostic':
        this.diagnostic(commit, annotation, operation.message);
        break;
      case 'metadata': {
        const from = this.repo.resolve(operation.from),
          to = this.repo.resolve(operation.to);
        if (!this.ancestor(from, to) || to === commit.oid || !this.ancestor(to, commit.oid))
          throw Error('invalid metadata ancestry range');
        const parents = this.repo.commit(from).parents;
        const range = this.repo
          .git(['rev-list', to, ...parents.map((p) => `^${p}`)])
          .trim()
          .split('\n')
          .filter(Boolean);
        if (range.some((oid) => !this.state.get(`commit:${oid}`)))
          throw Error('incomplete metadata history range');
        const selected = new Set(range);
        for (const [key, value] of [...this.state.entries('entry:')]) {
          const entry = structuredClone(value) as StoredEntry;
          if (!selected.has(entry.sha)) continue;
          for (const [index, patch] of operation.operations.entries()) {
            if (patch.operator === 'add' && patch.key === 'owner')
              throw Error('owner cannot be appended');
            if (
              patch.key === 'affected_areas' &&
              patch.value !== null &&
              (patch.value.includes('\\') ||
                patch.value.startsWith('/') ||
                patch.value.split('/').some((v) => !v || v === '.' || v === '..'))
            )
              throw Error('invalid affected area');
            const candidates = entry.assignments[patch.key] ?? [];
            const visible = candidates.filter(
              (a) => a.source === commit.oid || this.ancestor(a.source, commit.oid),
            );
            const intrinsic =
              patch.key === 'affected_areas'
                ? (this.state.get<{ areas: string[] | null }>(`commit:${entry.sha}`)?.areas ?? null)
                : patch.key === 'tags'
                  ? []
                  : null;
            const current = this.resolveAssignments(visible, intrinsic).value;
            let next: string | string[] | null;
            if (patch.operator === 'reset') next = patch.key === 'tags' ? [] : null;
            else if (patch.key === 'owner') next = patch.value;
            else if (patch.operator === 'set') next = [patch.value!];
            else
              next =
                current === null && patch.key === 'affected_areas'
                  ? null
                  : [...new Set([...(Array.isArray(current) ? current : []), patch.value!])].sort();
            candidates.push({
              source: commit.oid,
              sequence: annotation.index * 100000 + position * 1000 + index,
              value: next,
            });
            entry.assignments[patch.key] = candidates;
            const result = this.resolveAssignments(candidates, patch.key === 'tags' ? [] : null);
            if (result.conflicts.length) entry.metadata_conflicts[patch.key] = result.conflicts;
            else delete entry.metadata_conflicts[patch.key];
            if (patch.key === 'owner') entry.owner = result.value as string | null;
            if (patch.key === 'tags') entry.tags = (result.value ?? []) as string[];
            if (patch.key === 'affected_areas')
              entry.affected_areas = result.value as string[] | null;
          }
          this.state.set(key, entry);
        }
        this.state.set(`effect:${origin}`, { kind: 'metadata', source: commit.oid, from, to });
        this.effects++;
        break;
      }
    }
  }
  private resolveAssignments(candidates: Assignment[], fallback: string[] | string | null) {
    const maximal = candidates.filter(
      (a) =>
        !candidates.some(
          (b) =>
            a !== b &&
            (a.source === b.source ? a.sequence < b.sequence : this.ancestor(a.source, b.source)),
        ),
    );
    const values = [
      ...new Map(maximal.map((a) => [JSON.stringify(a.value), a.value])).entries(),
    ].sort(([a], [b]) => (a < b ? -1 : 1));
    return {
      value: values.length === 1 ? values[0]![1] : fallback,
      conflicts: values.length > 1 ? values.map(([v]) => v) : [],
    };
  }
}
export function publicEntry(value: StoredEntry | Entry): Entry {
  const {
    id,
    sha,
    index,
    type,
    content,
    score,
    valid,
    commit_time,
    scope,
    affected_areas,
    owner,
    tags,
    metadata_conflicts,
  } = value;
  return structuredClone({
    id,
    sha,
    index,
    type,
    content,
    score,
    valid,
    commit_time,
    scope,
    affected_areas,
    owner,
    tags,
    metadata_conflicts,
  });
}
