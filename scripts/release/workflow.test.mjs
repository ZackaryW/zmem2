import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = (name) =>
  parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

test('ordinary and reusable CI retain all required source validations', () => {
  const ci = workflow('test');
  for (const event of ['push', 'pull_request', 'workflow_dispatch', 'workflow_call'])
    assert.ok(event in ci.on);
  assert.deepEqual(ci.jobs.test.strategy.matrix, {
    os: ['windows-latest', 'ubuntu-latest', 'macos-latest'],
    node: [24, 26],
  });
  assert.equal(ci.jobs.test.strategy['fail-fast'], false);
  assert.deepEqual(
    ci.jobs.test.steps.filter((s) => s.run).map((s) => s.run),
    [
      'npm ci --ignore-scripts',
      'npm run typecheck',
      'npm run format:check',
      'npm test',
      'npm pack --ignore-scripts',
    ],
  );
  const checkout = ci.jobs.test.steps.find((s) => s.uses?.startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, '${{ inputs.source_sha || github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(ci.permissions.contents, 'read');
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
