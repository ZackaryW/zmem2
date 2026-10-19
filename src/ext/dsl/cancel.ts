import type { Operation, TargetRef } from '../../core/contracts.js';
export const cancel = (target: TargetRef): Operation => ({ kind: 'cancel', target });
