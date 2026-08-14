import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const repositoryRoot = process.cwd();

test('final image source pins the approved runtime and preserves the runtime-only contract', async () => {
  const dockerfile = await read('Dockerfile');
  const dockerignore = await read('.dockerignore');

  assert.match(
    dockerfile,
    /^ARG NODE_IMAGE=node:24\.19\.0-bookworm-slim@sha256:[a-f0-9]{64}$/mu,
  );
  assert.equal([...dockerfile.matchAll(/^FROM /gmu)].length, 3);
  assert.equal([...dockerfile.matchAll(/^FROM \$\{NODE_IMAGE\}/gmu)].length, 3);
  assert.match(dockerfile, /^FROM \$\{NODE_IMAGE\} AS build$/mu);
  assert.match(
    dockerfile,
    /^FROM \$\{NODE_IMAGE\} AS production-dependencies$/mu,
  );
  assert.match(dockerfile, /^FROM \$\{NODE_IMAGE\} AS runtime$/mu);
  assert.match(dockerfile, /dumb-init=1\.2\.5-2/u);
  assert.match(dockerfile, /^USER node$/mu);
  assert.match(dockerfile, /^ENTRYPOINT \["\/usr\/bin\/dumb-init", "--"\]$/mu);
  assert.match(dockerfile, /^CMD \["node", "dist\/main\.js"\]$/mu);
  assert.doesNotMatch(dockerfile, /^HEALTHCHECK\b/imu);
  assert.doesNotMatch(dockerfile, /COPY\s+\.\s+/u);

  for (const excluded of ['.git', '.env', 'node_modules', 'test']) {
    assert.match(dockerignore, new RegExp(`^${escapeRegex(excluded)}`, 'mu'));
  }
});

test('every external workflow action is SHA-pinned with a nearby release version', async () => {
  const workflowDirectory = path.join(repositoryRoot, '.github', 'workflows');
  const workflowNames = (await readdir(workflowDirectory)).filter((name) =>
    name.endsWith('.yml'),
  );
  assert.deepEqual(workflowNames.toSorted(), [
    'ci.yml',
    'codeql.yml',
    'container-security.yml',
    'dependency-review.yml',
  ]);

  for (const workflowName of workflowNames) {
    const workflow = await read(
      path.join('.github', 'workflows', workflowName),
    );
    assert.doesNotMatch(workflow, /pull_request_target/u, workflowName);
    assert.doesNotMatch(workflow, /write-all/u, workflowName);

    const actionLines = workflow
      .split(/\r?\n/u)
      .filter((line) => /^\s*uses:/u.test(line));
    assert.ok(actionLines.length > 0, workflowName);

    for (const line of actionLines) {
      assert.match(
        line,
        /^\s*uses: [\w.-]+\/[\w./-]+@[a-f0-9]{40} # v\d+\.\d+\.\d+$/u,
        `${workflowName}: ${line}`,
      );
    }
  }
});

test('CI and dependency automation cover the complete frozen verification surface', async () => {
  const ci = await read('.github/workflows/ci.yml');
  const requiredCommands = [
    'npm ci',
    'npm run format:check',
    'npm run lint',
    'npm run typecheck',
    'npm run build',
    'npm run test:unit',
    'npm run test:integration',
    'npm run test:e2e',
    'npm run test:process',
    'npm run test:container',
  ];

  for (const command of requiredCommands) {
    assert.match(ci, new RegExp(`- run: ${escapeRegex(command)}$`, 'mu'));
  }

  const dependabot = await read('.github/dependabot.yml');
  assert.deepEqual(
    [...dependabot.matchAll(/package-ecosystem: ([\w-]+)/gu)]
      .map((match) => match[1])
      .toSorted(),
    ['docker', 'github-actions', 'npm'],
  );
  assert.equal([...dependabot.matchAll(/^\s+directory: \/$/gmu)].length, 3);
});

test('Trivy reports every severe finding and blocks only fixable severe findings', async () => {
  const workflow = await read('.github/workflows/container-security.yml');

  assert.match(workflow, /name: Report all HIGH and CRITICAL findings/u);
  assert.match(
    workflow,
    /severity: HIGH,CRITICAL\s+ignore-unfixed: false\s+exit-code: 0/u,
  );
  assert.match(workflow, /name: Block fixable HIGH and CRITICAL findings/u);
  assert.match(
    workflow,
    /severity: HIGH,CRITICAL\s+ignore-unfixed: true\s+exit-code: 1/u,
  );
  assert.equal(await exists('.trivyignore'), false);
  assert.equal(await exists('.trivyignore.yaml'), false);
});

test('repository secret controls retain placeholders while excluding local environments', async () => {
  const gitignore = await read('.gitignore');
  const dockerignore = await read('.dockerignore');
  const example = await read('.env.example');
  const security = await read('docs/security.md');
  const packageJson = JSON.parse(await read('package.json'));

  assert.match(gitignore, /^\.env$/mu);
  assert.match(gitignore, /^\.env\.\*$/mu);
  assert.match(gitignore, /^!\.env\.example$/mu);
  assert.match(dockerignore, /^\.env$/mu);
  assert.match(dockerignore, /^\.env\.\*$/mu);
  assert.match(example, /replace-me/u);
  assert.doesNotMatch(example, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u);
  assert.match(
    security,
    /Secret scanning push protection \| Yes\s+\| Enabled/u,
  );

  const dependencyNames = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  for (const forbidden of [
    '@nestjs/jwt',
    '@nestjs/passport',
    'jsonwebtoken',
    'passport',
  ]) {
    assert.equal(dependencyNames.has(forbidden), false, forbidden);
  }
});

async function read(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

async function exists(relativePath) {
  try {
    await read(relativePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
