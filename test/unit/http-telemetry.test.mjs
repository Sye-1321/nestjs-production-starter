import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchedHttpRoute,
  normalizeHttpMethod,
  normalizeHttpStatus,
} from '../../dist/platform/http/http-telemetry.js';

test('HTTP method normalization has one fixed finite vocabulary', () => {
  assert.deepEqual(
    [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
      'TRACE',
      'ATTACKER_METHOD',
    ].map(normalizeHttpMethod),
    [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
      'OTHER',
      'OTHER',
    ],
  );
});

test('HTTP route normalization uses only a matched template or UNMATCHED', () => {
  assert.equal(
    matchedHttpRoute({ route: { path: '/v1/tasks/:id' } }),
    '/v1/tasks/:id',
  );
  assert.equal(
    matchedHttpRoute({
      route: undefined,
      url: '/attacker/raw/path?secret=query-canary',
    }),
    'UNMATCHED',
  );
  assert.equal(matchedHttpRoute({ route: { path: /dynamic/u } }), 'UNMATCHED');
});

test('HTTP status normalization bounds invalid or non-integer values', () => {
  assert.deepEqual(
    [99, 100, 201, 404, 599, 600, 200.5, Number.NaN].map(normalizeHttpStatus),
    ['OTHER', '100', '201', '404', '599', 'OTHER', 'OTHER', 'OTHER'],
  );
});
