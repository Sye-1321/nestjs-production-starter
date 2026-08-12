import assert from 'node:assert/strict';
import test from 'node:test';

import { selectRequestId } from '../../dist/platform/context/request-id.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function requestWithRequestIds(values) {
  return {
    headersDistinct: values === undefined ? {} : { 'x-request-id': values },
  };
}

function assertGeneratedRequestId(values) {
  const requestId = selectRequestId(requestWithRequestIds(values));
  assert.match(requestId, UUID_PATTERN);
  return requestId;
}

test('valid single upstream request IDs are accepted', () => {
  for (const requestId of [
    'request-123',
    'UPSTREAM_ABC',
    'trace.segment:child',
    'a',
    'x'.repeat(64),
  ]) {
    assert.equal(
      selectRequestId(requestWithRequestIds([requestId])),
      requestId,
    );
  }
});

test('invalid upstream request IDs are replaced with generated UUIDs', () => {
  for (const values of [
    undefined,
    [],
    [''],
    ['x'.repeat(65)],
    ['contains space'],
    ['contains,comma'],
    ['contains/slash'],
    ['one', 'two'],
    ['same', 'same'],
  ]) {
    assertGeneratedRequestId(values);
  }
});

test('duplicate request ID field lines are never trusted', () => {
  const distinctDuplicate = assertGeneratedRequestId(['one', 'two']);
  const identicalDuplicate = assertGeneratedRequestId(['same', 'same']);

  assert.notEqual(distinctDuplicate, 'one');
  assert.notEqual(identicalDuplicate, 'same');
});
