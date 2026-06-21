export async function sendMessage(token, chatId, text, { fetchImpl } = {}) {
  const f = fetchImpl || fetch;
  const res = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
  });
  const data = await res.json();
  return { ok: !!data.ok };
}
