import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sh } from '../../runner/lib/exec.js';

test('captures stdout and zero exit', async () => {
  const r = await sh('echo hello');
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), 'hello');
});
test('returns non-zero code without throwing', async () => {
  const r = await sh('exit 3');
  assert.equal(r.code, 3);
});
test('times out long commands', async () => {
  const r = await sh('sleep 5', { timeoutMs: 100 });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr + '', /timeout/i);
});
