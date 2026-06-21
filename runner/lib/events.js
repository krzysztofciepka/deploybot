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

// First sessionID seen in the event stream (needed to resume the session with `--session`).
export function sessionIdFrom(logText) {
  for (const line of String(logText).split('\n')) {
    try {
      const e = JSON.parse(line);
      if (e.sessionID) return e.sessionID;
      if (e.part && e.part.sessionID) return e.part.sessionID;
    } catch { /* skip */ }
  }
  return null;
}

// The last `ASK: <question>` the agent emitted in this chunk of assistant text, or null.
export function findAsk(logText) {
  let found = null;
  for (const line of String(logText).split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'text') continue;
    const text = String((e.part && e.part.text) || '');
    const m = text.match(/ASK:\s*([^\n]+)/);
    if (m) found = m[1].trim();
  }
  return found;
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
