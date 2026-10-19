import {
  OperationSchema,
  type Annotation,
  type Commit,
  type ExpansionContext,
  type Operation,
} from '../../core/contracts.js';
import { entry } from '../dsl/entry.js';
import { cancel } from '../dsl/cancel.js';
import { decay } from '../dsl/decay.js';
import { relationship } from '../dsl/relationship.js';
import { diagnostic } from '../dsl/diagnostic.js';
import { freezeData } from '../../utils/freeze-data.js';

export const freeze = freezeData;
export function context(
  annotation: Annotation,
  commit: Commit,
  operations: Operation[],
): ExpansionContext {
  const emit = (operation: Operation) => {
    operations.push(OperationSchema.parse(operation));
  };
  return Object.freeze({
    annotation: freeze(structuredClone(annotation)),
    commit: freeze(structuredClone(commit)),
    currentEntry: `${commit.oid}:${annotation.index}`,
    inputs: Object.freeze({}),
    emit,
    addEntry: (v: { type: string; content: string; score?: number }) =>
      emit(entry(v.type, v.content, v.score)),
    cancel: (target: Parameters<typeof cancel>[0]) => emit(cancel(target)),
    decay: (target: Parameters<typeof decay>[0], factor: number) => emit(decay(target, factor)),
    addRelationship: (v: { source: string; target: string; kind?: string; score?: number }) =>
      emit(relationship(v.source, v.target, v.kind, v.score)),
    diagnose: (message: string) => emit(diagnostic(message)),
  });
}
