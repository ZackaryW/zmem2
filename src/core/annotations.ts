import type { Annotation } from './contracts.js';

export function annotations(message: string): Annotation[] {
  let ordinal = 0;
  return message.split(/\r?\n/).flatMap<Annotation>((raw) => {
    if (!raw.includes('zmem(')) return [];
    ordinal++;
    const match = raw
      .trim()
      .replace(/^[-*] /, '')
      .match(/^zmem\(([A-Z][A-Z0-9_]*)\)(?:\[([^\]]*)\])?(?::\s*(.*))?$/);
    if (!match)
      return [
        {
          index: ordinal,
          type: 'INVALID',
          content: '',
          args: [],
          raw,
          error: 'malformed annotation',
        },
      ];
    const args = match[2]?.split(',').map((s) => s.trim()) ?? [];
    const target = args.length >= 2 ? { sha: args[0]!, index: Number(args[1]) } : undefined;
    return [{ index: ordinal, type: match[1]!, content: match[3] ?? '', args, raw, target }];
  });
}
