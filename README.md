# deploybot

A Telegram-driven autonomous webapp builder. The bot asks for a minimal description and subdomain, then builds and deploys using opencode (headless code generation), GitHub (private repo), Docker, and Caddy.

## Architecture

Telegram → n8n workflow (intake + async handler) → agent-runner daemon on `server` host → opencode + GitHub → Docker + Caddy deploy → link back via Telegram.

The runner listens for queued jobs, spawns isolated `opencode` sessions, pushes generated code to a private GitHub repo, builds a Docker image, deploys via Caddy, verifies the live link, and rolls back on failure with an honest error message.

## Prerequisites

- **BotFather Telegram bot:** create a bot via BotFather, obtain the API token
- **OpenCode Go API key:** generate from the OpenCode dashboard
- **GitHub Personal Access Token (PAT):** with `repo` and `delete_repo` permissions (or authenticate `gh auth login`)
- **Host tools:** `opencode` CLI + superpowers (`sp`) and GitHub `gh` CLI must be installed and available on the `server` host
- **Daemon:** the agent-runner must be running via systemd (installed by `scripts/install-runner.sh`)
- **n8n container:** running at `https://n8n.s.ciepka.com`, container name `n8n`
- **Docker & Caddy:** already present on `server` host; apps deployed as Docker containers and proxied via Caddy

## Deployment

### Step 1: Install and start the agent-runner daemon

On the `server` host, run the installer:

```bash
./scripts/install-runner.sh
```

This installs the systemd service. Then edit the `.env` file with real credentials:

```bash
sudo vi /opt/apps/deploybot-runner/.env
```

Configure:
- `TELEGRAM_BOT_TOKEN`: BotFather token
- `OPENCODE_API_KEY`: OpenCode Go API key
- `GITHUB_TOKEN`: personal access token (or rely on `gh auth login`)
- `JOB_TIMEOUT_MS`: max job duration (default: 1200000 ms = 20 min)
- `DISK_FLOOR_BYTES`: minimum free disk before declining jobs (default: 2000000000 = 2 GB)

Then start the service:

```bash
sudo systemctl start deploybot-runner
sudo systemctl enable deploybot-runner
```

### Step 2: Build and import the n8n workflow

Build the workflow and import it into n8n:

```bash
./install.sh
```

This:
1. Builds `workflow.json` via `node src/build.js`
2. Copies it to the `server` host
3. Imports it into the n8n container
4. Leaves it **INACTIVE** (finish in the UI)

## Post-Import Configuration

After `./install.sh` completes, finish in the n8n UI:

1. **Create credentials:**
   - Telegram API: create a credential named `Telegram deploybot Bot` with the BotFather token
   - OpenCode Go Header Auth (if the workflow uses credentialed httpRequest): store the API key

2. **Set allowedChatIds:**
   - Open the workflow in edit mode
   - Find the **Config** node
   - Set `allowedChatIds` to a comma-separated list of Telegram chat IDs (e.g., `123456789,987654321`)
   - Set `language` to `Polish` (default) or your preferred language
   - Set `base` to the OpenCode API base URL

3. **Activate the workflow:** click the Activate toggle in the n8n UI

## Telegram Commands

The deployed bot responds to:
- `/start`: show welcome message and check subscription status
- `/help`: list available commands and usage
- `/status`: show the current job queue and last build result
- `/cancel`: cancel the current job (if queued or in progress)

## How It Works

1. User sends a Telegram message (e.g., "a tiny page that shows the current time in Warsaw")
2. n8n intake node validates the request and asks for a subdomain (if not provided)
3. n8n handler enqueues the job to the agent-runner and returns immediately
4. Runner daemon dequeues the job, spawns an isolated `opencode` session
5. opencode generates code and stores it in a private GitHub repo
6. Runner builds a Docker image from the repo, deploys it via Caddy
7. Runner verifies the live link works
8. Runner sends the live link back via Telegram
9. On failure, runner sends an honest error message and rolls back (removes container, image, Caddy block)

## Acceptance Checklist

1. **Clear disk space:** on the `server` host, run `docker builder prune -f` to free ~3 GB build cache
2. **Install host tools:** ensure `opencode`, `sp` (superpowers), and `gh` are installed and available; authenticate `gh` with `gh auth login` or set `GITHUB_TOKEN`
3. **Install runner:** run `scripts/install-runner.sh`; edit `/opt/apps/deploybot-runner/.env` with real secrets; `systemctl start deploybot-runner`
4. **Import workflow:** run `./install.sh`; create Telegram + OpenCode credentials in n8n UI; set `allowedChatIds`; click Activate
5. **Test happy path:** from a whitelisted Telegram chat, send "a tiny page that shows the current time in Warsaw" → answer the subdomain prompt → confirm the live `https://<sub>.s.ciepka.com` link works
6. **Test rollback:** send an impossible request → confirm an honest failure message + clean rollback (subdomain still free, no leftover container/image/Caddy block)
7. **Verify status command:** `/status` reflects the current job queue and the last build result

## Important Honesty Note

The n8n workflow template is a working scaffold authored without a live n8n instance. After import, you must:
- Verify the node wiring and connections in the editor
- Create the Telegram and OpenCode credentials in the n8n UI
- Set `allowedChatIds` in the Config node
- Click Activate to go live

The bot will ask clarifying questions upfront (subdomain, optional tweaks) and then build autonomously. The runner sends the live link back to Telegram when ready, or an honest error message if something fails.
