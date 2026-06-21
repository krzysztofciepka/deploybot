import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../../runner/lib/telegram.js';

test('posts to the Telegram sendMessage endpoint', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const r = await sendMessage('TOK', 42, 'hi', { fetchImpl: fakeFetch });
  assert.equal(r.ok, true);
  assert.match(captured.url, /botTOK/);
  assert.match(captured.url, /\/botTOK\/sendMessage/);
  assert.equal(captured.body.chat_id, 42);
  assert.equal(captured.body.text, 'hi');
});
