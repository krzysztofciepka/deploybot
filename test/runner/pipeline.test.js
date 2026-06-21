import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJob } from '../../runner/lib/pipeline.js';

function makeDeps(overrides = {}) {
  const calls = [];
  const files = { '/etc/caddy/Caddyfile': 'existing.com {\n}\n' };
  const defaultSh = async (cmd) => {
    if (cmd.includes('df -B1')) return { code: 0, stdout: 'h\n/dev/sda1 40000000000 1 9000000000 1% /\n', stderr: '' };
    if (cmd.includes('{{.Status}}')) return { code: 0, stdout: 'Up 2 seconds', stderr: '' };
    if (cmd.includes('docker ps')) return { code: 0, stdout: '', stderr: '' };
    if (cmd.startsWith('curl')) return { code: 0, stdout: '200', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const overrideSh = overrides.sh;
  // Always record calls regardless of which sh implementation is used
  const sh = async (cmd, opts) => {
    calls.push(cmd);
    return overrideSh ? overrideSh(cmd, opts) : defaultSh(cmd, opts);
  };
  const sent = [];
  return {
    calls, sent, files,
    deps: {
      sh,
      sendMessage: async (_t, _c, text) => { sent.push(text); return { ok: true }; },
      readFile: async (p) => {
        if (p.endsWith('app.json')) return JSON.stringify({ containerPort: 80 });
        return files[p] ?? '';
      },
      writeFile: async (p, c) => { files[p] = c; },
      env: { TELEGRAM_BOT_TOKEN: 'T', JOB_TIMEOUT_MS: '1000', DISK_FLOOR_BYTES: '2000000000', RETRY_DELAY_LOCAL_MS: '0', RETRY_DELAY_PUBLIC_MS: '0' },
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
      if (cmd.includes('{{.Status}}')) return { code: 0, stdout: 'Up 2 seconds', stderr: '' };
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

test('runDestroy refuses reserved names and tears down valid apps', async () => {
  const { runDestroy } = await import('../../runner/lib/pipeline.js');
  const reserved = await runDestroy('n8n', { sh: async () => ({ code: 0, stdout: '', stderr: '' }), readFile: async () => '', writeFile: async () => {} });
  assert.equal(reserved.ok, false);
  const calls = [];
  const r = await runDestroy('clock', {
    sh: async (c) => { calls.push(c); return { code: 0, stdout: '', stderr: '' }; },
    readFile: async () => 'clock.s.ciepka.com {\n}\n',
    writeFile: async () => {},
  });
  assert.equal(r.ok, true);
  const j = calls.join('\n');
  assert.match(j, /docker rm -f clock/);
  assert.match(j, /docker image rm -f clock/);
  assert.match(j, /rm -rf \/opt\/apps\/clock/);
  assert.match(j, /gh repo delete clock --yes/);
});
