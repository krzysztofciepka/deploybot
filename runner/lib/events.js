// Parses an opencode `--format json` event line into a short human-readable progress string.
// Returns null for events we don't surface (step_start/step_finish, unparseable, empty text).
export function formatEvent(line) {
  let e;
  try { e = JSON.parse(line); } catch { return null; }
  const p = e.part || {};
  if (e.type === 'tool_use') {
    const tool = p.tool || p.name || 'tool';
    const input = (p.state && p.state.input) || {};
    if (tool === 'skill') return `🧠 skill: ${input.name || ''}`.trim();
    if (tool === 'write' || tool === 'edit') return `📝 ${tool}: ${input.filePath || input.path || ''}`.trim();
    if (tool === 'read') return `📖 read: ${input.filePath || input.path || ''}`.trim();
    if (tool === 'bash') return `💻 ${String(input.command || '').replace(/\s+/g, ' ').slice(0, 90)}`;
    return `🔧 ${tool}`;
  }
  if (e.type === 'text') {
    const t = String(p.text || '').trim().replace(/\s+/g, ' ');
    return t ? `💬 ${t.slice(0, 160)}` : null;
  }
  return null;
}

// Decode a chunk of build.log into the last `n` readable progress lines (for /status).
export function recentActivity(logText, n = 8) {
  const out = [];
  for (const line of String(logText).split('\n')) {
    const f = formatEvent(line);
    if (f) out.push(f);
  }
  return out.slice(-n);
}
