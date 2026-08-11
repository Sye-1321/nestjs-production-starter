import { spawn } from 'node:child_process';
import { request } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout as scheduleTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
export const MAIN_ENTRY = path.join(REPOSITORY_ROOT, 'dist', 'main.js');
export const BOOTING_FIXTURE = path.join(
  REPOSITORY_ROOT,
  'test',
  'process',
  'support',
  'booting-fixture.mjs',
);

export const STARTUP_WAIT_MS = 20_000;
export const EXIT_WAIT_MS = 10_000;
export const TEST_SHUTDOWN_TIMEOUT_MS = 1_000;
export const SHUTDOWN_TOLERANCE_MS = 2_000;
export const BOOTING_MARKER_WAIT_MS = 10_000;

const OUTPUT_LIMIT = 64 * 1024;
const POLL_INTERVAL_MS = 10;
const PORT_POLL_INTERVAL_MS = 1;
const CONNECT_TIMEOUT_MS = 100;
const HTTP_TIMEOUT_MS = 500;
const CLEANUP_WAIT_MS = 500;

export async function getAvailablePort() {
  const server = net.createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unable to determine allocated process-test port');
  }

  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });

  return address.port;
}

export function validEnvironment(port, overrides = {}) {
  const applicationEnvironment = {
    NODE_ENV: 'test',
    PORT: String(port),
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://127.0.0.1:1/m1_process_test',
    DB_POOL_MAX: '10',
    DB_ACQUIRE_TIMEOUT_MS: '1000',
    DB_STATEMENT_TIMEOUT_MS: '3000',
    SHUTDOWN_TIMEOUT_MS: String(TEST_SHUTDOWN_TIMEOUT_MS),
    ...overrides,
  };

  const hostEnvironment =
    process.platform === 'win32'
      ? {
          SystemRoot: process.env.SystemRoot,
          ComSpec: process.env.ComSpec,
          TEMP: process.env.TEMP,
          TMP: process.env.TMP,
        }
      : {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
        };

  return Object.fromEntries(
    Object.entries({
      ...hostEnvironment,
      ...applicationEnvironment,
    }).filter(([, value]) => value !== undefined),
  );
}

export function spawnEntry(entry, environment) {
  const child = spawn(process.execPath, [entry], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.once('error', (error) => {
    output += `PROCESS_TEST_CHILD_SPAWN_ERROR:${error.message}\n`;
  });
  let output = '';
  let outputExceededLimit = false;

  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      if (output.length + chunk.length > OUTPUT_LIMIT) {
        outputExceededLimit = true;
        return;
      }

      output += chunk;
    });
  }

  return {
    child,
    output: () => {
      if (outputExceededLimit) {
        throw new Error('Child output exceeded the process-test capture limit');
      }

      return output;
    },
  };
}

export function registerChildCleanup(t, child) {
  t.after(async () => {
    if (hasExited(child)) {
      return;
    }

    child.kill('SIGTERM');

    try {
      await waitForExit(child, CLEANUP_WAIT_MS);
      return;
    } catch {
      // Harness-only escalation for a stuck child.
    }

    if (!hasExited(child)) {
      child.kill('SIGKILL');
    }

    try {
      await waitForExit(child, CLEANUP_WAIT_MS);
    } catch {
      // Preserve the original test failure.
    }
  });
}

export function waitForExit(
  child,
  timeoutMs = EXIT_WAIT_MS,
  output = () => '',
) {
  if (hasExited(child) && child.stdout.closed && child.stderr.closed) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    const onClose = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };

    const timer = scheduleTimeout(() => {
      child.off('close', onClose);
      reject(
        new Error(
          [
            `Child did not exit within ${String(timeoutMs)} ms`,
            `exitCode=${String(child.exitCode)}`,
            `signalCode=${String(child.signalCode)}`,
            `capturedOutput=${JSON.stringify(output())}`,
          ].join('; '),
        ),
      );
    }, timeoutMs);

    child.once('close', onClose);

    if (hasExited(child) && child.stdout.closed && child.stderr.closed) {
      child.off('close', onClose);
      onClose(child.exitCode, child.signalCode);
    }
  });
}

export function requestPath(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
        agent: false,
      },
      (response) => {
        response.setEncoding('utf8');
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, body });
        });
      },
    );

    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error('Process-test HTTP request timed out'));
    });
    req.once('error', reject);
    req.end();
  });
}

export async function waitForStatus(
  port,
  pathname,
  statusCode,
  timeoutMs = STARTUP_WAIT_MS,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await requestPath(port, pathname);
      if (response.statusCode === statusCode) {
        return response;
      }
    } catch {
      // Listener may not be ready yet.
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `${pathname} did not return ${String(statusCode)} within ${String(timeoutMs)} ms`,
  );
}

export function startPortMonitor(port) {
  let stopped = false;
  let reachable = false;

  const done = (async () => {
    while (!stopped) {
      reachable ||= await canConnect(port);
      await delay(PORT_POLL_INTERVAL_MS);
    }
  })();

  return {
    wasReachable: () => reachable,
    async stop() {
      stopped = true;
      await done;
      return reachable;
    },
  };
}

export async function waitForPortClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!(await canConnect(port))) {
      return;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Port remained reachable for ${String(timeoutMs)} ms`);
}

export async function waitForOutput(output, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (output().includes(marker)) {
      return;
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error('Child did not emit expected process-test marker');
}

export function structuredEvents(output, eventName) {
  return output.split(/\r?\n/u).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value?.event === eventName ? [value] : [];
    } catch {
      return [];
    }
  });
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function canConnect(port) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (connected) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
