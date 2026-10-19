import type { Operation } from '../../core/contracts.js';
export const entry = (type: string, content: string, score = 1): Operation => ({
  kind: 'entry',
  type,
  content,
  score,
});
