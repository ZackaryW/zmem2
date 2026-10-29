import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = (name) =>
  parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

test('routine CI has four test jobs and release CI retains all six OS/runtime pairs', () => {
  const ci = workflow('test');
  assert.deepEqual(Object.keys(ci.jobs), ['test']);
  const matrix = ci.jobs.test.strategy.matrix;
  // Decode the two JSON branches, then expand the actual matrix for each mode.
  const branches = matrix.exclude.match(
    /^\$\{\{ fromJSON\(inputs\.source_sha && '([^']+)' \|\| '([^']+)'\) \}\}$/,
  );
  assert.ok(branches, 'matrix exclusions must depend on the selected source SHA');
  const expand = (excluded) =>
    matrix.os.flatMap((os) =>
      matrix.node
        .map((node) => ({ os, node }))
        .filter(
          (pair) =>
            !excluded.some((entry) =>
              Object.entries(entry).every(([key, value]) => pair[key] === value),
            ),
        ),
    );
  assert.deepEqual(expand(JSON.parse(branches[2])), [
    { os: 'windows-latest', node: 24 },
    { os: 'ubuntu-latest', node: 24 },
    { os: 'ubuntu-latest', node: 26 },
    { os: 'macos-latest', node: 24 },
  ]);
  assert.deepEqual(
    expand(JSON.parse(branches[1])),
    ['windows-latest', 'ubuntu-latest', 'macos-latest'].flatMap((os) =>
      [24, 26].map((node) => ({ os, node })),
    ),
  );
  assert.equal(ci.jobs.test.strategy['fail-fast'], false);
  assert.equal(ci.jobs.test['continue-on-error'], undefined);
  const install = ci.jobs.test.steps.find((s) => s.run === 'npm ci --ignore-scripts');
  assert.ok(install);
  assert.equal(install.if, undefined);
  const checkout = ci.jobs.test.steps.find((s) => s.uses?.startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, '${{ inputs.source_sha || github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(ci.permissions.contents, 'read');
});

test('routine CI runs the full suite once and CLI smoke elsewhere while releases always run full tests', () => {
  const steps = workflow('test').jobs.test.steps;
  assert.equal(
    steps.find((s) => s.run === 'npm test').if,
    "${{ inputs.source_sha || (matrix.os == 'ubuntu-latest' && matrix.node == 24) }}",
  );
  assert.equal(
    steps.find((s) => s.run === 'npm run test:smoke').if,
    "${{ !inputs.source_sha && (matrix.os != 'ubuntu-latest' || matrix.node != 24) }}",
  );
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(
    pkg.scripts['test:smoke'],
    'npm run build && node --test dist/tests/cli-entrypoint.test.js dist/tests/background-cli.test.js',
  );
});

test('shared checks run once alongside Linux Node 24 tests', () => {
  const ci = workflow('test');
  assert.deepEqual(
    ci.jobs.test.steps.filter((s) => s.run).map((s) => s.run),
    [
      'npm ci --ignore-scripts',
      'npm run format:check',
      'npm test',
      'npm run test:smoke',
      'npm pack --ignore-scripts',
      'npm run test:release',
    ],
  );
  for (const command of ['npm run format:check', 'npm pack --ignore-scripts'])
    assert.equal(
      ci.jobs.test.steps.find((s) => s.run === command).if,
      "${{ matrix.os == 'ubuntu-latest' && matrix.node == 24 }}",
    );
  assert.equal(
    ci.jobs.test.steps.find((s) => s.run === 'npm run test:release').if,
    "${{ !inputs.source_sha && matrix.os == 'ubuntu-latest' && matrix.node == 24 }}",
  );
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts.test, /^npm run build && /);
  assert.equal(pkg.scripts.build, 'tsc');
  assert.ok(workflow('release').jobs.prepare.steps.some((s) => s.run === 'npm run test:release'));
});

test('routine runs target main pushes and PRs and cancel stale work without cancelling releases', () => {
  const ci = workflow('test');
  assert.deepEqual(Object.keys(ci.on).sort(), [
    'pull_request',
    'push',
    'workflow_call',
    'workflow_dispatch',
  ]);
  assert.deepEqual(ci.on.push, { branches: ['main'] });
  assert.equal(ci.on.pull_request, null);
  assert.equal(ci.concurrency['cancel-in-progress'], '${{ !inputs.source_sha }}');
  assert.equal(
    ci.concurrency.group,
    '${{ github.workflow }}-${{ inputs.source_sha && github.run_id || github.event.pull_request.number || github.ref }}',
  );
});

test('release publishes only after all required gates and explicit default-branch selection', () => {
  const release = workflow('release');
  assert.deepEqual(Object.keys(release.on), ['workflow_dispatch']);
  assert.equal(release.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(release.on.workflow_dispatch.inputs.source_sha.required, true);
  const guard = release.jobs.prepare.steps.find((step) => step.run?.includes('check-ref'));
  assert.equal(guard.if, '${{ inputs.publish }}');
  assert.deepEqual(release.jobs.publish.needs, ['prepare', 'validate', 'archive-consumer']);
  const condition = release.jobs.publish.if;
  assert.match(condition, /inputs.publish/);
  assert.match(
    condition,
    /github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)/,
  );
  for (const gate of release.jobs.publish.needs)
    assert.ok(condition.includes(`needs.${gate}.result == 'success'`));
  assert.ok(!condition.includes('always()'));
  assert.equal(release.jobs.validate.uses, './.github/workflows/test.yml');
  assert.equal(release.jobs.validate.with.source_sha, '${{ needs.prepare.outputs.source_sha }}');
});

test('release-write access is confined to publication without candidate execution', () => {
  const release = workflow('release');
  assert.equal(release.permissions.contents, 'read');
  for (const [name, job] of Object.entries(release.jobs)) {
    assert.equal(
      job.permissions?.contents ?? release.permissions.contents,
      name === 'publish' ? 'write' : 'read',
    );
    assert.ok(!job['continue-on-error']);
  }
  const publisher = release.jobs.publish;
  assert.equal(publisher.concurrency['cancel-in-progress'], false);
  const commands = publisher.steps
    .filter((s) => s.run)
    .map((s) => s.run)
    .join('\n');
  assert.ok(!/npm|consume/.test(commands));
  assert.match(commands, /publish --publish/);
  assert.equal(
    publisher.steps.find((s) => s.uses?.startsWith('actions/checkout')).with.ref,
    '${{ github.sha }}',
  );
  for (const name of ['prepare', 'archive-consumer', 'publish']) {
    const artifact = release.jobs[name].steps.find((s) =>
      /actions\/(upload|download)-artifact/.test(s.uses ?? ''),
    );
    assert.equal(artifact.with.name, 'release-assets');
    assert.equal(artifact.with['run-id'], undefined);
  }
  const publishStep = publisher.steps.find((s) => s.run);
  assert.equal(publishStep.env.ARCHIVE_SHA256, '${{ needs.prepare.outputs.archive_sha256 }}');
  assert.match(publishStep.run, /--archive-sha256/);
});
