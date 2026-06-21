import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJob } from '../../runner/lib/payload.js';

test('accepts a well-formed job and sets appName = subdomain', () => {
  const r = validateJob({ chatId: 42, description: 'a clock', answers: {}, subdomain: 'clock', public: true });
  assert.equal(r.ok, true);
  assert.equal(r.job.appName, 'clock');
  assert.equal(r.job.public, true);
});

test('rejects missing description', () => {
  const r = validateJob({ chatId: 42, subdomain: 'clock' });
  assert.equal(r.ok, false);
  assert.match(r.error, /description/);
});

test('rejects missing chatId', () => {
  const r = validateJob({ description: 'x', subdomain: 'clock' });
  assert.equal(r.ok, false);
  assert.match(r.error, /chatId/);
});

test('defaults public to true and answers to {}', () => {
  const r = validateJob({ chatId: 1, description: 'x', subdomain: 'clock' });
  assert.equal(r.job.public, true);
  assert.deepEqual(r.job.answers, {});
});

test('rejects reserved subdomain (n8n)', () => {
  const r = validateJob({ chatId: 1, description: 'x', subdomain: 'n8n' });
  assert.equal(r.ok, false);
  assert.match(r.error, /reserved/);
});

test('rejects invalid subdomain label with shell-injection chars', () => {
  const r = validateJob({ chatId: 1, description: 'x', subdomain: 'Bad Name; rm -rf /' });
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid subdomain label/);
});
