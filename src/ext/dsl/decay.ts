import type { Operation, TargetRef } from '../../core/contracts.js';
export const decay = (target: TargetRef, factor: number): Operation => ({
  kind: 'decay',
  target,
  factor,
});
