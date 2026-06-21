// In-memory rendezvous for mid-build agent questions: the pipeline waits for an answer
// (keyed by chatId) that the HTTP /answer endpoint provides. Best-effort: answers in flight
// are lost on a runner restart (the job then times out).
const waiters = new Map(); // chatId -> { resolve }

export function waitForAnswer(chatId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waiters.delete(String(chatId)); resolve(null); }, timeoutMs);
    waiters.set(String(chatId), {
      resolve: (a) => { clearTimeout(timer); waiters.delete(String(chatId)); resolve(a); },
    });
  });
}

export function provideAnswer(chatId, answer) {
  const w = waiters.get(String(chatId));
  if (!w) return false;
  w.resolve(answer);
  return true;
}

export function isWaiting(chatId) {
  return waiters.has(String(chatId));
}
