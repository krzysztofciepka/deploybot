import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEvent, recentActivity } from '../../runner/lib/events.js';

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
