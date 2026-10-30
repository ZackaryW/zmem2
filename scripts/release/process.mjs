import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

export function run(command, args, options = {}) {
  return execFileSync(command, args, {
    maxBuffer: 128 * 1024 * 1024,
    timeout: 180000,
    windowsHide: true,
    stdio: 'pipe',
    ...options,
  });
}

// Invoke npm's JS entry point, avoiding a second shell/quoting boundary on Windows.
export function npm(args, options = {}) {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(realpathSync(process.execPath)), '../lib/node_modules/npm/bin/npm-cli.js'),
    join(dirname(realpathSync(process.execPath)), 'node_modules/npm/bin/npm-cli.js'),
  ];
  const cli = candidates.find((p) => p && p.endsWith('npm-cli.js') && existsSync(p));
  if (!cli) throw new Error('Cannot locate npm-cli.js; run this helper through npm exec -- node');
  return run(process.execPath, [cli, ...args], options);
}

export function temporary(prefix = 'zmem npm ') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  return {
    root,
    dispose() {
      // Only this freshly allocated root is eligible for recursive cleanup.
      if (realpathSync(root) !== root || dirname(root) !== realpathSync(tmpdir()))
        throw new Error('Temporary root changed before cleanup');
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

export function consumerEnv(root) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(npm_|node_|zmem_|gh_token$|github_token$|actions_id_token_|git_config|git_dir$|git_work_tree$)/i.test(
          key,
        ),
    ),
  );
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  writeFileSync(join(root, 'npmrc'), '');
  writeFileSync(join(root, 'global-npmrc'), '');
  writeFileSync(join(root, 'gitconfig'), '');
  return {
    ...env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
    npm_config_userconfig: join(root, 'npmrc'),
    npm_config_globalconfig: join(root, 'global-npmrc'),
    npm_config_cache: join(root, 'cache'),
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
  };
}

export function binDirectory(prefix) {
  return process.platform === 'win32' ? prefix : join(prefix, 'bin');
}

export function launcher(prefix, args, options = {}, kind = 'default') {
  const env = {
    ...options.env,
    PATH: `${binDirectory(prefix)}${delimiter}${options.env?.PATH ?? process.env.PATH}`,
  };
  if (process.platform !== 'win32') return run('zmem', args, { ...options, env });
  if (kind === 'powershell') {
    env.ZMEM_LAUNCH = JSON.stringify({ executable: join(prefix, 'zmem.ps1'), args });
    const script =
      '$v = $env:ZMEM_LAUNCH | ConvertFrom-Json; if ((Get-Command zmem -ErrorAction Stop).Source -ne $v.executable) { throw "Unexpected zmem on PATH" }; $a = @($v.args); & zmem @a; exit $LASTEXITCODE';
    return run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { ...options, env },
    );
  }
  // Values are expanded once inside quotes, with delayed expansion disabled.
  // Reject quotes/newlines rather than allowing cmd to reinterpret arguments.
  const values = [resolve(prefix, 'zmem.cmd'), ...args];
  for (const [i, value] of values.entries()) {
    if (/["\r\n\0]/.test(value)) throw new Error('Unsupported quote or newline in cmd argument');
    env[`ZMEM_CMD_${i}`] = value;
  }
  const command = values.map((_, i) => `"%ZMEM_CMD_${i}%"`).join(' ');
  return run('cmd.exe', ['/d', '/v:off', '/s', '/c', `"${command}"`], {
    ...options,
    env,
    windowsVerbatimArguments: true,
  });
}
