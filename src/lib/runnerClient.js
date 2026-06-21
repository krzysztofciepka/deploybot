export const RUNNER_URL = 'http://172.17.0.1:8787/jobs';
export function buildJobPayload(draft, subdomain, update) {
  const isPrivate = /\b(private|prywatn|tylko dla mnie|nie publiczn)\b/i.test(draft.description || '');
  return {
    chatId: Number(draft.chatId),
    description: draft.description,
    answers: draft.answers || {},
    subdomain,
    public: !isPrivate,
    update: update === true,
  };
}
