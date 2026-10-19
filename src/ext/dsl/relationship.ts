import type { Operation } from '../../core/contracts.js';
export const relationship = (
  source: string,
  target: string,
  relation = 'related',
  score = 1,
): Operation => ({ kind: 'relationship', source, target, relation, score });
