import type { Handler } from '../../core/contracts.js';
import { metadata } from '../dsl/metadata.js';

export function builtins(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  for (const type of ['DECISION', 'LESSON_LEARNT'])
    handlers.set(type, { expand: (c) => c.addEntry({ type, content: c.annotation.content }) });
  handlers.set('DECAY', {
    expand: (c) => {
      const [sha, index, factor] = c.annotation.args;
      c.decay({ sha: sha ?? '', index: Number(index) }, Number(factor));
    },
  });
  handlers.set('CANCEL', {
    expand: (c) => {
      const [sha, index] = c.annotation.args;
      c.cancel({ sha: sha ?? '', index: Number(index) });
    },
  });
  handlers.set('META', {
    expand: (c) => {
      const [from, to, ...args] = c.annotation.args;
      const operations = args.map((arg) => {
        const match = arg.match(/^(affected_areas|owner|tags)(\+=|=)(.+)$/);
        if (!match) throw Error('invalid META operation');
        const key = match[1] as 'affected_areas' | 'owner' | 'tags';
        if (key === 'owner' && match[2] === '+=') throw Error('owner cannot be appended');
        const value = match[3] === 'null' ? null : match[3]!;
        return {
          key,
          operator: (value === null ? 'reset' : match[2] === '+=' ? 'add' : 'set') as
            'reset' | 'add' | 'set',
          value,
        };
      });
      c.emit(metadata(from ?? '', to ?? '', operations));
    },
  });
  return handlers;
}
