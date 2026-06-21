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
