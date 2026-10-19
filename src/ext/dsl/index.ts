import type { ExpansionContext, Operation } from '../../core/contracts.js';
import { MemoryError } from '../../core/contracts.js';
import { entry } from './entry.js';
import { cancel } from './cancel.js';
import { decay } from './decay.js';
import { relationship } from './relationship.js';
import { metadata } from './metadata.js';
import { diagnostic } from './diagnostic.js';
export { entry, cancel, decay, relationship, metadata, diagnostic };
export interface Definition {
  function: string;
  [key: string]: unknown;
}
const names = new Set(['entry', 'cancel', 'decay', 'relationship', 'metadata', 'diagnostic']);
export function validateDefinitions(definitions: Definition[]) {
  for (const definition of definitions)
    if (!names.has(definition.function))
      throw new MemoryError('extension', `unknown DSL function: ${definition.function}`);
}
function resolve(value: unknown, ctx: ExpansionContext): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const roots: Record<string, unknown> = {
      annotation: ctx.annotation,
      commit: ctx.commit,
      currentEntry: ctx.currentEntry,
      inputs: ctx.inputs,
    };
    let result: unknown = roots;
    for (const key of value.slice(1).split('.')) {
      if (!result || typeof result !== 'object' || !Object.hasOwn(result, key))
        throw Error(`unknown DSL input: ${value}`);
      result = (result as Record<string, unknown>)[key];
    }
    return result;
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, ctx));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, ctx)]));
  return value;
}
export function execute(definitions: Definition[], ctx: ExpansionContext): void {
  for (const definition of definitions) {
    const v = resolve(definition, ctx) as Record<string, unknown>;
    let op: Operation;
    switch (definition.function) {
      case 'entry':
        op = entry(
          v.type as string,
          v.content as string,
          v.score === undefined ? 1 : Number(v.score),
        );
        break;
      case 'cancel':
        op = cancel(v.target as Parameters<typeof cancel>[0]);
        break;
      case 'decay':
        op = decay(v.target as Parameters<typeof decay>[0], Number(v.factor));
        break;
      case 'relationship':
        op = relationship(
          v.source as string,
          v.target as string,
          v.relation as string | undefined,
          v.score === undefined ? 1 : Number(v.score),
        );
        break;
      case 'metadata':
        op = metadata(
          v.from as string,
          v.to as string,
          v.operations as Parameters<typeof metadata>[2],
        );
        break;
      case 'diagnostic':
        op = diagnostic(v.message as string);
        break;
      default:
        throw new MemoryError('extension', `unknown DSL function: ${definition.function}`);
    }
    ctx.emit(op);
  }
}
