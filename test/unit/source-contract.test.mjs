import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src');
const SHUTDOWN_COORDINATOR = path.join(
  SOURCE_ROOT,
  'bootstrap',
  'shutdown-coordinator.ts',
);

async function productionSources(directory = SOURCE_ROOT) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await productionSources(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

test('production source does not enable Nest shutdown hooks', async () => {
  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(
      source.includes('enableShutdownHooks('),
      false,
      `${path.relative(REPOSITORY_ROOT, sourcePath)} must not call enableShutdownHooks()`,
    );
  }
});

test('production source does not use successful process.exit(0)', async () => {
  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(
      /process\.exit\(\s*0\s*\)/u.test(source),
      false,
      `${path.relative(REPOSITORY_ROOT, sourcePath)} must not call process.exit(0)`,
    );
  }
});

test('ShutdownCoordinator is the only production SIGTERM/SIGINT listener owner', async () => {
  const listenerPattern =
    /process\.(?:on|once|addListener|prependListener|prependOnceListener)\(\s*['"](SIGTERM|SIGINT)['"]/gu;
  const owners = [];

  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    const signals = [...source.matchAll(listenerPattern)].map(
      (match) => match[1],
    );

    if (signals.length > 0) {
      owners.push({ sourcePath, signals });
    }
  }

  assert.equal(owners.length, 1);
  assert.equal(owners[0].sourcePath, SHUTDOWN_COORDINATOR);
  assert.deepEqual(owners[0].signals.sort(), ['SIGINT', 'SIGTERM']);
});

test('main is the only startup-failure logging owner', async () => {
  const callPattern = /\.startupFailed\(/gu;
  const callOwners = [];

  for (const sourcePath of await productionSources()) {
    if (sourcePath.endsWith('bootstrap-logger.ts')) {
      continue;
    }

    const source = await readFile(sourcePath, 'utf8');
    if (callPattern.test(source)) {
      callOwners.push(
        path.relative(REPOSITORY_ROOT, sourcePath).split(path.sep).join('/'),
      );
    }
    callPattern.lastIndex = 0;
  }

  assert.deepEqual(callOwners, ['src/main.ts']);
});

test('production source does not install an uncaughtException continuation handler', async () => {
  for (const sourcePath of await productionSources()) {
    const source = await readFile(sourcePath, 'utf8');
    assert.equal(
      /process\.(?:on|once|addListener|prependListener|prependOnceListener)\(\s*['"]uncaughtException['"]/u.test(
        source,
      ),
      false,
      `${path.relative(REPOSITORY_ROOT, sourcePath)} must not own uncaughtException continuation`,
    );
  }
});
