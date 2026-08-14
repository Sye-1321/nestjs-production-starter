import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const image = process.env.CONTAINER_TEST_IMAGE;

if (image === undefined || image === '') {
  throw new Error('CONTAINER_TEST_IMAGE is required');
}

test('final image is non-root, signal-correct, and contains runtime material only', async () => {
  const configuration = await inspectImage(image);

  assert.equal(configuration.User, 'node');
  assert.deepEqual(configuration.Entrypoint, ['/usr/bin/dumb-init', '--']);
  assert.deepEqual(configuration.Cmd, ['node', 'dist/main.js']);
  assert.equal(configuration.WorkingDir, '/app');
  assert.equal(configuration.Healthcheck, undefined);

  assert.equal(await runInImage(['node', '--version']), 'v24.19.0');
  assert.equal(await runInImage(['id', '-u']), '1000');
  assert.equal(await runInImage(['id', '-g']), '1000');
  assert.match(
    await runInImage(['/usr/bin/dumb-init', '--version']),
    /dumb-init v1\.2\.5/u,
  );

  const forbiddenMaterial = await runInImage([
    'sh',
    '-c',
    [
      "find /app/dist -type f -name '*.map' -print",
      'for path in /app/src /app/test /app/.git /app/.env /app/.env.local /app/node_modules/typescript /app/node_modules/eslint /app/node_modules/prisma /app/node_modules/@nestjs/cli /app/node_modules/testcontainers; do [ ! -e "$path" ] || printf \'%s\\n\' "$path"; done',
    ].join('; '),
  ]);

  assert.equal(forbiddenMaterial, '');
  assert.equal(
    await runInImage([
      'node',
      '--input-type=module',
      '--eval',
      "await import('./dist/app.module.js')",
    ]),
    '',
  );
});

async function inspectImage(name) {
  const { stdout } = await execFileAsync('docker', ['image', 'inspect', name]);
  const inspected = JSON.parse(stdout);
  const first = inspected[0];

  assert.ok(first?.Config);
  return first.Config;
}

async function runInImage(command) {
  const { stdout, stderr } = await execFileAsync('docker', [
    'run',
    '--rm',
    '--entrypoint',
    command[0],
    image,
    ...command.slice(1),
  ]);

  return `${stdout}${stderr}`.trim();
}
