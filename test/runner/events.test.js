import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEvent, recentActivity, sessionIdFrom, findAsk } from '../../runner/lib/events.js';

test('formats tool_use events by tool', () => {
  assert.equal(formatEvent(JSON.stringify({ type: 'tool_use', part: { tool: 'skill', state: { input: { name: 'test-driven-development' } } } })), '🧠 skill: test-driven-development');
  assert.equal(formatEvent(JSON.stringify({ type: 'tool_use', part: { tool: 'write', state: { input: { filePath: 'index.html' } } } })), '📝 write: index.html');
  assert.match(formatEvent(JSON.stringify({ type: 'tool_use', part: { tool: 'bash', state: { input: { command: 'ls -la' } } } })), /^💻 ls -la/);
});
test('formats assistant text', () => {
  assert.equal(formatEvent(JSON.stringify({ type: 'text', part: { text: 'Building the app now' } })), '💬 Building the app now');
});
test('ignores step events, empty text, and junk', () => {
  assert.equal(formatEvent(JSON.stringify({ type: 'step_finish', part: {} })), null);
  assert.equal(formatEvent(JSON.stringify({ type: 'text', part: { text: '  ' } })), null);
  assert.equal(formatEvent('not json'), null);
});
test('recentActivity returns the last N readable lines', () => {
  const log = [
    JSON.stringify({ type: 'tool_use', part: { tool: 'read', state: { input: { filePath: 'a' } } } }),
    'garbage',
    JSON.stringify({ type: 'step_start', part: {} }),
    JSON.stringify({ type: 'text', part: { text: 'hi' } }),
  ].join('\n');
  assert.deepEqual(recentActivity(log, 8), ['📖 read: a', '💬 hi']);
});

test('sessionIdFrom and findAsk parse the event stream', () => {
  const log = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_abc', part: {} }),
    JSON.stringify({ type: 'text', part: { text: 'thinking...' } }),
    JSON.stringify({ type: 'text', part: { text: 'ASK: what API key should I use?' } }),
  ].join('\n');
  assert.equal(sessionIdFrom(log), 'ses_abc');
  assert.equal(findAsk(log), 'what API key should I use?');
  assert.equal(findAsk(JSON.stringify({ type: 'text', part: { text: 'no question here' } })), null);
});
