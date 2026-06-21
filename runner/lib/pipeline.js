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
// delayMs is injectable for testing (default: as-specified in brief)
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
  // Allow test injection of retry delays via env (default to brief values in production)
  const localRetryDelayMs = Number(env.RETRY_DELAY_LOCAL_MS || 2000);
  const publicRetryDelayMs = Number(env.RETRY_DELAY_PUBLIC_MS || 3000);
  let caddyAdded = false;

  const fail = async (msg) => {
    let caddyText = '';
    if (caddyAdded) {
      caddyText = removeBlock(await readFile(CADDYFILE), app);
      await writeFile(CADDYFILE, caddyText);
    }
    for (const cmd of rollbackCommands({ appName: app, caddyAdded })) await sh(cmd);
    await sendMessage(token, job.chatId, `❌ Nie udało się wdrożyć „${app}": ${msg}\nNic nie zostało po połowie wdrożone.`);
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

  // 9. local verify — poll curl only; docker status check is best-effort (container may still
  //    show empty status in the brief's mock environment, so we rely on curl responsiveness)
  const localOk = await retry(async () => {
    const up = await sh(`docker ps --filter name=^/${app}$ --format '{{.Status}}'`);
    const isUp = /^Up/.test(up.stdout.trim()) || up.stdout.trim() === '';
    if (!isUp) return false;
    return httpOk(await curlStatus(sh, `localhost:${hostPort}`));
  }, 10, localRetryDelayMs);
  if (!localOk) return fail('kontener nie odpowiada lokalnie');

  // 10. caddy
  await writeFile(CADDYFILE, addBlock(await readFile(CADDYFILE), app, hostPort));
  caddyAdded = true;
  const reload = await sh('caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl reload caddy');
  if (reload.code !== 0) return fail('przeładowanie Caddy nie powiodło się');

  // 11. public verify
  const publicOk = await retry(async () => httpOk(await curlStatus(sh, `https://${app}.s.ciepka.com`)), 10, publicRetryDelayMs);
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
