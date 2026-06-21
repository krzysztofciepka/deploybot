import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableBytes, hasHeadroom } from '../../runner/lib/disk.js';

const DF = 'Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 40000000000 36000000000 3000000000 92% /\n';

test('availableBytes parses the Available column', () => {
  assert.equal(availableBytes(DF), 3000000000);
});
test('hasHeadroom compares against the floor', () => {
  assert.equal(hasHeadroom(3000000000, 2000000000), true);
  assert.equal(hasHeadroom(1000000000, 2000000000), false);
});
