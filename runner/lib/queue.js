// runner/lib/queue.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class JobQueue {
  constructor(persistPath, { now } = {}) {
    this.persistPath = persistPath;
    this.now = now || (() => Date.now());
    this.records = [];
    this.seq = 0;
  }
  load() {
    if (existsSync(this.persistPath)) {
      const data = JSON.parse(readFileSync(this.persistPath, 'utf8'));
      this.records = data.records || [];
      this.seq = data.seq || this.records.length;
    }
    return this;
  }
  save() {
    mkdirSync(dirname(this.persistPath), { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify({ seq: this.seq, records: this.records }, null, 2));
  }
  enqueue(job) {
    const jobId = `job-${++this.seq}`;
    this.records.push({ jobId, job, status: 'pending', error: null, link: null, createdAt: this.now() });
    this.save();
    const queuePosition = this.records.filter((r) => r.status === 'pending').length;
    return { jobId, queuePosition };
  }
  next() {
    if (this.records.some((r) => r.status === 'running')) return null;
    const rec = this.records.find((r) => r.status === 'pending');
    if (!rec) return null;
    rec.status = 'running';
    rec.startedAt = this.now();
    this.save();
    return rec;
  }
  get(jobId) {
    return this.records.find((r) => r.jobId === jobId) || null;
  }
  setStatus(jobId, status, patch = {}) {
    const rec = this.get(jobId);
    if (!rec) return;
    rec.status = status;
    rec.finishedAt = this.now();
    Object.assign(rec, patch);
    this.save();
  }
  status() {
    const current = this.records.find((r) => r.status === 'running') || null;
    const pending = this.records.filter((r) => r.status === 'pending');
    const recent = this.records.slice(-5).reverse();
    return { current, pending, recent };
  }
}
