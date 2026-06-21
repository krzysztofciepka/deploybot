import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForAnswer, provideAnswer, isWaiting } from '../../runner/lib/inbox.js';

test('provideAnswer resolves a pending waiter', async () => {
  const p = waitForAnswer('42', 5000);
  assert.equal(isWaiting('42'), true);
  assert.equal(provideAnswer('42', 'my-token'), true);
  assert.equal(await p, 'my-token');
  assert.equal(isWaiting('42'), false);
});
test('provideAnswer returns false when nobody is waiting', () => {
  assert.equal(provideAnswer('999', 'x'), false);
});
test('waitForAnswer times out to null', async () => {
  assert.equal(await waitForAnswer('7', 10), null);
});
