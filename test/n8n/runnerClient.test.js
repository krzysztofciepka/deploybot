import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobPayload, RUNNER_URL } from '../../src/lib/runnerClient.js';

test('assembles the runner job payload', () => {
  const draft = { chatId: 5, description: 'a clock', answers: { tz: 'Europe/Warsaw' } };
  const p = buildJobPayload(draft, 'clock');
  assert.equal(p.chatId, 5);
  assert.equal(p.subdomain, 'clock');
  assert.equal(p.public, true);
  assert.deepEqual(p.answers, { tz: 'Europe/Warsaw' });
});
test('runner url targets the docker bridge', () => {
  assert.equal(RUNNER_URL, 'http://172.17.0.1:8787/jobs');
});

test('update param controls the update flag', () => {
  assert.equal(buildJobPayload({ chatId: 1, description: 'x' }, 'clock').update, false);
  assert.equal(buildJobPayload({ chatId: 1, description: 'x' }, 'clock', true).update, true);
});
