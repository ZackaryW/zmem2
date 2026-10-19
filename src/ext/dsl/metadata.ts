import type { Operation } from '../../core/contracts.js';
export const metadata = (
  from: string,
  to: string,
  operations: Extract<Operation, { kind: 'metadata' }>['operations'],
): Operation => ({ kind: 'metadata', from, to, operations });
