export function parseAllowed(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n !== 0);
}
export function isAllowed(allowed, chatId) {
  return allowed.includes(Number(chatId));
}
