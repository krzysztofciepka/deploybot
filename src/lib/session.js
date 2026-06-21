export function getSession(store, chatId) {
  const key = `chat:${chatId}`;
  if (!store[key]) store[key] = { phase: 'idle', draft: null };
  return store[key];
}
export function startClarifying(session, draft) {
  session.phase = 'clarifying';
  session.draft = draft;
}
export function markBuilding(session) {
  session.phase = 'building';
}
export function reset(session) {
  session.phase = 'idle';
  session.draft = null;
}
