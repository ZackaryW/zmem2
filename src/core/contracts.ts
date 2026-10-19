import { z } from 'zod';
import { fingerprint } from '../utils/fingerprint.js';

export class MemoryError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}
export const json = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(json).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${json(v)}`)
      .join(',')}}`;
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new MemoryError('invalid_input', 'non-finite number');
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new MemoryError('invalid_input', 'unsupported JSON value');
  return encoded;
};
export const identity = (value: unknown) => fingerprint([Buffer.from(json(value))]);
export const Target = z
  .object({ sha: z.string().regex(/^[a-f0-9]+$/i), index: z.number().int().positive() })
  .strict();
const score = z.number().finite().min(0).max(1);
export const OperationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('entry'),
      type: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      content: z.string().min(1),
      score: score.default(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('relationship'),
      source: z.string(),
      target: z.string(),
      relation: z.string().default('related'),
      score: score.default(1),
    })
    .strict(),
  z.object({ kind: z.literal('decay'), target: Target, factor: score }).strict(),
  z.object({ kind: z.literal('cancel'), target: Target }).strict(),
  z
    .object({
      kind: z.literal('metadata'),
      from: z.string(),
      to: z.string(),
      operations: z
        .array(
          z
            .object({
              key: z.enum(['affected_areas', 'owner', 'tags']),
              operator: z.enum(['set', 'add', 'reset']),
              value: z.string().nullable(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z.object({ kind: z.literal('diagnostic'), message: z.string() }).strict(),
]);
export type Operation = z.infer<typeof OperationSchema>;
export type TargetRef = z.infer<typeof Target>;
export interface Annotation {
  index: number;
  type: string;
  content: string;
  args: string[];
  raw: string;
  error?: string;
  target?: TargetRef;
}
export interface Commit {
  oid: string;
  parents: string[];
  time: number;
  message: string;
  paths: string[];
  scope: string | null;
}
export interface Attention {
  commit_limit: number;
  node_limit: number;
  commits: number;
  nodes: number;
  truncated: boolean;
  reached: string[];
}
export interface Selection {
  head: string;
  commits: Commit[];
  attention: Attention;
}
export interface Entry {
  id: string;
  sha: string;
  index: number;
  type: string;
  content: string;
  score: number;
  valid: boolean;
  commit_time: number;
  scope: string | null;
  affected_areas: string[] | null;
  owner: string | null;
  tags: string[];
  metadata_conflicts: Record<string, string[]>;
}
export interface ExpansionContext {
  readonly annotation: Readonly<Annotation>;
  readonly commit: Readonly<Commit>;
  readonly currentEntry: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  emit(operation: Operation): void;
  addEntry(value: { type: string; content: string; score?: number }): void;
  cancel(target: TargetRef): void;
  decay(target: TargetRef, factor: number): void;
  addRelationship(value: { source: string; target: string; kind?: string; score?: number }): void;
  diagnose(message: string): void;
}
export interface Handler {
  expand(context: ExpansionContext): void | Promise<void>;
}
export interface Registry {
  extend(type: string, handler: Handler): void;
  afterIndex(name: string, hook: Hook): void;
}
export interface HookContext {
  readonly segment: string;
  readonly repository: string;
  readonly head: string;
}
export type Hook = (context: Readonly<HookContext>) => void | Promise<void>;
export interface Surface {
  id: string;
  shareable: boolean;
  handlers: Map<string, Handler>;
  hooks: Map<string, Hook>;
  load(): Promise<void>;
}
export interface StateRecord {
  key: string;
  value: unknown;
}
export const VERSION = 'zmem2-computed-v1';
