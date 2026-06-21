// runner/lib/pipeline.js
import { validateAppName } from './names.js';
import { addBlock, removeBlock } from './caddy.js';
import { usedPorts, pickPort } from './ports.js';
import { availableBytes, hasHeadroom } from './disk.js';
import { buildPrompt, buildUpdatePrompt, buildCommand } from './opencode.js';
import { pushCommands } from './github.js';
import { rollbackCommands } from './rollback.js';
import { formatEvent } from './events.js';

// Run the agent while live-streaming its opencode JSON events to Telegram.
// Reads the growing build.log, formats new complete lines, and sends batched digests.
async function runAgentStreaming(deps, cmd, logFile, timeoutMs, notify) {
  const { sh, readFile } = deps;
  const run = sh(cmd, { timeoutMs });
  let offset = 0, pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      let content = '';
      try { content = await readFile(logFile, 'utf8'); } catch { return; }
      const lines = content.split('\n');
      const complete = content.endsWith('\n') ? lines.length : lines.length - 1;
      const batch = [];
      for (let i = offset; i < complete; i++) { const f = formatEvent(lines[i]); if (f) batch.push(f); }
      offset = complete;
      while (batch.length) await notify(batch.splice(0, 12).join('\n'));
    } finally { pumping = false; }
  };
  const intervalMs = Number(deps.env?.STREAM_INTERVAL_MS || 15000);
  const timer = setInterval(() => { pump().catch(() => {}); }, intervalMs);
  let oc;
  try { oc = await run; } finally { clearInterval(timer); }
  await pump(); // final flush
  return oc;
}

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

// Tear down an app: Caddy block, container, image, source dir, redeploy script, GitHub repo.
// Refuses reserved/invalid names so it can never remove n8n, kalkulator-faktury, etc.
export async function runDestroy(appName, deps) {
  const { sh, readFile, writeFile } = deps;
  const v = validateAppName(appName);
  if (!v.ok) return { ok: false, error: v.error };
  const dir = `/opt/apps/${appName}`;
  try {
    const caddy = await readFile(CADDYFILE, 'utf8');
    if (String(caddy).includes(`${appName}.s.ciepka.com`)) {
      await writeFile(CADDYFILE, removeBlock(caddy, appName));
      await sh('caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl reload caddy');
    }
  } catch (e) { /* caddy missing/unreadable — continue teardown */ }
  await sh(`docker rm -f ${appName} 2>/dev/null || true`);
  await sh(`docker image rm -f ${appName} 2>/dev/null || true`);
  await sh(`rm -rf ${dir} /opt/apps/redeploy-${appName}.sh`);
  const gh = await sh(`gh repo delete ${appName} --yes 2>&1`); // needs delete_repo scope; non-fatal
  await sh('docker builder prune -f');
  return { ok: true, appName, repoDeleted: gh.code === 0 };
}

export async function runJob(job, deps) {
  const { sh, sendMessage, readFile, writeFile, env } = deps;
  const app = job.appName;
  const dir = `/opt/apps/${app}`;
  const token = env.TELEGRAM_BOT_TOKEN;
  const timeoutMs = Number(env.JOB_TIMEOUT_MS || 3600000); // default 1h
  const floor = Number(env.DISK_FLOOR_BYTES || 2000000000);
  // Allow test injection of retry delays via env (default to brief values in production)
  const localRetryDelayMs = Number(env.RETRY_DELAY_LOCAL_MS || 2000);
  const publicRetryDelayMs = Number(env.RETRY_DELAY_PUBLIC_MS || 3000);
  const logFile = `${dir}/.deploybot/build.log`;
  let caddyAdded = false;

  // milestone notifier — best-effort, never lets a Telegram hiccup break the build
  const notify = async (m) => {
    try { await sendMessage(token, job.chatId, m); } catch (e) { /* ignore */ }
  };

  const fail = async (msg) => {
    let caddyText = '';
    if (caddyAdded) {
      caddyText = removeBlock(await readFile(CADDYFILE, 'utf8'), app);
      await writeFile(CADDYFILE, caddyText);
    }
    for (const cmd of rollbackCommands({ appName: app, caddyAdded })) await sh(cmd);
    await sendMessage(token, job.chatId, `❌ Nie udało się wdrożyć „${app}": ${msg}\nNic nie zostało po połowie wdrożone.`);
    return { ok: false, error: msg };
  };

  const dirExists = (await sh(`[ -d ${dir} ] && echo yes || echo no`)).stdout.trim() === 'yes';

  // ===== UPDATE an existing app, in place. A failed update never destroys the running version. =====
  if (job.update && dirExists) {
    const updateFail = async (msg) => {
      await sendMessage(token, job.chatId, `❌ Aktualizacja „${app}" nie powiodła się: ${msg}\nPoprzednia wersja działa dalej.`);
      return { ok: false, error: msg };
    };
    await notify(`🔧 Aktualizuję aplikację „${app}"…`);

    // reuse the existing host port so the Caddy block stays valid
    const portOut = await sh(`docker port ${app} 2>/dev/null | head -1`);
    const pm = (portOut.stdout || '').match(/:(\d+)\s*$/);
    let hostPort = pm ? Number(pm[1]) : null;

    // disk guard
    let df = await sh('df -B1 /');
    if (!hasHeadroom(availableBytes(df.stdout), floor)) {
      await sh('docker builder prune -f');
      df = await sh('df -B1 /');
      if (!hasHeadroom(availableBytes(df.stdout), floor)) return updateFail('za mało miejsca na dysku');
    }

    await sh(`mkdir -p ${dir}/.deploybot`);
    await writeFile(`${dir}/.deploybot/prompt.txt`, buildUpdatePrompt(job));
    await notify('🤖 Agent wprowadza zmiany — na żywo poniżej. (/status = podgląd)');
    const oc = await runAgentStreaming(deps, `${buildCommand(dir, env.BUILD_MODEL)} > ${logFile} 2>&1`, logFile, timeoutMs, notify);
    if (oc.code !== 0) return updateFail(`agent nie ukończył zmian (kod ${oc.code})`);

    let containerPort;
    try { containerPort = JSON.parse(await readFile(`${dir}/.deploybot/app.json`, 'utf8')).containerPort; }
    catch { return updateFail('brak .deploybot/app.json'); }
    if (!Number.isInteger(containerPort)) return updateFail('nieprawidłowy containerPort');

    await notify('🔨 Buduję nowy obraz…');
    const build = await sh(`docker build -t ${app} ${dir} >> ${logFile} 2>&1`, { timeoutMs });
    if (build.code !== 0) return updateFail('docker build nie powiódł się');

    if (!hostPort) {
      const ps = await sh(`docker ps --format '{{.Ports}}'`);
      hostPort = pickPort(usedPorts(ps.stdout));
    }
    await notify('🚀 Podmieniam kontener…');
    await sh(`docker rm -f ${app} 2>/dev/null || true`);
    const run = await sh(`docker run -d --restart unless-stopped --name ${app} -p ${hostPort}:${containerPort} ${app}`);
    if (run.code !== 0) return updateFail('docker run nie powiódł się: ' + (run.stderr || '').trim().slice(-300));

    // make sure Caddy routes this subdomain to the current port
    const caddyText = await readFile(CADDYFILE, 'utf8');
    if (!caddyText.includes(`${app}.s.ciepka.com`) || !caddyText.includes(`localhost:${hostPort}`)) {
      await writeFile(CADDYFILE, addBlock(removeBlock(caddyText, app), app, hostPort));
      await sh('caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl reload caddy');
    }

    const localOk = await retry(async () => {
      const up = await sh(`docker ps --filter name=^/${app}$ --format '{{.Status}}'`);
      if (!/^Up/.test(up.stdout.trim())) return false;
      return httpOk(await curlStatus(sh, `localhost:${hostPort}`));
    }, 10, localRetryDelayMs);
    if (!localOk) return updateFail('zaktualizowany kontener nie odpowiada lokalnie');

    await notify('🔎 Sprawdzam, czy działa publicznie…');
    const publicOk = await retry(async () => httpOk(await curlStatus(sh, `https://${app}.s.ciepka.com`)), 10, publicRetryDelayMs);
    if (!publicOk) return updateFail('publiczny adres nie odpowiada');

    // commit + push the update (best-effort — the repo already exists)
    await sh(`git -C ${dir} add -A && git -C ${dir} -c user.email=deploybot@s.ciepka.com -c user.name=deploybot commit -q -m "Update (deploybot)" 2>/dev/null; git -C ${dir} push 2>/dev/null || true`);
    await sh('docker builder prune -f');
    const link = `https://${app}.s.ciepka.com`;
    await sendMessage(token, job.chatId, `✅ Zaktualizowano! Twoja aplikacja działa:\n${link}`);
    return { ok: true, link, updated: true };
  }

  // ===== NEW build =====
  // 1. name + availability
  const nameOk = validateAppName(app);
  if (!nameOk.ok) return fail(nameOk.error);
  if (dirExists) return fail('subdomain już zajęty');
  const caddyNow = await readFile(CADDYFILE, 'utf8');
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

  // 4. opencode — live-stream its JSON inference events to Telegram (and to build.log)
  await notify('🤖 Agent zaczął pracę — pokażę na żywo, co robi. (/status = podgląd)');
  const oc = await runAgentStreaming(deps, `${buildCommand(dir, env.BUILD_MODEL)} > ${logFile} 2>&1`, logFile, timeoutMs, notify);
  if (oc.code !== 0) return fail(`agent nie ukończył budowy (kod ${oc.code})`);

  // 5. app.json
  let containerPort;
  try {
    containerPort = JSON.parse(await readFile(`${dir}/.deploybot/app.json`, 'utf8')).containerPort;
  } catch { return fail('agent nie zapisał .deploybot/app.json'); }
  if (!Number.isInteger(containerPort)) return fail('nieprawidłowy containerPort');

  // 6. build
  await notify('🔨 Kod gotowy — buduję obraz Dockera…');
  const build = await sh(`docker build -t ${app} ${dir} >> ${logFile} 2>&1`, { timeoutMs });
  if (build.code !== 0) return fail('docker build nie powiódł się');

  // 7-8. port + run
  await notify('🚀 Uruchamiam kontener i podłączam do Caddy…');
  const ps = await sh(`docker ps --format '{{.Ports}}'`);
  const hostPort = pickPort(usedPorts(ps.stdout));
  const run = await sh(`docker run -d --restart unless-stopped --name ${app} -p ${hostPort}:${containerPort} ${app}`);
  if (run.code !== 0) return fail('docker run nie powiódł się: ' + (run.stderr || '').trim().slice(-300));

  // 9. local verify — container must report "Up ..." AND answer a local HTTP check; retry while starting.
  //    An empty/exited status does NOT count as up.
  const localOk = await retry(async () => {
    const up = await sh(`docker ps --filter name=^/${app}$ --format '{{.Status}}'`);
    const isUp = /^Up/.test(up.stdout.trim());
    if (!isUp) return false;
    return httpOk(await curlStatus(sh, `localhost:${hostPort}`));
  }, 10, localRetryDelayMs);
  if (!localOk) return fail('kontener nie odpowiada lokalnie');

  // 10. caddy
  await writeFile(CADDYFILE, addBlock(await readFile(CADDYFILE, 'utf8'), app, hostPort));
  caddyAdded = true;
  const reload = await sh('caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || systemctl reload caddy');
  if (reload.code !== 0) return fail('przeładowanie Caddy nie powiodło się');

  // 11. public verify
  await notify('🔎 Sprawdzam, czy aplikacja odpowiada publicznie…');
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
