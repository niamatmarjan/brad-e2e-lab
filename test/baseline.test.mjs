import test from 'node:test';
import assert from 'node:assert/strict';
import { labStatus } from '../src/index.mjs';

test('disposable lab baseline works before Story 1.1 implementation', () => {
  assert.equal(labStatus(), 'ready-for-pilot');
});
