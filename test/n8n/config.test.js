import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowed, isAllowed } from '../../src/lib/config.js';

test('parses a comma-separated chat-id list', () => {
  assert.deepEqual(parseAllowed('1, 2 ,3'), [1, 2, 3]);
  assert.deepEqual(parseAllowed(''), []);
});
test('isAllowed checks membership', () => {
  assert.equal(isAllowed([1, 2], 2), true);
  assert.equal(isAllowed([1, 2], 9), false);
  assert.equal(isAllowed([], 1), false);
});
