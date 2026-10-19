import type { Operation } from '../../core/contracts.js';
export const diagnostic = (message: string): Operation => ({ kind: 'diagnostic', message });
