import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobQueue } from '../../runner/lib/queue.js';
import { createServer } from '../../runner/server.js';

function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}

test('POST /jobs validates, enqueues, and 202s', async () => {
  const q = new JobQueue(join(mkdtempSync(join(tmpdir(), 's-')), 'jobs.json'), { now: () => 1 });
  let processed = 0;
  const server = createServer({ queue: q, processNext: async () => { processed++; }, env: {} });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/jobs`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: 1, description: 'x', subdomain: 'clock' }),
  });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.match(body.jobId, /^job-/);
  assert.equal(processed, 1);
  server.close();
});

test('POST /jobs rejects bad payload with 400', async () => {
  const q = new JobQueue(join(mkdtempSync(join(tmpdir(), 's-')), 'jobs.json'), { now: () => 1 });
  const server = createServer({ queue: q, processNext: async () => {}, env: {} });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/jobs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chatId: 1 }),
  });
  assert.equal(res.status, 400);
  server.close();
});

test('POST /jobs returns 400 on malformed JSON body', async () => {
  const q = new JobQueue(join(mkdtempSync(join(tmpdir(), 's-')), 'jobs.json'), { now: () => 1 });
  const server = createServer({ queue: q, processNext: async () => {}, env: {} });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/jobs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /invalid JSON/);
  server.close();
});

test('GET /status returns queue summary', async () => {
  const q = new JobQueue(join(mkdtempSync(join(tmpdir(), 's-')), 'jobs.json'), { now: () => 1 });
  const server = createServer({ queue: q, processNext: async () => {}, env: {} });
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok('pending' in body);
  server.close();
});
