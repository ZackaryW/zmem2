import { identity, json, MemoryError } from './contracts.js';

export type Page =
  | { values: Record<string, unknown> }
  | { branches: Record<string, string> }
  | { namespaces: Record<string, string> };
/** Content-addressed radix map. Lookup depth is bounded by the 64-digit key hash. */
export class StateMap {
  readonly pending = new Map<string, Page>();
  visits = 0;
  private maxPendingBytes = Number.POSITIVE_INFINITY;
  private pendingBytes = 0;
  peakPendingBytes = 0;
  private known = new Set<string>();
  private retained = new Set<string>();
  retain(root: string | null) {
    if (root) this.retained.add(root);
  }
  limit(bytes: number) {
    this.maxPendingBytes = bytes;
  }
  constructor(
    public root: string | null,
    private read: (hash: string) => Page,
  ) {}
  addReader(reader: (hash: string) => Page) {
    const previous = this.read;
    this.read = (hash) => {
      try {
        return reader(hash);
      } catch (error) {
        if (!(error instanceof MemoryError) || error.code !== 'evicted') throw error;
        return previous(hash);
      }
    };
  }
  page(id: string): Page {
    this.visits++;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const page = this.read(id);
    this.known.add(id);
    return page;
  }
  private save(page: Page): string {
    const id = identity(page);
    if (this.known.has(id)) return id;
    if (!this.pending.has(id)) {
      const bytes = Buffer.byteLength(json(page));
      if (this.pendingBytes + bytes > this.maxPendingBytes)
        throw new MemoryError('segment_too_large', 'construction working-set budget exceeded', {
          limit: this.maxPendingBytes,
        });
      this.pendingBytes += bytes;
      this.peakPendingBytes = Math.max(this.peakPendingBytes, this.pendingBytes);
      this.pending.set(id, page);
    }
    return id;
  }
  get<T = unknown>(key: string): T | undefined {
    if (!this.root) return undefined;
    const root = this.page(this.root);
    if (!('namespaces' in root)) throw new MemoryError('corrupt', 'invalid state root');
    let id: string | null = root.namespaces[this.namespace(key)] ?? null,
      depth = 0;
    const hash = identity(key);
    while (id) {
      const page = this.page(id);
      if ('values' in page) return page.values[key] as T | undefined;
      if (!('branches' in page)) throw new MemoryError('corrupt', 'nested namespace page');
      id = page.branches[hash[depth++]!] ?? null;
    }
    return undefined;
  }
  set(key: string, value: unknown): void {
    const hash = identity(key);
    const insert = (id: string | null, depth: number): string => {
      const page = id ? this.page(id) : { values: {} };
      if ('branches' in page)
        return this.save({
          branches: {
            ...page.branches,
            [hash[depth]!]: insert(page.branches[hash[depth]!] ?? null, depth + 1),
          },
        });
      if (!('values' in page)) throw new MemoryError('corrupt', 'nested namespace page');
      const values = { ...page.values, [key]: value };
      return this.build(values, depth);
    };
    const root = this.root ? this.page(this.root) : { namespaces: {} };
    if (!('namespaces' in root)) throw new MemoryError('corrupt', 'invalid state root');
    const namespace = this.namespace(key);
    this.root = this.save({
      namespaces: {
        ...root.namespaces,
        [namespace]: insert(root.namespaces[namespace] ?? null, 0),
      },
    });
  }
  private namespace(key: string) {
    const colon = key.indexOf(':');
    return colon < 0 ? '$' : key.slice(0, colon);
  }
  private build(values: Record<string, unknown>, depth: number): string {
    const count = Object.keys(values).length;
    if (
      count === 1 ||
      (count <= 16 && Buffer.byteLength(json({ values })) <= 65536) ||
      depth === 64
    )
      return this.save({ values });
    const groups: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(values)) {
      const digit = identity(key)[depth]!;
      (groups[digit] ??= {})[key] = value;
    }
    return this.save({
      branches: Object.fromEntries(
        Object.entries(groups).map(([digit, items]) => [digit, this.build(items, depth + 1)]),
      ),
    });
  }
  *entries(prefix = ''): Generator<[string, unknown]> {
    const visit = function* (self: StateMap, id: string): Generator<[string, unknown]> {
      const page = self.page(id);
      if ('values' in page) {
        for (const row of Object.entries(page.values)) if (row[0].startsWith(prefix)) yield row;
      } else if ('branches' in page)
        for (const child of Object.values(page.branches)) yield* visit(self, child);
      else throw new MemoryError('corrupt', 'nested namespace page');
    };
    if (this.root) {
      const root = this.page(this.root);
      if (!('namespaces' in root)) throw new MemoryError('corrupt', 'invalid state root');
      const children = prefix.includes(':')
        ? [root.namespaces[this.namespace(prefix)]].filter((id): id is string => !!id)
        : Object.values(root.namespaces);
      for (const child of children) yield* visit(this, child);
    }
  }
  owned(): Record<string, Page> {
    const result: Record<string, Page> = {};
    const visit = (id: string) => {
      const page = this.pending.get(id);
      if (!page || result[id]) return;
      result[id] = page;
      if ('branches' in page) Object.values(page.branches).forEach(visit);
      if ('namespaces' in page) Object.values(page.namespaces).forEach(visit);
    };
    if (this.root) visit(this.root);
    for (const root of this.retained) visit(root);
    return result;
  }
  prune() {
    const reachable = this.owned();
    this.pending.clear();
    this.pendingBytes = 0;
    for (const [id, page] of Object.entries(reachable)) {
      this.pending.set(id, page);
      this.pendingBytes += Buffer.byteLength(json(page));
    }
  }
  clearPending() {
    this.pending.clear();
    this.pendingBytes = 0;
    this.retained.clear();
  }
  checkpoint() {
    return {
      root: this.root,
      pending: new Map(this.pending),
      bytes: this.pendingBytes,
      retained: new Set(this.retained),
    };
  }
  restore(point: ReturnType<StateMap['checkpoint']>) {
    this.root = point.root;
    this.pending.clear();
    for (const [k, v] of point.pending) this.pending.set(k, v);
    this.pendingBytes = point.bytes;
    this.retained = new Set(point.retained);
  }
}
export function validatePage(value: unknown): Page {
  if (!value || typeof value !== 'object') throw new MemoryError('corrupt', 'invalid state page');
  const p = value as Page;
  if (
    ('branches' in p &&
      p.branches &&
      Object.values(p.branches).every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) ||
    ('values' in p && p.values && typeof p.values === 'object') ||
    ('namespaces' in p &&
      p.namespaces &&
      Object.values(p.namespaces).every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)))
  )
    return p;
  throw new MemoryError('corrupt', 'invalid state page');
}
