// runner/lib/exec.js
import { spawn } from 'node:child_process';

export function sh(cmd, { timeoutMs = 0, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    // stdin = 'ignore' (/dev/null): this runner is non-interactive, and a piped stdin that never
    // closes makes some tools (e.g. opencode) block forever at startup waiting on input.
    const child = spawn('bash', ['-lc', cmd], {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
