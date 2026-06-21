# deploybot — Design Spec

**Date:** 2026-06-21
**Status:** Approved for planning
**Source task:** `~/Notes/Notes/Tasks/Prywatne/Task P3.md`

## Summary

deploybot is a Telegram bot, fronted by an n8n workflow, that builds and deploys small
utility web apps from a plain-language description. n8n handles Telegram I/O, a whitelist,
an up-front clarification round, and subdomain validation, then hands the job to a
server-side **agent-runner** daemon. The runner drives **opencode headless** (with the
superpowers skills, running autonomously) to brainstorm, plan, and implement the app under
TDD, then builds a Docker image, pushes the source to a private GitHub repo, deploys it
behind Caddy at `<subdomain>.s.ciepka.com`, verifies it is actually serving traffic, and
sends the live link back over Telegram. If anything fails, the deploy is rolled back and the
user gets an honest error — success is never announced unless verification passed.

It is modeled on the existing `n8n-pdf-qa-telegram` workflow (n8n + OpenCode Go LLM backend,
built from source via `src/build.js` + `install.sh`) and reuses the server's existing
Caddy + Docker + `/opt/apps` deployment convention.

## Goals

- Turn a Telegram description into a **verifiably-running**, publicly-served web app.
- Keep human interaction to the minimum: one up-front batch of essential clarifications plus
  the mandatory subdomain question; everything else (plans, design, implementation choices)
  is auto-approved by the agent using its best recommendation.
- Be **maximally reliable** on a constrained box — never announce an app that isn't actually
  live; never leave a half-deployed mess behind.
- Apps are publicly accessible by default unless the description says otherwise.

## Non-goals

- Coolify or any other PaaS (see Constraints — the server cannot host it).
- Heavy/multi-container stacks or external DB servers (Postgres/MySQL).
- Guaranteeing the *quality* of generated app code — the contract is that only a
  verified-running container is ever shipped, not that the app is bug-free.
- Mid-build interactive Q&A (explicitly designed out in favor of up-front questions).

## Constraints (server ground truth, measured 2026-06-21)

- Host: `server` → `root@89.167.71.120`. **2 CPU, 3.7 GB RAM, no swap.**
- Disk: 38 GB, was at **99% (≈668 MB free)**. **3.19 GB of Docker build cache is fully
  reclaimable** (`docker builder prune`) — pruning resolves the immediate crunch.
- Existing containers: `n8n` (v2.14.2, at `https://n8n.s.ciepka.com`), `kalkulator-faktury`.
- Host has `node` v22 and `git`; **opencode and claude are NOT installed** (opencode must be
  installed on the host as part of setup). opencode 1.17.7 is present on the workstation.
- Existing deploy convention (from the `/deploy` skill): app source under `/opt/apps/<app>/`,
  one Docker container per app (`name = image = <app>`, `--restart unless-stopped`), one Caddy
  block per app at `<sub>.s.ciepka.com` in `/etc/caddy/Caddyfile`, redeploy script
  `/opt/apps/redeploy-<app>.sh`.

## Key decisions (resolved during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Agent runtime | **opencode headless**, pointed at OpenCode Go (`https://opencode.ai/zen/go/v1`) | Reuses the existing OpenCode Go key/backend; cheaper than direct Anthropic billing; superpowers run inside a real agent CLI. |
| Where it runs | **On the server**, autonomous | Works 24/7 independent of the workstation; faithful to the all-server PDF QA model. |
| Deploy target | **Caddy + Docker** (not Coolify) | Coolify needs ~2 GB RAM + GBs of disk; would destabilize a 99%-full, swapless 3.7 GB box. |
| Interaction model | **All questions up-front, then fully autonomous** | Honors "only essential questions"; avoids a fragile mid-build pause/resume bridge. |
| App stack | **Vetted lightweight set + optional SQLite** | Predictable, low-resource, easy to verify; SQLite gives persistence without a DB container. |
| App source | **Private GitHub repo per app** | Off-server backup + portability + standard redeploy convention, without public clutter. |
| n8n → runner | **Host HTTP runner daemon (systemd)** on the Docker bridge | Truly async, survives n8n restarts, single place for queue + logs, keeps Docker/opencode on the host. |

## Architecture

```
Telegram  ──webhook──►  n8n workflow "deploybot"        Server host (89.167.71.120)
(BotFather bot)         (container, front-end)          ┌─────────────────────────────┐
                          │  whitelist                   │  agent-runner (systemd)     │
   user ◄──messages───────┤  up-front Q&A                │   HTTP on 172.17.0.1:8787   │
                          │  subdomain validation        │   one-at-a-time job queue   │
                          │                              │     │                       │
                          └──POST /jobs (async)─────────►│     ├─ opencode headless    │
                                                         │     │   (superpowers, auto) │
   user ◄──link / error───────(runner → Telegram)───────┤     ├─ git → private GitHub │
                                                         │     ├─ docker build + run   │
                                                         │     ├─ Caddy block + reload │
                                                         │     ├─ verify (curl 200)    │
                                                         │     └─ docker builder prune │
                                                         └─────────────────────────────┘
                                                   app served at <sub>.s.ciepka.com
```

## Components

### 1. Telegram bot
A new BotFather bot whose webhook targets the n8n workflow. Closed by default; only chat IDs
listed in the workflow's Config node (`allowedChatIds`, reusing the PDF QA pattern) may use it.

### 2. n8n workflow `deploybot`
Built from source like the PDF QA repo (`src/build.js` → `workflow.json`, deployed via
`install.sh`; imported with a fixed workflow id). All steps are fast — no long-running work
lives in n8n. Responsibilities:

- **Telegram Trigger + whitelist gate.** Non-whitelisted chats get a polite refusal.
- **Per-chat session state machine** (`idle → clarifying → building → idle`), stored in
  workflow static data (like PDF QA's session memory).
- **Intake LLM step** (OpenCode Go): given the description, returns structured JSON with
  `questions[]` (only essential clarifications; model instructed to assume sensible defaults
  and ask the minimum) plus the always-present subdomain question, phrased in the user's
  language (Polish default, like PDF QA).
- **Answer collection** across one or more user messages; an LLM mapping step turns free-form
  replies into the structured answer set.
- **Subdomain validation:** label-valid regex AND free on the server (absent from the
  Caddyfile and no `/opt/apps/<sub>`). Invalid/taken → re-ask just the subdomain, loop.
- **Handoff:** when all essential answers + a valid free subdomain are gathered, `POST /jobs`
  to the runner; reply "queued/building, link to follow"; session → `idle`.
- **Commands:** `/start`, `/help`, `/status` (proxies the runner's `/status`), `/cancel`.

### 3. agent-runner (host daemon)
A small Node service, systemd-managed, bound to the Docker bridge only (e.g.
`172.17.0.1:8787`; not exposed publicly). Owns:

- **HTTP API:** `POST /jobs` (enqueue, returns `202 {jobId, queuePosition}`), `GET /status`
  (queue + last results), `GET /jobs/:id`.
- **Single-job queue** (serialized — never two builds at once on 2 CPU).
- **Build → deploy → verify pipeline** (see Data flow / Reliability).
- **Direct Telegram send** (holds the bot token) for the final link / honest error.
- **Secrets** (bot token, OpenCode Go key, GitHub PAT) in a root-owned `.env` (mode 600) at
  `/opt/apps/deploybot-runner/.env` — never in n8n or git.
- **Persistence:** an on-disk `jobs.json` (jobId, status, timestamps, result, last error) so
  `/status` survives restarts; per-job logs at `/opt/apps/<appName>/.deploybot/build.log`.

### 4. opencode headless + superpowers (host)
opencode installed on the host, superpowers installed for it, configured to use OpenCode Go.
Invoked non-interactively by the runner with a system prompt enforcing:
- autonomous operation — self-approve plans/design/implementation choices with the best
  recommendation; never block waiting for a human;
- the vetted lightweight stack (+ optional SQLite);
- must emit a `Dockerfile` and declare a `hostPort`/`containerPort`;
- TDD; the task is not done until `docker build` succeeds and the container passes a local
  health check.

## Data flow

### Phase 1 — Intake & clarification (n8n, fast, interactive)
1. User sends a free-text app description.
2. Whitelist gate; session `idle` → new job draft.
3. Intake LLM call returns `{ questions[], subdomainQuestion }`.
4. n8n sends questions (numbered, one message); session → `clarifying`.
5. User replies; answers mapped and collected. Subdomain validated (regex + free on server);
   loop on the subdomain until valid.
6. Assemble job payload:
   ```json
   { "chatId", "description", "answers": {}, "subdomain",
     "appName": "<derived from subdomain>", "public": true }
   ```

### Phase 2 — Handoff (n8n → runner, async)
7. `POST 172.17.0.1:8787/jobs` → `202 {jobId, queuePosition}`.
8. Bot: "✅ Queued (position N) — building, I'll send the link when it's live." Session → `idle`.

### Phase 3 — Build → deploy → verify (runner, autonomous, minutes)
9. Dequeue (one at a time). Fresh working dir `/opt/apps/<appName>`.
10. opencode headless runs: brainstorm/plan/implement under TDD, self-approving, constrained
    to the vetted stack; produces app source, tests, a `Dockerfile`, and a declared port.
11. `docker build -t <appName>`; create **private GitHub repo**; push source.
12. Deploy per convention: `docker run -d --restart unless-stopped --name <appName>
    -p <hostPort>:<containerPort> <appName>`; add Caddy block
    `<sub>.s.ciepka.com { reverse_proxy localhost:<hostPort> }`; `caddy reload`; write
    `/opt/apps/redeploy-<appName>.sh`.
13. Verify (all must pass): container `Up` & not restarting → `curl localhost:<hostPort>`
    2xx/3xx → `curl https://<sub>.s.ciepka.com` 2xx/3xx.
14. `docker builder prune -f`.
15. Telegram: success = `🚀 Live: https://<sub>.s.ciepka.com` (+ repo link); failure = honest
    error summary.

### State stores
- **n8n:** per-chat session (phase + job draft) in workflow static data (ephemeral).
- **runner:** in-memory queue + on-disk `jobs.json` log.

## Error handling & reliability

### Build-loop self-correction (inside opencode)
TDD; the Docker build and a container smoke-test are part of the agent's own loop — not "done"
until `docker build` succeeds and the container answers a local health check. Bounded retry
budget (≈3 build-fix iterations) on build/run failures.

### Deploy gates (runner, outside the agent)
- **Atomic-ish deploy:** build image → run container → wait for health → **only then** write
  the Caddy block + reload. Any failure triggers **rollback**: stop/remove container, remove
  image, remove Caddy block if added, `caddy reload`. Box returns to its prior state; the
  subdomain stays free.
- **Three-layer verification** (all must pass, else rollback + report failure): container up &
  stable → local curl 2xx/3xx → public-URL curl 2xx/3xx. A 502 is a **failure**, not success.

### Resource guards
- **Single concurrent job** (serialized queue).
- **Pre-flight disk check:** if free disk < threshold (≈2 GB), `docker builder prune -f` first;
  if still under, **fail fast** with a clear message instead of crashing mid-build.
- **Post-deploy** `docker builder prune -f` every time.
- **Per-job timeout** (≈20 min, configurable). On timeout → kill, roll back, report.
- Deployed apps run with `--restart unless-stopped`.

### Failure reporting (honest)
Every failure path sends a plain, truthful Telegram message: which phase failed, the short
error, and confirmation that nothing was left half-deployed. No "✅ done" unless verification
passed. Full per-job logs kept on the host; `/status` surfaces the last error line.

### Idempotency & safety
- Subdomain re-checked for availability at **dequeue time** (not only at intake).
- Runner refuses to touch apps it didn't create (won't overwrite `n8n`, `kalkulator-faktury`,
  …); appName collision → fail.
- Secrets only in the runner's root-owned `.env` (mode 600).

## Testing strategy

### Unit tests (fast, no network) — `node:test`, like the PDF QA repo
- **n8n source libs:** subdomain validation (regex + reserved names); intake-response parsing
  (LLM JSON → questions/answers; malformed JSON handling); session state-machine transitions;
  whitelist gate.
- **runner libs:** job-payload validation; queue logic (enqueue/dequeue, single-flight,
  position); Caddy-block generation + rollback step list; disk-threshold + appName-collision
  guards.

### Integration tests (mocked boundaries)
Runner pipeline with `docker`, `git`, `curl`, `caddy`, Telegram, and opencode **stubbed** —
assert stage ordering and that a failure injected at each stage triggers the correct rollback
sequence and an honest Telegram message. Proves "never announce unverified success" and
"always roll back" without touching the real server.

### Manual / acceptance (documented in README; run once against the server)
1. Deploy workflow (`install.sh`) + install/start the runner; create credentials.
2. Whitelisted chat: "a tiny page that shows the current time in Warsaw" → answer subdomain
   prompt → confirm the live link works.
3. Deliberately impossible request → confirm honest failure + clean rollback (subdomain still
   free; no leftover container/image/Caddy block).
4. `/status` reflects queue + last result; build cache pruned.

### Explicitly not tested
The quality of LLM-generated app code (non-deterministic). The tested contract is that the
pipeline only ships a **verified-running** container.

## Setup / operational steps (one-time)
- Prune build cache on the server (`docker builder prune -f`) to clear the 99% disk crunch.
- Install opencode on the host + superpowers for it; configure OpenCode Go provider.
- Create the BotFather bot; set its webhook to the n8n workflow.
- Create the runner's `/opt/apps/deploybot-runner/.env` (bot token, OpenCode Go key, GitHub
  PAT); install the systemd unit; start it.
- In n8n: create the Telegram + OpenCode Go credentials, set `allowedChatIds`, activate the
  workflow.

## Repository layout (this repo: `deploybot`)
- `src/` — n8n workflow source (template + libs), `build.js`, mirroring the PDF QA repo.
- `runner/` — the host agent-runner service (Node), its libs, and tests.
- `runner/systemd/deploybot-runner.service` — systemd unit.
- `install.sh` — build + deploy the n8n workflow (like PDF QA).
- `scripts/` — runner install/update helper(s).
- `test/` — unit + integration tests (`node:test`).
- `README.md` — setup, credentials, commands, acceptance checklist.

## Open questions / future work
- Optional `/list` and `/destroy <app>` commands to manage previously deployed apps.
- Optional periodic disk/health report to the owner chat.
