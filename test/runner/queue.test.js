import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobQueue } from '../../runner/lib/queue.js';

function freshQueue() {
  const dir = mkdtempSync(join(tmpdir(), 'dbq-'));
  let t = 0;
  return new JobQueue(join(dir, 'jobs.json'), { now: () => ++t });
}

test('enqueue returns incrementing positions', () => {
  const q = freshQueue();
  assert.equal(q.enqueue({ appName: 'a' }).queuePosition, 1);
  assert.equal(q.enqueue({ appName: 'b' }).queuePosition, 2);
});

test('next() yields pending in FIFO order and marks running', () => {
  const q = freshQueue();
  const { jobId } = q.enqueue({ appName: 'a' });
  const rec = q.next();
  assert.equal(rec.jobId, jobId);
  assert.equal(rec.status, 'running');
  assert.equal(q.next(), null, 'no second pending job');
});

test('setStatus persists and survives reload', () => {
  const q = freshQueue();
  const { jobId } = q.enqueue({ appName: 'a' });
  q.next();
  q.setStatus(jobId, 'success', { link: 'https://x' });
  const q2 = new JobQueue(q.persistPath, { now: () => 1 });
  q2.load();
  assert.equal(q2.get(jobId).status, 'success');
  assert.equal(q2.get(jobId).link, 'https://x');
});

test('status() summarizes current/pending/recent', () => {
  const q = freshQueue();
  q.enqueue({ appName: 'a' });
  q.enqueue({ appName: 'b' });
  q.next();
  const s = q.status();
  assert.equal(s.current.job.appName, 'a');
  assert.equal(s.pending.length, 1);
});
