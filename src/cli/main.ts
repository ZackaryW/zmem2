#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { pathToFileURL } from 'node:url';
import { MemoryEngine, type QueryOptions } from '../core/engine.js';
import { MemoryError } from '../core/contracts.js';
import { configuration, UserConfigSchema } from '../core/config.js';

const booleans = new Set([
  'human',
  'help',
  'version',
  'trust-extensions',
  'no-trust-extensions',
  'include-invalid',
  'deep',
  'require-annotation',
  'conventional',
  'user',
  'force',
  'events',
]);
const strings = new Set([
  'repo',
  'home',
  'ref',
  'commit-limit',
  'node-limit',
  'limit',
  'min-score',
  'scope',
  'area',
  'event',
  'since',
  'associate',
  'file',
  'max-subject-length',
  'stable-ref',
  'stable-oid',
]);
function argumentsOf(args: string[]) {
  const values: Record<string, string[] | boolean> = {},
    positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    if (token === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [name, ...inline] = token.slice(2).split('=');
    if (booleans.has(name!)) {
      values[name!] = true;
      continue;
    }
    if (!strings.has(name!)) throw new MemoryError('invalid_input', `unknown option: ${name}`);
    const value = inline.length ? inline.join('=') : args[++i];
    if (value === undefined || value.startsWith('--'))
      throw new MemoryError('invalid_input', `missing value: ${name}`);
    const list = values[name!] as string[] | undefined;
    values[name!] = [...(list ?? []), value];
  }
  return { values, positionals };
}
const help = `zmem <command> [options]
Commands: init [path], sync [path], status [path],
          recall, search <text>, show <ref>, links, check,
          config, evict, retry <job-or-hook-key>
Index: index [path] is an alias for sync
Global: --repo PATH --home PATH --ref REF --commit-limit N --node-limit N --human
Init: --associate REPOSITORY_ID --trust-extensions
Config: --user --stable-ref REF | --stable-oid OID
Queries: --event TYPE --scope SCOPE --area PATH --since REF_OR_DATE
         --include-invalid --limit N --min-score N
Check: --file PATH | --stdin [--deep] [--require-annotation]
       [--conventional] [--max-subject-length N]
Use --home or ZMEM_HOME for isolated deployments. JSON is the default output.

Agent use: recall recorded decisions/lessons; search matches literal text;
show inspects an origin. Effects are already computed. Check attention coverage
and current repository evidence before applying memory. Check --file previews
a proposed commit; --deep is an explicit fresh audit. Queries can build missing state.
Guide: docs/agents.md in the installed package; skills/ contains the focused workflows.`;

export async function main(args = process.argv.slice(2)) {
  // --stdin is a source selector, not an option value.
  const stdin = args.includes('--stdin');
  args = args.filter((a) => a !== '--stdin');
  const { values: v, positionals: p } = argumentsOf(args);
  const get = (name: string) => (v[name] as string[] | undefined)?.at(-1);
  const numeric = (name: string) => {
    const raw = get(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new MemoryError('invalid_input', `${name} must be numeric`);
    return n;
  };
  if (v.version) return { product: 'zmem', version: '0.1.0' };
  if (v.help || !p.length) return help;
  const command = p[0]!;
  const acceptsPath = ['init', 'sync', 'index', 'status'].includes(command);
  if (acceptsPath && (p.length > 2 || (p[1] && get('repo'))))
    throw new MemoryError('invalid_input', 'choose one repository path or --repo PATH');
  if (command === 'config' && v.user && !get('stable-ref') && !get('stable-oid'))
    return configuration(resolve(get('repo') ?? '.'), get('home')).user;
  const engine = new MemoryEngine(get('repo') ?? (acceptsPath ? p[1] : undefined) ?? '.', {
    home: get('home'),
    associate: get('associate'),
    trust: v['trust-extensions'] ? true : v['no-trust-extensions'] ? false : undefined,
  });
  const options: QueryOptions = {
    ref: get('ref'),
    commitLimit: numeric('commit-limit'),
    nodeLimit: numeric('node-limit'),
    limit: numeric('limit'),
    minScore: numeric('min-score'),
    event: v.event as string[] | undefined,
    scope: get('scope'),
    areas: v.area as string[] | undefined,
    since: get('since'),
    includeInvalid: !!v['include-invalid'],
    force: !!v.force,
  };
  switch (command) {
    case 'init':
      return { command, ...(await engine.init(options)) };
    case 'sync':
    case 'index': {
      const segment = await engine.sync(options);
      return {
        command,
        segment: segment.id,
        coverage: segment.coverage,
        attention: segment.attention,
        metrics: engine.metrics,
      };
    }
    case 'recall': {
      const result = await engine.recall(options);
      if (v.events) return { ...result, results: [...new Set(result.results.map((e) => e.type))] };
      return result;
    }
    case 'search':
      if (!p[1]) throw new MemoryError('invalid_input', 'search requires text');
      return engine.search(p.slice(1).join(' '), options);
    case 'show':
      if (!p[1]) throw new MemoryError('invalid_input', 'show requires a commit');
      return engine.show(p[1], options);
    case 'links':
      return engine.links(options);
    case 'check': {
      if (Number(!!get('file')) + Number(stdin) !== 1)
        throw new MemoryError('invalid_input', 'check requires exactly one of --file or --stdin');
      const message = readFileSync(stdin ? 0 : resolve(get('file')!), 'utf8');
      return engine.check(message, {
        ...options,
        deep: !!v.deep,
        requireAnnotation: !!v['require-annotation'],
        conventional: !!v.conventional,
        maxSubjectLength: numeric('max-subject-length'),
      });
    }
    case 'status':
      return engine.status();
    case 'config': {
      if (get('stable-ref') && get('stable-oid'))
        throw new MemoryError('invalid_input', 'choose stable-ref or stable-oid');
      if (get('stable-ref') || get('stable-oid')) {
        const config = engine.settings.user;
        config.promotion.stable_boundaries.push({
          repository: engine.registration.repository,
          ...(get('stable-ref') ? { ref: get('stable-ref')! } : { oid: get('stable-oid')! }),
        });
        const valid = UserConfigSchema.safeParse(config);
        if (!valid.success) throw new MemoryError('configuration', valid.error.message);
        writeFileSync(join(engine.settings.home, 'config.yaml'), stringify(config));
      }
      return v.user ? engine.settings.user : engine.settings.repo;
    }
    case 'evict':
      if (!engine.coordinator) throw new MemoryError('unavailable', 'user catalog is unavailable');
      return engine.coordinator.catalog.evict(
        numeric('limit') ?? engine.settings.user.cache.max_bytes,
      );
    case 'retry':
      if (!p[1]) throw new MemoryError('invalid_input', 'retry requires a job or hook key');
      engine.local.retry(p[1]);
      engine.coordinator?.catalog.retry(p[1]);
      return { command, retried: p[1] };
    default:
      throw new MemoryError('invalid_input', `unknown command: ${command}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await main();
    const human = process.argv.includes('--human');
    console.log(
      typeof result === 'string' ? result : JSON.stringify(result, null, human ? 2 : undefined),
    );
    if (typeof result === 'object' && result && 'ok' in result && !result.ok) process.exitCode = 5;
  } catch (error) {
    const e = error instanceof MemoryError ? error : new MemoryError('internal', String(error));
    console.error(JSON.stringify(e));
    process.exitCode =
      e.code === 'invalid_input' || e.code === 'configuration'
        ? 2
        : e.code === 'repository'
          ? 3
          : 4;
  }
}
