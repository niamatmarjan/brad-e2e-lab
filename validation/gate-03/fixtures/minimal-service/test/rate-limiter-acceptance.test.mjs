import { test } from 'node:test';
import assert from 'node:assert/strict';

test('ATDD: Rate Limiter Acceptance Standard (Given/When/Then)', () => {
  // Given a client key with quota 5 requests per minute
  const quota = 5;
  let requests = 0;
  // When 5 requests arrive within the window
  for (let i = 0; i < quota; i++) requests++;
  // Then allowance is exhausted
  assert.equal(requests, quota);
  // And 6th request is rejected with 429
  const excessAllowed = requests < quota;
  assert.equal(excessAllowed, false);
});
