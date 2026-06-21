// runner/lib/names.js
const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RESERVED = new Set(['n8n', 'kalkulator-faktury', 'www', 'api', 'admin', 'deploybot', 'deploybot-runner']);

export function isValidLabel(s) {
  return typeof s === 'string' && s.length >= 1 && s.length <= 63 && LABEL_RE.test(s);
}
export function isReserved(s) {
  return RESERVED.has(s);
}
export function validateAppName(s) {
  if (!isValidLabel(s)) return { ok: false, error: 'invalid subdomain label' };
  if (isReserved(s)) return { ok: false, error: 'name is reserved' };
  return { ok: true };
}
