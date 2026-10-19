import {
  readFileSync,
  realpathSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  MemoryError,
  identity,
  type Surface,
  type Handler,
  type Hook,
} from '../../core/contracts.js';
import { readYaml, type RepoConfig } from '../../core/config.js';
import { builtins } from '../builtin/index.js';
import { entry } from '../dsl/entry.js';
import { parse as importsOf } from 'es-module-lexer/minimal/js';
import { validateDefinitions, execute, type Definition } from '../dsl/index.js';
import { freeze } from './context.js';

const Manifest = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    api_version: z.literal(1).default(1),
    entry: z.string().optional(),
    deterministic: z.boolean().default(false),
    inputs: z.record(z.string(), z.unknown()).default({}),
    types: z
      .record(
        z.string(),
        z
          .object({
            kind: z.enum(['entry', 'operation']),
            content: z.literal('required').optional(),
            default_score: z.number().min(0).max(1).default(1),
            handler: z.string().optional(),
            target: z.unknown().optional(),
            operations: z.array(z.record(z.string(), z.unknown())).optional(),
          })
          .strict()
          .refine((v) => !(v.handler && v.operations), 'choose operations or handler'),
      )
      .default({}),
  })
  .strict();
function files(root: string): [string, string][] {
  return readdirSync(root, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((item) => {
      const path = join(root, item.name);
      if (item.isSymbolicLink())
        throw new MemoryError('extension', 'symlinks in extension packages are not supported');
      return item.isDirectory()
        ? files(path).map(([name, body]) => [`${item.name}/${name}`, body] as [string, string])
        : [[item.name, readFileSync(path).toString('base64')]];
    });
}
export function surface(
  repo: string,
  home: string,
  config: RepoConfig,
  trusted: boolean,
  session = 'standalone',
): Surface {
  const packages = config.extensions.map((spec) => {
    const root = realpathSync(
      'path' in spec
        ? resolve(repo, '.zmem', spec.path)
        : join(home, 'extensions', spec.id, spec.version),
    );
    const manifest = Manifest.parse(readYaml(join(root, 'extension.yaml')));
    if ('id' in spec && (spec.id !== manifest.id || spec.version !== manifest.version))
      throw new MemoryError('extension', 'installed package identity mismatch');
    if (manifest.entry) {
      const target = realpathSync(resolve(root, manifest.entry));
      if (relative(root, target).startsWith(`..${sep}`) || relative(root, target) === '..')
        throw new MemoryError('extension', 'entry is outside extension package');
      if ('path' in spec && !trusted)
        throw new MemoryError(
          'untrusted_extension',
          `Trust executable extension ${manifest.id} before loading`,
        );
    }
    const content = files(root);
    let closed = true;
    for (const [name, bytes] of content.filter(([name]) => /\.[cm]?js$/.test(name))) {
      const source = Buffer.from(bytes, 'base64').toString('utf8');
      if (
        /\b(?:process|globalThis|Date|fetch|require|eval|Function|performance|crypto)\b|Math\s*\.\s*random/.test(
          source,
        )
      )
        closed = false;
      for (const dependency of importsOf(source, name)[0]) {
        if (dependency.d !== -1 || !dependency.n?.startsWith('.')) {
          closed = false;
          continue;
        }
        const destination = resolve(root, name, '..', dependency.n);
        if (relative(root, destination).startsWith('..') || !existsSync(destination))
          closed = false;
      }
    }
    for (const type of Object.values(manifest.types))
      if (type.operations) validateDefinitions(type.operations as Definition[]);
    return {
      root,
      manifest,
      content,
      closed,
      inputs: freeze(structuredClone({ ...manifest.inputs, ...spec.inputs })),
    };
  });
  const ids = new Set<string>();
  const types = new Set(['DECISION', 'LESSON_LEARNT', 'DECAY', 'CANCEL', 'META']);
  for (const { manifest } of packages) {
    if (ids.has(manifest.id)) throw new MemoryError('extension', 'duplicate extension package');
    ids.add(manifest.id);
    for (const type of Object.keys(manifest.types)) {
      if (types.has(type)) throw new MemoryError('extension', `duplicate type: ${type}`);
      types.add(type);
    }
  }
  const shareable = packages.every(
    (p) => !p.manifest.entry || (p.manifest.deterministic && p.closed),
  );
  const id = identity({
    builtin: 1,
    packages: packages.map((p) => ({ manifest: p.manifest, content: p.content, inputs: p.inputs })),
    ...(packages.some((p) => p.manifest.entry) ? { node: process.versions.node } : {}),
    ...(!shareable ? { session } : {}),
  });
  const handlers = builtins();
  const hooks = new Map<string, Hook>();
  let loaded = false;
  const result: Surface = {
    id,
    handlers,
    hooks,
    shareable,
    async load() {
      if (loaded) return;
      for (const p of packages) {
        for (const [type, definition] of Object.entries(p.manifest.types)) {
          if (definition.operations)
            handlers.set(type, {
              expand: (c) =>
                execute(
                  definition.operations as Definition[],
                  Object.freeze({ ...c, inputs: p.inputs }),
                ),
            });
          else if (definition.kind === 'entry' && !definition.handler)
            handlers.set(type, {
              expand: (c) => c.emit(entry(type, c.annotation.content, definition.default_score)),
            });
        }
        if (p.manifest.entry) {
          // Execute a captured package generation so Node's dependency module cache
          // cannot run old imports under a new source fingerprint.
          const captured = join(
            home,
            'v2',
            'extensions',
            identity({ surface: id, package: p.manifest.id }),
          );
          for (const [name, body] of p.content) {
            const destination = resolve(captured, name);
            mkdirSync(resolve(destination, '..'), { recursive: true });
            const bytes = Buffer.from(body, 'base64');
            if (existsSync(destination)) {
              if (!readFileSync(destination).equals(bytes))
                throw new MemoryError('corrupt', 'captured extension generation was modified');
            } else writeFileSync(destination, bytes, { flag: 'wx' });
          }
          const module = await import(pathToFileURL(resolve(captured, p.manifest.entry)).href);
          if (typeof module.register !== 'function')
            throw new MemoryError('extension', 'entry must export register(registry)');
          const registry = {
            extend(type: string, handler: Handler) {
              if (
                handlers.has(type) ||
                !p.manifest.types[type] ||
                typeof handler.expand !== 'function'
              )
                throw new MemoryError('extension', `invalid or duplicate handler: ${type}`);
              handlers.set(type, {
                expand: (ctx) => handler.expand(Object.freeze({ ...ctx, inputs: p.inputs })),
              });
            },
            afterIndex(name: string, hook: Hook) {
              const key = `${p.manifest.id}:${identity({ manifest: p.manifest, content: p.content, inputs: p.inputs })}:${name}`;
              if (hooks.has(key) || typeof hook !== 'function')
                throw new MemoryError('extension', 'invalid hook');
              hooks.set(key, hook);
            },
          };
          const returned = await module.register(registry);
          if (returned !== undefined)
            throw new MemoryError('extension', 'register must return nothing');
        }
        for (const type of Object.keys(p.manifest.types))
          if (!handlers.has(type))
            throw new MemoryError('extension', `handler not registered: ${type}`);
      }
      loaded = true;
    },
  };
  return result;
}
