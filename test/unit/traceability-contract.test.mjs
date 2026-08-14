import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const repositoryRoot = process.cwd();
const REQUIREMENT_FAMILIES =
  'CFG|BOOT|LIFE|HTTP|ERR|CTX|LOG|HLTH|DB|MET|SEC|CONT|TEST|CI';
const REQUIREMENT_PATTERN = new RegExp(
  `^### ((${REQUIREMENT_FAMILIES})-\\d{3})`,
  'gmu',
);
const TRACE_ROW_PATTERN = new RegExp(
  `^\\|\\s*(?:${REQUIREMENT_FAMILIES})-\\d{3}\\s*\\|`,
  'u',
);

test('traceability maps every frozen requirement once to existing exact evidence', async () => {
  const specification = await read('docs/spec/v1-contract.md');
  const traceability = await read('docs/traceability.md');
  const expectedIds = [...specification.matchAll(REQUIREMENT_PATTERN)].map(
    (match) => match[1],
  );
  const rows = traceability
    .split(/\r?\n/u)
    .filter((line) => TRACE_ROW_PATTERN.test(line))
    .map(parseRow);

  assert.equal(expectedIds.length, 122);
  assert.equal(rows.length, expectedIds.length);
  assert.deepEqual([...new Set(rows.map((row) => row.id))], expectedIds);

  const testSource = (
    await Promise.all(
      (await filesUnder('test')).map((file) => readFile(file, 'utf8')),
    )
  ).join('\n');
  const workflowJobs = await readWorkflowJobs();

  for (const row of rows) {
    assert.equal(row.status, 'PASS', row.id);

    const implementationPaths = [
      ...row.implementation.matchAll(/`([^`]+)`/gu),
    ].map((match) => match[1]);
    assert.ok(implementationPaths.length > 0, row.id);
    for (const implementationPath of implementationPaths) {
      await access(path.join(repositoryRoot, implementationPath));
    }

    const evidenceName = /\u201c([^\u201d]+)\u201d/u.exec(row.evidence)?.[1];
    assert.ok(evidenceName, row.id);
    assert.ok(testSource.includes(evidenceName), `${row.id}: ${evidenceName}`);

    const namedJobs = [...row.jobs.matchAll(/`([^`]+)`/gu)].map(
      (match) => match[1],
    );
    if (namedJobs.length === 0) {
      assert.match(row.jobs, /^(?:Dependabot service|Manual )/u, row.id);
    }
    for (const job of namedJobs) {
      assert.ok(workflowJobs.has(job), `${row.id}: ${job}`);
    }
  }
});

async function read(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

async function filesUnder(relativeDirectory) {
  const directory = path.join(repositoryRoot, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativeTarget = path.join(relativeDirectory, entry.name);
      return entry.isDirectory()
        ? filesUnder(relativeTarget)
        : [path.join(repositoryRoot, relativeTarget)];
    }),
  );

  return files.flat();
}

async function readWorkflowJobs() {
  const workflowDirectory = '.github/workflows';
  const workflowFiles = (await filesUnder(workflowDirectory)).filter((file) =>
    /\.ya?ml$/u.test(file),
  );
  const jobs = new Set();

  for (const workflowFile of workflowFiles) {
    const workflow = await readFile(workflowFile, 'utf8');
    const jobsSection = workflow.split(/^jobs:\s*$/mu)[1];
    assert.ok(jobsSection, workflowFile);
    for (const match of jobsSection.matchAll(
      /^ {2}([a-z][a-z0-9-]+):\s*$/gmu,
    )) {
      jobs.add(match[1]);
    }
  }

  return jobs;
}

function parseRow(line) {
  const columns = line.split('|').map((column) => column.trim());

  return {
    id: columns[1],
    status: columns[2],
    implementation: columns[3],
    evidence: columns[4],
    jobs: columns[5],
  };
}
