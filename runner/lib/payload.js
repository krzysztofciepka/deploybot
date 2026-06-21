// runner/lib/payload.js
import { validateAppName } from './names.js';

export function validateJob(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'payload must be an object' };
  if (typeof raw.chatId !== 'number') return { ok: false, error: 'chatId (number) is required' };
  if (typeof raw.description !== 'string' || !raw.description.trim())
    return { ok: false, error: 'description (non-empty string) is required' };
  if (typeof raw.subdomain !== 'string' || !raw.subdomain.trim())
    return { ok: false, error: 'subdomain (non-empty string) is required' };
  const sub = raw.subdomain.trim();
  const nameCheck = validateAppName(sub);
  if (!nameCheck.ok) return { ok: false, error: nameCheck.error };
  const job = {
    chatId: raw.chatId,
    description: raw.description.trim(),
    answers: raw.answers && typeof raw.answers === 'object' ? raw.answers : {},
    subdomain: sub,
    appName: sub,
    public: raw.public === false ? false : true,
  };
  return { ok: true, job };
}
