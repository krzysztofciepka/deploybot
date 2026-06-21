const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RESERVED = new Set(['n8n', 'kalkulator-faktury', 'www', 'api', 'admin', 'deploybot', 'deploybot-runner']);

export function isValidSubdomain(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= 63 && LABEL_RE.test(s) && !RESERVED.has(s);
}
export function extractSubdomain(text) {
  const after = String(text).match(/(?:subdomain|domena|adres)\s*[:=]?\s*([a-z0-9-]+)/i);
  if (after) {
    const w = after[1].toLowerCase();
    if (isValidSubdomain(w)) return w;
  }
  const lower = String(text).toLowerCase();
  // Try to find a domain name that comes after intent words like "use", "want", "name", "call"
  const afterIntent = lower.match(/(?:use|want|name|call|call it|choose|named?)\s+([a-z0-9-]+)/i);
  if (afterIntent) {
    const w = afterIntent[1].replace(/[^a-z0-9-]/g, '');
    if (isValidSubdomain(w)) return w;
  }
  // Fallback: find any valid subdomain (skip 2-letter words)
  const candidates = lower.split(/\s+/);
  for (const c of candidates) {
    const w = c.replace(/[^a-z0-9-]/g, '');
    if (w.length >= 3 && isValidSubdomain(w)) return w;
  }
  return null;
}
export function allAnswered(questions, answers) {
  return questions.every((q) => answers[q] != null && String(answers[q]).trim() !== '');
}
