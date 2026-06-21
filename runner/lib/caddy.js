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
