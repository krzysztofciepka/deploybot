# deploybot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Telegram bot (n8n front-end + server-side agent-runner) that builds and deploys small web apps from a plain-language description and replies with a live link.

**Architecture:** n8n handles Telegram I/O, whitelist, an up-front clarification round, and subdomain validation, then `POST`s a job to a host-side `agent-runner` daemon. The runner serializes jobs, drives `opencode` headless to build the app under TDD, then builds a Docker image, pushes to a private GitHub repo, deploys behind Caddy at `<subdomain>.s.ciepka.com`, verifies it is actually serving, and sends the link/error back over Telegram. Success is never announced unless verification passed; any failure rolls back cleanly.

**Tech Stack:** Node.js v22 (ESM, zero runtime deps — built-in `http`, `child_process`, `node:test`), Docker, Caddy, opencode (OpenCode Go backend), n8n v2.14.2, systemd.

## Global Constraints

- Server `server` → `root@89.167.71.120`; **2 CPU, 3.7 GB RAM, no swap**; keep everything lightweight.
- Deploy convention (verbatim): source `/opt/apps/<app>/`; container name = image tag = `<app>`; `--restart unless-stopped`; one Caddy block per app in `/etc/caddy/Caddyfile` as `<sub>.s.ciepka.com { reverse_proxy localhost:<hostPort> }`; redeploy script `/opt/apps/redeploy-<app>.sh`.
- `appName` **equals** the validated `subdomain` (a DNS label is also a valid Docker name and dir name). One identifier everywhere.
- Subdomain label regex (verbatim): `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, max 63 chars.
- Reserved names that must never be used/overwritten: `n8n`, `kalkulator-faktury`, `www`, `api`, `admin`, `deploybot`, `deploybot-runner`.
- LLM backend base URL: `https://opencode.ai/zen/go/v1`. Default reply language: Polish.
- Runner HTTP bind: `172.17.0.1:8787` (Docker bridge only; never public).
- Runner working dir: `/opt/apps/<app>`; runner home `/opt/apps/deploybot-runner/`; secrets in `/opt/apps/deploybot-runner/.env` (mode 600): `TELEGRAM_BOT_TOKEN`, `OPENCODE_API_KEY`, `GITHUB_TOKEN`.
- Per-job opencode timeout: 20 min (configurable via `JOB_TIMEOUT_MS`). Disk safety floor: 2 GB (`DISK_FLOOR_BYTES`).
- Host port range for deployed apps: `8100`–`8999`.
- n8n workflow built from source like the `n8n-pdf-qa-telegram` repo: ESM libs under `src/lib/`, bundled by `src/build.js` (strips `import`/`export`, injects into a Code node at `// __DEPLOYBOT_BUNDLE__`), deployed by `install.sh`.
- Frequent commits: one per task minimum. Conventional-commit messages.

---

## File Structure

**Runner (Phase 1):**
- `runner/lib/payload.js` — job payload validation/normalization.
- `runner/lib/names.js` — subdomain/appName validation, reserved-name guard.
- `runner/lib/queue.js` — single-flight job queue + `jobs.json` persistence.
- `runner/lib/caddy.js` — Caddy block generation + Caddyfile add/remove (pure string ops).
- `runner/lib/ports.js` — free host-port allocation from `docker ps` output.
- `runner/lib/disk.js` — `df` parsing + disk-floor guard.
- `runner/lib/rollback.js` — rollback step planner + executor.
- `runner/lib/exec.js` — promisified shell exec wrapper (timeout, captured output).
- `runner/lib/opencode.js` — opencode headless command + system-prompt builder.
- `runner/lib/github.js` — private repo create + push (via `gh`/`git`).
- `runner/lib/telegram.js` — Telegram sendMessage.
- `runner/lib/pipeline.js` — build→deploy→verify orchestration (consumes the above).
- `runner/server.js` — HTTP API + wires queue → pipeline.
- `runner/systemd/deploybot-runner.service` — systemd unit.
- `scripts/install-runner.sh` — host install/update for the runner.
- `test/runner/*.test.js` — unit + mocked-integration tests.

**n8n workflow (Phase 2):**
- `src/lib/config.js` — Config parsing + whitelist gate.
- `src/lib/session.js` — per-chat session state machine.
- `src/lib/intake.js` — intake system prompt + LLM-response parsing.
- `src/lib/subdomain.js` — subdomain validation + free-form answer mapping.
- `src/lib/runnerClient.js` — job-payload assembly + runner POST body.
- `src/workflow.template.json` — n8n workflow skeleton.
- `src/build.js` — bundle libs into the template → `workflow.json`.
- `install.sh` — build + deploy workflow to the n8n container.
- `test/n8n/*.test.js` — unit tests.
- `README.md` — setup, credentials, commands, acceptance checklist.

---

# Phase 1 — agent-runner (independently testable via `curl`)

### Task 0: Repo scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `runner/lib/.gitkeep`, `test/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "deploybot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "build": "node src/build.js"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
workflow.json
*.log
.env
```

- [ ] **Step 3: Verify the test runner works (no tests yet = exit 0)**

Run: `npm test`
Expected: exits 0 with "no tests found" or similar (Node ≥ 22 prints `tests 0`).

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore runner/lib/.gitkeep test/.gitkeep
git commit -m "chore: scaffold deploybot repo"
```

---

### Task 1: Job payload validation

**Files:**
- Create: `runner/lib/payload.js`
- Test: `test/runner/payload.test.js`

**Interfaces:**
- Produces: `validateJob(raw) -> { ok: true, job } | { ok: false, error }` where `job = { chatId:number, description:string, answers:object, subdomain:string, appName:string, public:boolean }`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/payload.test.js`
Expected: FAIL — `validateJob` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/payload.js
export function validateJob(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'payload must be an object' };
  if (typeof raw.chatId !== 'number') return { ok: false, error: 'chatId (number) is required' };
  if (typeof raw.description !== 'string' || !raw.description.trim())
    return { ok: false, error: 'description (non-empty string) is required' };
  if (typeof raw.subdomain !== 'string' || !raw.subdomain.trim())
    return { ok: false, error: 'subdomain (non-empty string) is required' };
  const job = {
    chatId: raw.chatId,
    description: raw.description.trim(),
    answers: raw.answers && typeof raw.answers === 'object' ? raw.answers : {},
    subdomain: raw.subdomain.trim(),
    appName: raw.subdomain.trim(),
    public: raw.public === false ? false : true,
  };
  return { ok: true, job };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/payload.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/payload.js test/runner/payload.test.js
git commit -m "feat(runner): job payload validation"
```

---

### Task 2: Name validation + reserved-name guard

**Files:**
- Create: `runner/lib/names.js`
- Test: `test/runner/names.test.js`

**Interfaces:**
- Produces: `isValidLabel(s) -> boolean`; `isReserved(s) -> boolean`; `validateAppName(s) -> { ok:boolean, error? }`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidLabel, isReserved, validateAppName } from '../../runner/lib/names.js';

test('valid labels', () => {
  assert.equal(isValidLabel('clock'), true);
  assert.equal(isValidLabel('my-app-2'), true);
});
test('invalid labels', () => {
  assert.equal(isValidLabel('-bad'), false);
  assert.equal(isValidLabel('Bad'), false);
  assert.equal(isValidLabel('a_b'), false);
  assert.equal(isValidLabel('a'.repeat(64)), false);
});
test('reserved names', () => {
  assert.equal(isReserved('n8n'), true);
  assert.equal(isReserved('deploybot'), true);
  assert.equal(isReserved('clock'), false);
});
test('validateAppName combines both', () => {
  assert.equal(validateAppName('clock').ok, true);
  assert.equal(validateAppName('n8n').ok, false);
  assert.equal(validateAppName('Bad').ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/names.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/names.js
const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RESERVED = new Set(['n8n', 'kalkulator-faktury', 'www', 'api', 'admin', 'deploybot', 'deploybot-runner']);

export function isValidLabel(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= 63 && LABEL_RE.test(s);
}
export function isReserved(s) {
  return RESERVED.has(s);
}
export function validateAppName(s) {
  if (!isValidLabel(s)) return { ok: false, error: 'invalid subdomain label' };
  if (isReserved(s)) return { ok: false, error: 'name is reserved' };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/names.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/names.js test/runner/names.test.js
git commit -m "feat(runner): name validation and reserved-name guard"
```

---

### Task 3: Single-flight job queue with persistence

**Files:**
- Create: `runner/lib/queue.js`
- Test: `test/runner/queue.test.js`

**Interfaces:**
- Produces: `class JobQueue(persistPath, { now })` with `enqueue(job) -> { jobId, queuePosition }`, `next() -> jobRecord|null`, `setStatus(jobId, status, patch)`, `get(jobId)`, `status() -> { current, pending, recent }`, `load()`/`save()`. A `jobRecord = { jobId, job, status, error, link, createdAt, ... }`. Statuses: `pending|running|success|failed`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/queue.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/queue.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/queue.js test/runner/queue.test.js
git commit -m "feat(runner): single-flight job queue with persistence"
```

---

### Task 4: Caddy block generation + Caddyfile editing

**Files:**
- Create: `runner/lib/caddy.js`
- Test: `test/runner/caddy.test.js`

**Interfaces:**
- Produces: `blockFor(subdomain, hostPort) -> string`; `addBlock(caddyText, subdomain, hostPort) -> string`; `removeBlock(caddyText, subdomain) -> string`; `hasBlock(caddyText, subdomain) -> boolean`. Pure string functions (file I/O handled by the pipeline).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockFor, addBlock, removeBlock, hasBlock } from '../../runner/lib/caddy.js';

const MARK = '# deploybot:clock';

test('blockFor renders a labelled reverse_proxy block', () => {
  const b = blockFor('clock', 8123);
  assert.match(b, /clock\.s\.ciepka\.com \{/);
  assert.match(b, /reverse_proxy localhost:8123/);
  assert.match(b, new RegExp(MARK));
});

test('addBlock appends and is detectable', () => {
  const out = addBlock('existing.com {\n}\n', 'clock', 8123);
  assert.equal(hasBlock(out, 'clock'), true);
  assert.match(out, /existing\.com/);
});

test('removeBlock is the inverse of addBlock', () => {
  const base = 'existing.com {\n}\n';
  const added = addBlock(base, 'clock', 8123);
  const removed = removeBlock(added, 'clock');
  assert.equal(hasBlock(removed, 'clock'), false);
  assert.match(removed, /existing\.com/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/caddy.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/caddy.js
function mark(subdomain) {
  return `# deploybot:${subdomain}`;
}
export function blockFor(subdomain, hostPort) {
  return [
    mark(subdomain),
    `${subdomain}.s.ciepka.com {`,
    `    reverse_proxy localhost:${hostPort}`,
    `}`,
    mark(subdomain) + ':end',
  ].join('\n');
}
export function hasBlock(caddyText, subdomain) {
  return caddyText.includes(mark(subdomain) + '\n');
}
export function addBlock(caddyText, subdomain, hostPort) {
  const base = caddyText.endsWith('\n') ? caddyText : caddyText + '\n';
  return base + '\n' + blockFor(subdomain, hostPort) + '\n';
}
export function removeBlock(caddyText, subdomain) {
  const start = mark(subdomain);
  const end = mark(subdomain) + ':end';
  const lines = caddyText.split('\n');
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line === start) { skipping = true; continue; }
    if (line === end) { skipping = false; continue; }
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/caddy.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/caddy.js test/runner/caddy.test.js
git commit -m "feat(runner): caddy block generation and editing"
```

---

### Task 5: Free host-port allocation

**Files:**
- Create: `runner/lib/ports.js`
- Test: `test/runner/ports.test.js`

**Interfaces:**
- Produces: `usedPorts(dockerPsText) -> Set<number>` (parses `docker ps --format '{{.Ports}}'` lines); `pickPort(used, { min=8100, max=8999 }) -> number` (throws if none free).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedPorts, pickPort } from '../../runner/lib/ports.js';

test('usedPorts parses host ports from docker ps output', () => {
  const text = '0.0.0.0:5678->5678/tcp\n0.0.0.0:8123->80/tcp, :::8123->80/tcp\n';
  const u = usedPorts(text);
  assert.equal(u.has(5678), true);
  assert.equal(u.has(8123), true);
});

test('pickPort returns the lowest free port in range', () => {
  const used = new Set([8100, 8101]);
  assert.equal(pickPort(used, { min: 8100, max: 8999 }), 8102);
});

test('pickPort throws when range exhausted', () => {
  const used = new Set([8100]);
  assert.throws(() => pickPort(used, { min: 8100, max: 8100 }), /no free port/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/ports.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/ports.js
export function usedPorts(dockerPsText) {
  const set = new Set();
  const re = /:(\d+)->/g;
  let m;
  while ((m = re.exec(dockerPsText)) !== null) set.add(Number(m[1]));
  return set;
}
export function pickPort(used, { min = 8100, max = 8999 } = {}) {
  for (let p = min; p <= max; p++) if (!used.has(p)) return p;
  throw new Error('no free port in range');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/ports.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/ports.js test/runner/ports.test.js
git commit -m "feat(runner): free host-port allocation"
```

---

### Task 6: Disk-floor guard

**Files:**
- Create: `runner/lib/disk.js`
- Test: `test/runner/disk.test.js`

**Interfaces:**
- Produces: `availableBytes(dfText) -> number` (parses `df -B1 /` output, second line, 4th column); `hasHeadroom(bytes, floor) -> boolean`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/disk.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/disk.js
export function availableBytes(dfText) {
  const lines = dfText.trim().split('\n');
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  return Number(cols[3]);
}
export function hasHeadroom(bytes, floor) {
  return bytes >= floor;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/disk.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/disk.js test/runner/disk.test.js
git commit -m "feat(runner): disk-floor guard"
```

---

### Task 7: Shell exec wrapper

**Files:**
- Create: `runner/lib/exec.js`
- Test: `test/runner/exec.test.js`

**Interfaces:**
- Produces: `sh(cmd, { timeoutMs, cwd, env }) -> Promise<{ code, stdout, stderr }>` (never rejects on non-zero exit — returns the code; rejects only on spawn error). Uses `child_process.spawn('bash', ['-lc', cmd])`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/exec.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/exec.js
import { spawn } from 'node:child_process';

export function sh(cmd, { timeoutMs = 0, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-lc', cmd], { cwd, env: env ? { ...process.env, ...env } : process.env });
    let stdout = '', stderr = '', timedOut = false, timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    }
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) stderr += '\n[timeout exceeded]';
      resolve({ code: timedOut ? 124 : code, stdout, stderr });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/exec.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/exec.js test/runner/exec.test.js
git commit -m "feat(runner): shell exec wrapper with timeout"
```

---

### Task 8: opencode command + system-prompt builder

**Files:**
- Create: `runner/lib/opencode.js`
- Test: `test/runner/opencode.test.js`

**Interfaces:**
- Produces: `buildPrompt(job) -> string` (the autonomous build brief embedding description + answers + the stack/Dockerfile/port contract); `buildCommand(workdir) -> string` (the headless `opencode run` invocation). The agent must write a `Dockerfile` and an `.deploybot/app.json` file containing `{ "containerPort": <number> }`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildCommand } from '../../runner/lib/opencode.js';

test('prompt embeds description, answers, and the hard contract', () => {
  const p = buildPrompt({ description: 'a clock', answers: { tz: 'Europe/Warsaw' }, subdomain: 'clock', public: true });
  assert.match(p, /a clock/);
  assert.match(p, /Europe\/Warsaw/);
  assert.match(p, /Dockerfile/);
  assert.match(p, /\.deploybot\/app\.json/);
  assert.match(p, /containerPort/);
  assert.match(p, /autonomous/i);          // self-approve plans/design
  assert.match(p, /SQLite/);               // allowed stack guidance
});

test('command runs opencode headless in the workdir', () => {
  const c = buildCommand('/opt/apps/clock');
  assert.match(c, /opencode run/);
  assert.match(c, /\/opt\/apps\/clock/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/opencode.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/opencode.js
export function buildPrompt(job) {
  const answers = Object.entries(job.answers || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '(none)';
  return [
    'You are an autonomous engineering agent. Build a small, self-contained web app from the brief below.',
    'Operate fully autonomously: when the superpowers skills (brainstorming, writing-plans) ask for approval,',
    'choose the best option yourself and proceed. NEVER wait for human input. Use TDD.',
    '',
    'HARD CONTRACT — your task is not done until ALL of these are true:',
    '1. The app builds and runs from a `Dockerfile` at the repo root.',
    '2. The container listens on a single HTTP port.',
    '3. You have written `.deploybot/app.json` containing exactly {"containerPort": <the port number>}.',
    '4. A local container smoke-test returns a 2xx/3xx HTTP response on that port.',
    '',
    'ALLOWED STACK (pick the lightest that fits): a static site (HTML/JS served by a tiny',
    'nginx/caddy image), OR a single small Node or Python container. You MAY use SQLite',
    '(file-based) for persistence. Do NOT use Postgres/MySQL or any multi-container setup.',
    '',
    `PUBLIC: ${job.public ? 'the app is publicly accessible' : 'the app should be access-restricted as described'}.`,
    '',
    '--- BRIEF ---',
    job.description,
    '',
    '--- CLARIFICATIONS ---',
    answers,
  ].join('\n');
}

export function buildCommand(workdir) {
  // opencode reads OPENCODE_API_KEY / config from the environment; prompt is piped via a heredoc file.
  return `cd ${workdir} && opencode run "$(cat .deploybot/prompt.txt)"`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/opencode.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/opencode.js test/runner/opencode.test.js
git commit -m "feat(runner): opencode prompt and command builder"
```

---

### Task 9: GitHub repo creation + push

**Files:**
- Create: `runner/lib/github.js`
- Test: `test/runner/github.test.js`

**Interfaces:**
- Produces: `pushCommands(appName, workdir) -> string[]` (the ordered shell commands to init/commit and create+push a **private** repo via `gh repo create`). Pure command-builder so it is testable; the pipeline executes them via `sh`.
- Consumes: `sh` (in the pipeline, not here).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushCommands } from '../../runner/lib/github.js';

test('creates a private repo and pushes', () => {
  const cmds = pushCommands('clock', '/opt/apps/clock');
  const joined = cmds.join(' && ');
  assert.match(joined, /git init/);
  assert.match(joined, /gh repo create clock --private/);
  assert.match(joined, /--source=\/opt\/apps\/clock/);
  assert.match(joined, /git -C \/opt\/apps\/clock push/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/github.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/github.js
export function pushCommands(appName, workdir) {
  return [
    `git -C ${workdir} init -q`,
    `git -C ${workdir} add -A`,
    `git -C ${workdir} -c user.email=deploybot@s.ciepka.com -c user.name=deploybot commit -q -m "Initial commit (deploybot)"`,
    `gh repo create ${appName} --private --source=${workdir} --remote=origin --push`,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/github.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/github.js test/runner/github.test.js
git commit -m "feat(runner): github private-repo push commands"
```

---

### Task 10: Telegram notifier

**Files:**
- Create: `runner/lib/telegram.js`
- Test: `test/runner/telegram.test.js`

**Interfaces:**
- Produces: `sendMessage(token, chatId, text, { fetchImpl }) -> Promise<{ ok:boolean }>`. Uses global `fetch`; `fetchImpl` is injectable for tests.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../../runner/lib/telegram.js';

test('posts to the Telegram sendMessage endpoint', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const r = await sendMessage('TOK', 42, 'hi', { fetchImpl: fakeFetch });
  assert.equal(r.ok, true);
  assert.match(captured.url, /bot TOK/.source.replace(' ', ''));
  assert.match(captured.url, /\/botTOK\/sendMessage/);
  assert.equal(captured.body.chat_id, 42);
  assert.equal(captured.body.text, 'hi');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/telegram.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/telegram.js
export async function sendMessage(token, chatId, text, { fetchImpl } = {}) {
  const f = fetchImpl || fetch;
  const res = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
  });
  const data = await res.json();
  return { ok: !!data.ok };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/telegram.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/telegram.js test/runner/telegram.test.js
git commit -m "feat(runner): telegram notifier"
```

---

### Task 11: Rollback planner + executor

**Files:**
- Create: `runner/lib/rollback.js`
- Test: `test/runner/rollback.test.js`

**Interfaces:**
- Produces: `rollbackCommands(ctx) -> string[]` where `ctx = { appName, caddyAdded:boolean }` — returns the ordered teardown commands (stop/rm container, rm image, restore Caddyfile + reload only if a block was added, rm workdir). The pipeline runs each via `sh` best-effort.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollbackCommands } from '../../runner/lib/rollback.js';

test('full rollback includes container, image, workdir', () => {
  const cmds = rollbackCommands({ appName: 'clock', caddyAdded: false });
  const j = cmds.join('\n');
  assert.match(j, /docker rm -f clock/);
  assert.match(j, /docker image rm -f clock/);
  assert.match(j, /rm -rf \/opt\/apps\/clock/);
  assert.doesNotMatch(j, /caddy reload/);
});

test('rollback restores caddy only when a block was added', () => {
  const cmds = rollbackCommands({ appName: 'clock', caddyAdded: true });
  const j = cmds.join('\n');
  assert.match(j, /caddy reload/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/rollback.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// runner/lib/rollback.js
export function rollbackCommands({ appName, caddyAdded }) {
  const cmds = [
    `docker rm -f ${appName} 2>/dev/null || true`,
    `docker image rm -f ${appName} 2>/dev/null || true`,
  ];
  if (caddyAdded) {
    // The pipeline writes /etc/caddy/Caddyfile from the in-memory removeBlock() result
    // before invoking rollback; here we only need the reload.
    cmds.push(`caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl reload caddy || true`);
  }
  cmds.push(`rm -rf /opt/apps/${appName}`);
  return cmds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/rollback.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/lib/rollback.js test/runner/rollback.test.js
git commit -m "feat(runner): rollback command planner"
```

---

### Task 12: Deploy pipeline orchestration (mocked-integration)

**Files:**
- Create: `runner/lib/pipeline.js`
- Test: `test/runner/pipeline.test.js`

**Interfaces:**
- Consumes: all Task 1–11 libs.
- Produces: `runJob(job, deps) -> Promise<{ ok:boolean, link?, repo?, error? }>` where `deps = { sh, sendMessage, readFile, writeFile, env, now }` (all injectable). On success sends the live link; on any failed gate it runs rollback and sends an honest error. **Never** reports success unless the public-URL check passed.

Pipeline order (each step checks the previous result; first failure → rollback + honest error):
1. `validateAppName(job.appName)` and re-check subdomain free (Caddyfile + `/opt/apps`).
2. Disk pre-flight: `df` → if below floor, `docker builder prune -f`; re-check → else fail.
3. Create `/opt/apps/<app>/.deploybot/`, write `prompt.txt` (`buildPrompt`).
4. Run opencode (`buildCommand`) with `JOB_TIMEOUT_MS`. Non-zero/timeout → fail.
5. Read `.deploybot/app.json` → `containerPort`; missing/invalid → fail.
6. `docker build -t <app> /opt/apps/<app>`; non-zero → fail.
7. Allocate hostPort (`docker ps` → `usedPorts`/`pickPort`).
8. `docker run -d --restart unless-stopped --name <app> -p <hostPort>:<containerPort> <app>`; non-zero → fail.
9. Wait/poll container `Up` and `curl localhost:<hostPort>` 2xx/3xx (retry ~10×/2s); fail → rollback.
10. Add Caddy block (read Caddyfile → `addBlock` → write → reload). Mark `caddyAdded=true`.
11. `curl https://<app>.s.ciepka.com` 2xx/3xx (retry); fail → rollback.
12. Write `/opt/apps/redeploy-<app>.sh`; `pushCommands` to GitHub (best-effort — push failure is logged, not fatal, since the app is already live).
13. `docker builder prune -f`. Send success link.

- [ ] **Step 1: Write the failing test (happy path + one rollback path, all `sh` mocked)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJob } from '../../runner/lib/pipeline.js';

function makeDeps(overrides = {}) {
  const calls = [];
  const files = { '/etc/caddy/Caddyfile': 'existing.com {\n}\n' };
  const sh = async (cmd) => {
    calls.push(cmd);
    if (cmd.includes('df -B1')) return { code: 0, stdout: 'h\n/dev/sda1 40000000000 1 9000000000 1% /\n', stderr: '' };
    if (cmd.includes('docker ps')) return { code: 0, stdout: '', stderr: '' };
    if (cmd.startsWith('curl')) return { code: 0, stdout: '200', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const sent = [];
  return {
    calls, sent, files,
    deps: {
      sh: overrides.sh || sh,
      sendMessage: async (_t, _c, text) => { sent.push(text); return { ok: true }; },
      readFile: async (p) => {
        if (p.endsWith('app.json')) return JSON.stringify({ containerPort: 80 });
        return files[p] ?? '';
      },
      writeFile: async (p, c) => { files[p] = c; },
      env: { TELEGRAM_BOT_TOKEN: 'T', JOB_TIMEOUT_MS: '1000', DISK_FLOOR_BYTES: '2000000000' },
      now: () => 1,
      ...overrides.depOverrides,
    },
  };
}

test('happy path deploys, verifies, and reports a live link', async () => {
  const { deps, sent } = makeDeps();
  const r = await runJob({ chatId: 1, description: 'x', answers: {}, subdomain: 'clock', appName: 'clock', public: true }, deps);
  assert.equal(r.ok, true);
  assert.match(r.link, /clock\.s\.ciepka\.com/);
  assert.match(sent.join('\n'), /clock\.s\.ciepka\.com/);
});

test('public-URL check failure rolls back and reports honest error', async () => {
  const { deps, sent, calls } = makeDeps({
    sh: async (cmd) => {
      if (cmd.includes('df -B1')) return { code: 0, stdout: 'h\n/dev/sda1 40000000000 1 9000000000 1% /\n', stderr: '' };
      if (cmd.includes('docker ps')) return { code: 0, stdout: '', stderr: '' };
      if (cmd.startsWith('curl') && cmd.includes('https://')) return { code: 0, stdout: '502', stderr: '' };
      if (cmd.startsWith('curl')) return { code: 0, stdout: '200', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const r = await runJob({ chatId: 1, description: 'x', answers: {}, subdomain: 'clock', appName: 'clock', public: true }, deps);
  assert.equal(r.ok, false);
  assert.match(sent.join('\n'), /(nie|failed|błąd|error)/i);
  assert.ok(calls.some((c) => /docker rm -f clock/.test(c)), 'rolled back the container');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/pipeline.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// runner/lib/pipeline.js
import { validateAppName } from './names.js';
import { addBlock, removeBlock } from './caddy.js';
import { usedPorts, pickPort } from './ports.js';
import { availableBytes, hasHeadroom } from './disk.js';
import { buildPrompt, buildCommand } from './opencode.js';
import { pushCommands } from './github.js';
import { rollbackCommands } from './rollback.js';

const CADDYFILE = '/etc/caddy/Caddyfile';
const httpOk = (s) => /^[23]\d\d/.test((s || '').trim());

async function curlStatus(sh, url) {
  const r = await sh(`curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${url}`);
  return r.stdout;
}
async function retry(fn, times, delayMs) {
  for (let i = 0; i < times; i++) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

export async function runJob(job, deps) {
  const { sh, sendMessage, readFile, writeFile, env } = deps;
  const app = job.appName;
  const dir = `/opt/apps/${app}`;
  const token = env.TELEGRAM_BOT_TOKEN;
  const timeoutMs = Number(env.JOB_TIMEOUT_MS || 1200000);
  const floor = Number(env.DISK_FLOOR_BYTES || 2000000000);
  let caddyAdded = false;

  const fail = async (msg) => {
    let caddyText = '';
    if (caddyAdded) {
      caddyText = removeBlock(await readFile(CADDYFILE), app);
      await writeFile(CADDYFILE, caddyText);
    }
    for (const cmd of rollbackCommands({ appName: app, caddyAdded })) await sh(cmd);
    await sendMessage(token, job.chatId, `❌ Nie udało się wdrożyć „${app}”: ${msg}\nNic nie zostało po połowie wdrożone.`);
    return { ok: false, error: msg };
  };

  // 1. name + availability
  const nameOk = validateAppName(app);
  if (!nameOk.ok) return fail(nameOk.error);
  const exists = await sh(`[ -d ${dir} ] && echo yes || echo no`);
  if (exists.stdout.trim() === 'yes') return fail('subdomain już zajęty');
  const caddyNow = await readFile(CADDYFILE);
  if (caddyNow.includes(`${app}.s.ciepka.com`)) return fail('subdomain już zajęty (caddy)');

  // 2. disk
  let df = await sh('df -B1 /');
  if (!hasHeadroom(availableBytes(df.stdout), floor)) {
    await sh('docker builder prune -f');
    df = await sh('df -B1 /');
    if (!hasHeadroom(availableBytes(df.stdout), floor)) return fail('za mało miejsca na dysku');
  }

  // 3. workspace + prompt
  await sh(`mkdir -p ${dir}/.deploybot`);
  await writeFile(`${dir}/.deploybot/prompt.txt`, buildPrompt(job));

  // 4. opencode
  const oc = await sh(buildCommand(dir), { timeoutMs });
  if (oc.code !== 0) return fail(`agent nie ukończył budowy (kod ${oc.code})`);

  // 5. app.json
  let containerPort;
  try {
    containerPort = JSON.parse(await readFile(`${dir}/.deploybot/app.json`)).containerPort;
  } catch { return fail('agent nie zapisał .deploybot/app.json'); }
  if (!Number.isInteger(containerPort)) return fail('nieprawidłowy containerPort');

  // 6. build
  const build = await sh(`docker build -t ${app} ${dir}`);
  if (build.code !== 0) return fail('docker build nie powiódł się');

  // 7-8. port + run
  const ps = await sh(`docker ps --format '{{.Ports}}'`);
  const hostPort = pickPort(usedPorts(ps.stdout));
  const run = await sh(`docker run -d --restart unless-stopped --name ${app} -p ${hostPort}:${containerPort} ${app}`);
  if (run.code !== 0) return fail('docker run nie powiódł się');

  // 9. local verify
  const localOk = await retry(async () => {
    const up = await sh(`docker ps --filter name=^/${app}$ --format '{{.Status}}'`);
    if (!/^Up/.test(up.stdout.trim())) return false;
    return httpOk(await curlStatus(sh, `localhost:${hostPort}`));
  }, 10, 2000);
  if (!localOk) return fail('kontener nie odpowiada lokalnie');

  // 10. caddy
  await writeFile(CADDYFILE, addBlock(await readFile(CADDYFILE), app, hostPort));
  caddyAdded = true;
  const reload = await sh('caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl reload caddy');
  if (reload.code !== 0) return fail('przeładowanie Caddy nie powiodło się');

  // 11. public verify
  const publicOk = await retry(async () => httpOk(await curlStatus(sh, `https://${app}.s.ciepka.com`)), 10, 3000);
  if (!publicOk) return fail('publiczny adres nie odpowiada (możliwe DNS/HTTPS)');

  // 12. redeploy script + github (best-effort)
  await writeFile(`/opt/apps/redeploy-${app}.sh`,
    `#!/usr/bin/env bash\nset -e\ncd ${dir}\ngit pull --ff-only || true\ndocker build -t ${app} ${dir}\ndocker rm -f ${app}\ndocker run -d --restart unless-stopped --name ${app} -p ${hostPort}:${containerPort} ${app}\n`);
  await sh(`chmod +x /opt/apps/redeploy-${app}.sh`);
  let repo = null;
  for (const cmd of pushCommands(app, dir)) { const r = await sh(cmd); if (r.code !== 0) break; }
  const repoUrl = await sh(`gh repo view ${app} --json url -q .url 2>/dev/null || true`);
  if (repoUrl.stdout.trim()) repo = repoUrl.stdout.trim();

  // 13. prune + success
  await sh('docker builder prune -f');
  const link = `https://${app}.s.ciepka.com`;
  await sendMessage(token, job.chatId, `🚀 Gotowe! Twoja aplikacja działa:\n${link}${repo ? `\n📦 ${repo}` : ''}`);
  return { ok: true, link, repo };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/pipeline.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full runner suite**

Run: `node --test test/runner/`
Expected: PASS (all runner tests green).

- [ ] **Step 6: Commit**

```bash
git add runner/lib/pipeline.js test/runner/pipeline.test.js
git commit -m "feat(runner): build-deploy-verify pipeline with rollback"
```

---

### Task 13: HTTP server + worker loop

**Files:**
- Create: `runner/server.js`
- Test: `test/runner/server.test.js`

**Interfaces:**
- Consumes: `JobQueue`, `validateJob`, `runJob`, `sendMessage`.
- Produces: `createServer({ queue, processNext, env }) -> http.Server` with routes `POST /jobs` → validate → enqueue → kick the worker → `202 {jobId, queuePosition}`; `GET /status` → `200 queue.status()`; `GET /jobs/:id` → record or `404`. The worker drains the queue one job at a time via `runJob`. `server.js` also has a `main()` that loads env, binds `172.17.0.1:8787`, and starts draining — guarded by `if (import.meta.url === ...)` so tests can import without binding.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/runner/server.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
// runner/server.js
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { JobQueue } from './lib/queue.js';
import { validateJob } from './lib/payload.js';
import { runJob } from './lib/pipeline.js';
import { sendMessage } from './lib/telegram.js';
import { sh } from './lib/exec.js';
import { readFile, writeFile } from 'node:fs/promises';

function body(req) {
  return new Promise((res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => res(b)); });
}

export function createServer({ queue, processNext, env }) {
  return http.createServer(async (req, res) => {
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      if (req.method === 'POST' && req.url === '/jobs') {
        const v = validateJob(JSON.parse((await body(req)) || '{}'));
        if (!v.ok) return json(400, { error: v.error });
        const { jobId, queuePosition } = queue.enqueue(v.job);
        processNext();
        return json(202, { jobId, queuePosition });
      }
      if (req.method === 'GET' && req.url === '/status') return json(200, queue.status());
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/runner/server.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add runner/server.js test/runner/server.test.js
git commit -m "feat(runner): http api and single-flight worker loop"
```

---

### Task 14: systemd unit + runner install script

**Files:**
- Create: `runner/systemd/deploybot-runner.service`, `scripts/install-runner.sh`

**Interfaces:** operational only — no unit test. Verified by the acceptance checklist (Task 21).

- [ ] **Step 1: Create the systemd unit**

```ini
# runner/systemd/deploybot-runner.service
[Unit]
Description=deploybot agent-runner
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/apps/deploybot-runner
EnvironmentFile=/opt/apps/deploybot-runner/.env
ExecStart=/usr/bin/node /opt/apps/deploybot-runner/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create the install script**

```bash
#!/usr/bin/env bash
# scripts/install-runner.sh — install/update the runner on `server`
set -euo pipefail
SSH_HOST="${SSH_HOST:-server}"
REMOTE_DIR=/opt/apps/deploybot-runner
cd "$(dirname "$0")/.."

echo "Syncing runner to ${SSH_HOST}:${REMOTE_DIR}…"
ssh "$SSH_HOST" "mkdir -p ${REMOTE_DIR}"
scp -r runner/server.js runner/lib "$SSH_HOST:$REMOTE_DIR/"
scp runner/systemd/deploybot-runner.service "$SSH_HOST:/etc/systemd/system/deploybot-runner.service"

ssh "$SSH_HOST" bash -s <<'EOF'
set -euo pipefail
if [ ! -f /opt/apps/deploybot-runner/.env ]; then
  cat > /opt/apps/deploybot-runner/.env <<'ENV'
TELEGRAM_BOT_TOKEN=CHANGEME
OPENCODE_API_KEY=CHANGEME
GITHUB_TOKEN=CHANGEME
JOB_TIMEOUT_MS=1200000
DISK_FLOOR_BYTES=2000000000
ENV
  chmod 600 /opt/apps/deploybot-runner/.env
  echo "WROTE placeholder .env — edit it with real secrets before starting."
fi
systemctl daemon-reload
systemctl enable deploybot-runner
echo "Installed. After editing .env: systemctl restart deploybot-runner"
EOF
echo "Done."
```

- [ ] **Step 3: Lint both files locally**

Run: `bash -n scripts/install-runner.sh && echo OK`
Expected: `OK` (syntax valid).

- [ ] **Step 4: Commit**

```bash
git add runner/systemd/deploybot-runner.service scripts/install-runner.sh
git commit -m "feat(runner): systemd unit and install script"
```

---

> **Integration checkpoint (end of Phase 1):** the runner is now independently usable. After `scripts/install-runner.sh`, editing `.env`, installing opencode + superpowers + `gh` on the host, and `systemctl start deploybot-runner`, a job can be driven end-to-end with:
> `curl -s http://172.17.0.1:8787/jobs -d '{"chatId":<your-id>,"description":"a page showing the current time","subdomain":"clocktest"}' -H 'content-type: application/json'`
> Confirm a live link arrives over Telegram before building Phase 2.

---

# Phase 2 — n8n workflow

### Task 15: n8n config + whitelist lib

**Files:**
- Create: `src/lib/config.js`
- Test: `test/n8n/config.test.js`

**Interfaces:**
- Produces: `parseAllowed(csv) -> number[]`; `isAllowed(allowed, chatId) -> boolean`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/n8n/config.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/config.js
export function parseAllowed(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n !== 0);
}
export function isAllowed(allowed, chatId) {
  return allowed.includes(Number(chatId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/n8n/config.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.js test/n8n/config.test.js
git commit -m "feat(n8n): config parsing and whitelist gate"
```

---

### Task 16: n8n session state machine

**Files:**
- Create: `src/lib/session.js`
- Test: `test/n8n/session.test.js`

**Interfaces:**
- Produces: `getSession(store, chatId) -> session` (creates `{ phase:'idle', draft:null }`); `startClarifying(session, draft)`; `markBuilding(session)`; `reset(session)`. Phases: `idle|clarifying|building`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSession, startClarifying, markBuilding, reset } from '../../src/lib/session.js';

test('new session starts idle', () => {
  const store = {};
  assert.equal(getSession(store, 7).phase, 'idle');
});
test('transitions idle -> clarifying -> building -> idle', () => {
  const store = {};
  const s = getSession(store, 7);
  startClarifying(s, { description: 'x', answers: {}, questions: ['q1'] });
  assert.equal(s.phase, 'clarifying');
  assert.equal(s.draft.description, 'x');
  markBuilding(s);
  assert.equal(s.phase, 'building');
  reset(s);
  assert.equal(s.phase, 'idle');
  assert.equal(s.draft, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/n8n/session.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/session.js
export function getSession(store, chatId) {
  const key = `chat:${chatId}`;
  if (!store[key]) store[key] = { phase: 'idle', draft: null };
  return store[key];
}
export function startClarifying(session, draft) {
  session.phase = 'clarifying';
  session.draft = draft;
}
export function markBuilding(session) {
  session.phase = 'building';
}
export function reset(session) {
  session.phase = 'idle';
  session.draft = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/n8n/session.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.js test/n8n/session.test.js
git commit -m "feat(n8n): per-chat session state machine"
```

---

### Task 17: n8n intake prompt + response parsing

**Files:**
- Create: `src/lib/intake.js`
- Test: `test/n8n/intake.test.js`

**Interfaces:**
- Produces: `intakeSystemPrompt(language) -> string`; `parseIntake(llmText) -> { questions:string[], needsSubdomain:true }` (tolerates fenced JSON / surrounding prose; on parse failure returns a single generic clarification + subdomain).

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intakeSystemPrompt, parseIntake } from '../../src/lib/intake.js';

test('system prompt names the language and the minimal-questions rule', () => {
  const p = intakeSystemPrompt('Polish');
  assert.match(p, /Polish/);
  assert.match(p, /minimum|tylko|only/i);
  assert.match(p, /JSON/);
});
test('parses fenced JSON', () => {
  const r = parseIntake('```json\n{"questions":["q1","q2"]}\n```');
  assert.deepEqual(r.questions, ['q1', 'q2']);
  assert.equal(r.needsSubdomain, true);
});
test('falls back gracefully on garbage', () => {
  const r = parseIntake('I could not produce JSON');
  assert.equal(Array.isArray(r.questions), true);
  assert.equal(r.needsSubdomain, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/n8n/intake.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/intake.js
export function intakeSystemPrompt(language) {
  return [
    `You triage requests for small web apps. Reply ONLY with JSON: {"questions": string[]}.`,
    `Ask the MINIMUM essential clarifying questions — assume sensible defaults for everything else.`,
    `If the request is already clear enough to build, return an empty array.`,
    `Do NOT ask about the subdomain (handled separately). Write the questions in ${language}.`,
  ].join(' ');
}
export function parseIntake(llmText) {
  const fallback = { questions: [], needsSubdomain: true };
  try {
    const m = String(llmText).match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const obj = JSON.parse(m[0]);
    return { questions: Array.isArray(obj.questions) ? obj.questions.map(String) : [], needsSubdomain: true };
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/n8n/intake.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/intake.js test/n8n/intake.test.js
git commit -m "feat(n8n): intake prompt and response parsing"
```

---

### Task 18: n8n subdomain validation + answer mapping

**Files:**
- Create: `src/lib/subdomain.js`
- Test: `test/n8n/subdomain.test.js`

**Interfaces:**
- Produces: `isValidSubdomain(s) -> boolean` (same regex + reserved set as the runner's `names.js`, duplicated here because n8n libs are bundled separately); `extractSubdomain(text) -> string|null` (pulls a candidate label from a free-form reply); `allAnswered(questions, answers) -> boolean`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSubdomain, extractSubdomain, allAnswered } from '../../src/lib/subdomain.js';

test('validates labels and rejects reserved', () => {
  assert.equal(isValidSubdomain('clock'), true);
  assert.equal(isValidSubdomain('n8n'), false);
  assert.equal(isValidSubdomain('Bad'), false);
});
test('extracts a label from a free-form reply', () => {
  assert.equal(extractSubdomain('let us use clock please'), 'clock');
  assert.equal(extractSubdomain('subdomain: my-app'), 'my-app');
  assert.equal(extractSubdomain('???'), null);
});
test('allAnswered checks coverage', () => {
  assert.equal(allAnswered(['q1', 'q2'], { q1: 'a', q2: 'b' }), true);
  assert.equal(allAnswered(['q1', 'q2'], { q1: 'a' }), false);
  assert.equal(allAnswered([], {}), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/n8n/subdomain.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/subdomain.js
const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RESERVED = new Set(['n8n', 'kalkulator-faktury', 'www', 'api', 'admin', 'deploybot', 'deploybot-runner']);

export function isValidSubdomain(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= 63 && LABEL_RE.test(s) && !RESERVED.has(s);
}
export function extractSubdomain(text) {
  const after = String(text).match(/(?:subdomain|domena|adres)\s*[:=]?\s*([a-z0-9-]+)/i);
  const candidates = after ? [after[1]] : String(text).toLowerCase().split(/\s+/);
  for (const c of candidates) {
    const w = c.replace(/[^a-z0-9-]/g, '');
    if (isValidSubdomain(w)) return w;
  }
  return null;
}
export function allAnswered(questions, answers) {
  return questions.every((q) => answers[q] != null && String(answers[q]).trim() !== '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/n8n/subdomain.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/subdomain.js test/n8n/subdomain.test.js
git commit -m "feat(n8n): subdomain validation and answer extraction"
```

---

### Task 19: n8n runner client

**Files:**
- Create: `src/lib/runnerClient.js`
- Test: `test/n8n/runnerClient.test.js`

**Interfaces:**
- Produces: `buildJobPayload(draft, subdomain) -> { chatId, description, answers, subdomain, public }` (derives `public` from the draft/description; defaults true); `RUNNER_URL` constant = `http://172.17.0.1:8787/jobs`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/n8n/runnerClient.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/runnerClient.js
export const RUNNER_URL = 'http://172.17.0.1:8787/jobs';
export function buildJobPayload(draft, subdomain) {
  const isPrivate = /\b(private|prywatn|tylko dla mnie|nie publiczn)\b/i.test(draft.description || '');
  return {
    chatId: draft.chatId,
    description: draft.description,
    answers: draft.answers || {},
    subdomain,
    public: !isPrivate,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/n8n/runnerClient.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/runnerClient.js test/n8n/runnerClient.test.js
git commit -m "feat(n8n): runner client job-payload builder"
```

---

### Task 20: Workflow template + build script

**Files:**
- Create: `src/workflow.template.json`, `src/build.js`
- Modify: `package.json` (the `build` script already points at `src/build.js`).

**Interfaces:** `node src/build.js` reads the template + libs, strips ESM `import`/`export`, injects the bundle at `// __DEPLOYBOT_BUNDLE__` inside Code nodes, and writes `workflow.json`. Mirrors the PDF QA repo's `build.js`.

The template encodes this graph (built/edited in the n8n UI, exported, then hand-trimmed):
`Telegram Trigger → Code: "Router"` (loads Config static data; whitelist gate; runs the session state machine: in `idle` → calls the intake LLM via an HTTP Request node and emits questions, or if no questions needed jumps straight to subdomain; in `clarifying` → maps the reply to answers via `extractSubdomain`/`allAnswered`, validates subdomain availability through an HTTP Request to the runner's `/status`-style check or an SSH check node, and when complete POSTs `buildJobPayload` to `RUNNER_URL`) `→ Telegram sendMessage`. A **Config** Set node (top of workflow) holds `allowedChatIds`, `language`, `base`. Subdomain availability is checked by an HTTP Request node calling the runner (add a `GET /check?subdomain=` route to the runner if needed) OR deferred entirely to the runner's dequeue-time re-check (the workflow does a cheap local format/reserved check, the runner is the source of truth for availability).

- [ ] **Step 1: Author the template in the n8n UI, export it to `src/workflow.template.json`**

In the n8n UI at `https://n8n.s.ciepka.com`: build the node graph above, set a stable workflow id (`deploybot0000001`), put a `// __DEPLOYBOT_BUNDLE__` line at the top of each Code node's `jsCode`, then **Download** the workflow JSON and save it as `src/workflow.template.json`. Reference the PDF QA template for node wiring (`~/repos/n8n-pdf-qa-telegram/src/workflow.template.json`).

- [ ] **Step 2: Write `src/build.js`** (adapted from the PDF QA repo)

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_ORDER = ['config.js', 'session.js', 'intake.js', 'subdomain.js', 'runnerClient.js'];

function bundle() {
  return LIB_ORDER.map((f) =>
    readFileSync(join(__dirname, 'lib', f), 'utf8')
      .replace(/^\s*import[^;]+;\s*$/gm, '')
      .replace(/^export\s+/gm, '')
  ).join('\n');
}

function main() {
  const tmpl = JSON.parse(readFileSync(join(__dirname, 'workflow.template.json'), 'utf8'));
  const code = bundle();
  for (const node of tmpl.nodes) {
    if (node.type === 'n8n-nodes-base.code' && typeof node.parameters?.jsCode === 'string') {
      node.parameters.jsCode = node.parameters.jsCode.replace('// __DEPLOYBOT_BUNDLE__', code);
    }
  }
  const out = JSON.stringify(tmpl, null, 2);
  if (/\d{6,}:[A-Za-z0-9_-]{30,}/.test(out)) throw new Error('refusing to write workflow.json: looks like it contains a secret');
  writeFileSync(join(__dirname, '..', 'workflow.json'), out + '\n');
  console.log('wrote workflow.json');
}
main();
```

- [ ] **Step 3: Build and sanity-check the output**

Run: `node src/build.js && node -e "JSON.parse(require('fs').readFileSync('workflow.json','utf8')); console.log('valid json')"`
Expected: `wrote workflow.json` then `valid json`; and `grep -c __DEPLOYBOT_BUNDLE__ workflow.json` returns `0` (placeholder replaced).

- [ ] **Step 4: Commit**

```bash
git add src/workflow.template.json src/build.js
git commit -m "feat(n8n): workflow template and build bundler"
```

---

### Task 21: install.sh, README, and acceptance checklist

**Files:**
- Create: `install.sh`, `README.md`

- [ ] **Step 1: Write `install.sh`** (adapted from the PDF QA repo)

```bash
#!/usr/bin/env bash
set -euo pipefail
SSH_HOST="${SSH_HOST:-server}"
CONTAINER="${CONTAINER:-n8n}"
REMOTE_TMP="/tmp/deploybot-workflow.json"
cd "$(dirname "$0")"
echo "Building workflow.json…"; node src/build.js
echo "Copying to ${SSH_HOST}…"; scp workflow.json "${SSH_HOST}:${REMOTE_TMP}"
echo "Importing into n8n container '${CONTAINER}'…"
ssh "${SSH_HOST}" "docker cp ${REMOTE_TMP} ${CONTAINER}:${REMOTE_TMP} && docker exec ${CONTAINER} n8n import:workflow --input=${REMOTE_TMP} && rm -f ${REMOTE_TMP}"
echo "Imported INACTIVE. Finish in the n8n UI: create credentials, set allowedChatIds, Activate."
```

- [ ] **Step 2: Write `README.md`** covering: what it does; prerequisites (BotFather bot, OpenCode Go key, GitHub PAT, opencode + superpowers + `gh` installed on the host, the runner installed via `scripts/install-runner.sh`); the two deploy steps (`scripts/install-runner.sh` for the daemon, `./install.sh` for the workflow); credentials to create in n8n; `allowedChatIds`; Telegram commands (`/start`, `/help`, `/status`, `/cancel`); and the acceptance checklist below.

Acceptance checklist (in the README):
1. `docker builder prune -f` on the server (clear the disk crunch).
2. Install opencode + superpowers + `gh` on the host; `gh auth login` (or `GITHUB_TOKEN`).
3. `scripts/install-runner.sh`; edit `/opt/apps/deploybot-runner/.env`; `systemctl start deploybot-runner`.
4. `./install.sh`; in the n8n UI create the Telegram + OpenCode Go credentials, set `allowedChatIds`, Activate.
5. From a whitelisted chat: "a tiny page that shows the current time in Warsaw" → answer the subdomain prompt → confirm the live `https://<sub>.s.ciepka.com` link works.
6. Send an impossible request → confirm an honest failure message and clean rollback (subdomain still free; no leftover container/image/Caddy block).
7. `/status` reflects the queue + last result.

- [ ] **Step 3: Lint + final full test run**

Run: `bash -n install.sh && npm test`
Expected: install.sh syntax OK; all unit + mocked-integration tests green.

- [ ] **Step 4: Commit**

```bash
git add install.sh README.md
git commit -m "docs: install script, README, and acceptance checklist"
```

---

## Self-Review

**Spec coverage:**
- Telegram bot + whitelist → Tasks 15 (config), 20 (template). ✓
- Up-front clarifications, minimal questions, auto-approve rest → Tasks 17 (intake), 8 (autonomous opencode prompt). ✓
- Subdomain mandatory + availability → Tasks 18 (validate), 12 (dequeue-time availability re-check, source of truth). ✓
- opencode headless + superpowers, lightweight stack + SQLite → Task 8 (prompt contract). ✓
- Build → private GitHub repo → Caddy+Docker deploy → verify → link → Tasks 9, 4, 5, 12 (pipeline). ✓
- Reliability: rollback, three-layer verify, single-flight, disk guard, timeout, honest errors → Tasks 11, 12, 3, 6, 7, 12. ✓
- Coolify rejected / Caddy+Docker → embedded in pipeline (Task 12) + spec. ✓
- n8n→runner async handoff (Approach A) → Tasks 13 (server), 19 (client). ✓
- Testing strategy (unit + mocked integration + acceptance) → every task's tests + Task 21 checklist. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases" in code steps; the only manual step (Task 20 Step 1, authoring the n8n template in the UI) is inherent to n8n and has concrete instructions + a reference file.

**Type consistency:** `validateJob → job{appName}` (T1) consumed by `runJob` (T12) and `JobQueue.enqueue` (T3); `runJob(job, deps)` signature matches `makeWorker` (T13); `buildJobPayload` output (T19) matches `validateJob` input shape (T1); `usedPorts/pickPort` (T5), `availableBytes/hasHeadroom` (T6), `addBlock/removeBlock` (T4), `rollbackCommands` (T11), `pushCommands` (T9), `buildPrompt/buildCommand` (T8) all consumed with matching signatures in `pipeline.js` (T12). Reserved-name set is intentionally duplicated in `runner/lib/names.js` and `src/lib/subdomain.js` (separate bundles) — noted in Task 18.

## Notes for the implementer
- Install **opencode + superpowers + `gh`** on the host as a prerequisite (the runner shells out to all three); this is operational, covered in the README, not a code task.
- The n8n template (Task 20) is authored in the UI then exported — the plan provides the node graph and the bundler; node coordinates/ids come from the export.
- Deferred to future work (not in this plan): `/list` and `/destroy <app>` commands.
