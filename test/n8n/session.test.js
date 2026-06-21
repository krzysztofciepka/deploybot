import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSession, startClarifying, markBuilding, reset } from '../../src/lib/session.js';

test('new session starts idle', () => {
  const store = {};
  assert.equal(getSession(store, 7).phase, 'idle');
});
test('transitions idle -> clarifying -> building -> idle', () => {
  const store = {};
  const s = getSession(store, 7);
  startClarifying(s, { description: 'x', answers: {}, questions: ['q1'] });
  assert.equal(s.phase, 'clarifying');
  assert.equal(s.draft.description, 'x');
  markBuilding(s);
  assert.equal(s.phase, 'building');
  reset(s);
  assert.equal(s.phase, 'idle');
  assert.equal(s.draft, null);
});

test('reset clears currentApp', () => {
  const store = {};
  const s = getSession(store, 9);
  s.currentApp = 'clock';
  reset(s);
  assert.equal(s.currentApp, null);
});
