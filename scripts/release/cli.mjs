import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  assertPublicationRef,
  prepare,
  releaseSummary,
  requireOutsideRepo,
  verifyAssets,
} from './artifacts.mjs';
import { consume } from './consumer.mjs';
import { GitHubApi } from './github.mjs';
import { publish } from './publish.mjs';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      [
        'repo',
        'source-sha',
        'default-ref',
        'out',
        'dir',
        'version',
        'repository',
        'default-branch',
        'archive-sha256',
      ]
        .map((key) => [key, { type: 'string' }])
        .concat([['publish', { type: 'boolean', default: false }]]),
    ),
  });
  const [command] = positionals;
  const expected = {
    sourceSha: values['source-sha'],
    version: values.version,
    archiveSha256: values['archive-sha256'],
  };
  let result;
  if (command === 'prepare') {
    const repo = values.repo ?? '.';
    requireOutsideRepo(repo, values.out);
    result = prepare({
      repo,
      sourceSha: expected.sourceSha,
      defaultRef: values['default-ref'],
      out: values.out,
    });
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `source_sha=${result.sourceSha}\nversion=${result.version}\ntag=${result.tag}\narchive_sha256=${result.archiveSha256}\n`,
      );
    }
  } else if (command === 'check-ref') {
    assertPublicationRef(process.env.GITHUB_REF, values['default-branch']);
    result = { publicationRef: 'valid' };
  } else if (command === 'verify') {
    result = verifyAssets(values.dir, expected);
  } else if (command === 'consume') {
    result = consume(values.dir, expected);
  } else if (command === 'publish') {
    if (values.publish) assertPublicationRef(process.env.GITHUB_REF, values['default-branch']);
    result = await publish({
      dir: values.dir,
      ...expected,
      repository: values.repository,
      enabled: values.publish,
      api: values.publish ? new GitHubApi(values.repository, process.env.GH_TOKEN) : undefined,
    });
  } else {
    throw new Error('Expected prepare, verify, consume, publish, or check-ref command');
  }
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary =
      result.summary ??
      (result.archive
        ? releaseSummary(result, values.repository ?? process.env.GITHUB_REPOSITORY)
        : JSON.stringify(result));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`text\n${summary}\n\`\`\`\n`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
