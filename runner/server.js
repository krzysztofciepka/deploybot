// runner/server.js
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { JobQueue } from './lib/queue.js';
import { validateJob } from './lib/payload.js';
import { runJob } from './lib/pipeline.js';
import { sendMessage } from './lib/telegram.js';
import { sh } from './lib/exec.js';
import { recentActivity } from './lib/events.js';
import { readFile, writeFile } from 'node:fs/promises';

function body(req) {
  return new Promise((res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => res(b)); });
}

export function createServer({ queue, processNext, env }) {
  return http.createServer(async (req, res) => {
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      if (req.method === 'POST' && req.url === '/jobs') {
        let parsed;
        try { parsed = JSON.parse((await body(req)) || '{}'); }
        catch { return json(400, { error: 'invalid JSON' }); }
        const v = validateJob(parsed);
        if (!v.ok) return json(400, { error: v.error });
        const { jobId, queuePosition } = queue.enqueue(v.job);
        processNext();
        return json(202, { jobId, queuePosition });
      }
      if (req.method === 'GET' && req.url === '/status') {
        const st = queue.status();
        // attach a tail of the running job's live build log so progress is visible
        if (st.current && st.current.job && st.current.job.appName) {
          try {
            const log = await readFile(`/opt/apps/${st.current.job.appName}/.deploybot/build.log`, 'utf8');
            st.currentLog = recentActivity(log, 10).join('\n');
          } catch { st.currentLog = ''; }
        }
        return json(200, st);
      }
      if (req.method === 'GET' && req.url.startsWith('/jobs/')) {
        const rec = queue.get(req.url.slice('/jobs/'.length));
        return rec ? json(200, rec) : json(404, { error: 'not found' });
      }
      return json(404, { error: 'not found' });
    } catch (e) {
      return json(500, { error: String(e && e.message || e) });
    }
  });
}

export function makeWorker(queue, env) {
  let busy = false;
  return async function processNext() {
    if (busy) return;
    busy = true;
    try {
      let rec;
      while ((rec = queue.next())) {
        const deps = { sh, sendMessage, readFile, writeFile, env, now: () => Date.now() };
        try {
          const r = await runJob(rec.job, deps);
          queue.setStatus(rec.jobId, r.ok ? 'success' : 'failed', { link: r.link || null, repo: r.repo || null, error: r.error || null });
        } catch (e) {
          queue.setStatus(rec.jobId, 'failed', { error: String(e && e.message || e) });
        }
      }
    } finally { busy = false; }
  };
}

function main() {
  const env = process.env;
  const queue = new JobQueue('/opt/apps/deploybot-runner/jobs.json').load();
  const processNext = makeWorker(queue, env);
  const server = createServer({ queue, processNext, env });
  server.listen(8787, '172.17.0.1', () => console.log('deploybot-runner on 172.17.0.1:8787'));
  processNext();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
