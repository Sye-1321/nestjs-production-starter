import { spawn } from 'node:child_process';
import process from 'node:process';

const image = `nestjs-production-starter:container-test-${String(process.pid)}`;

try {
  await run('docker', ['buildx', 'build', '--load', '--tag', image, '.']);

  await run(process.execPath, ['--test', 'test/container/*.test.mjs'], {
    ...process.env,
    CONTAINER_TEST_IMAGE: image,
  });
} finally {
  await run('docker', ['image', 'rm', '--force', image], process.env, true);
}

function run(
  command,
  arguments_,
  environment = process.env,
  bestEffort = false,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: environment,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });

    child.once('error', (error) => {
      if (bestEffort) {
        resolve();
        return;
      }

      reject(error);
    });

    child.once('exit', (code, signal) => {
      if (code === 0 || bestEffort) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} exited with ${String(code)} (${signal ?? 'no signal'})`,
        ),
      );
    });
  });
}
