import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intakeSystemPrompt, parseIntake } from '../../src/lib/intake.js';

test('system prompt names the language and the minimal-questions rule', () => {
  const p = intakeSystemPrompt('Polish');
  assert.match(p, /Polish/);
  assert.match(p, /minimum|tylko|only/i);
  assert.match(p, /JSON/);
});
test('parses fenced JSON', () => {
  const r = parseIntake('```json\n{"questions":["q1","q2"]}\n```');
  assert.deepEqual(r.questions, ['q1', 'q2']);
  assert.equal(r.needsSubdomain, true);
});
test('falls back gracefully on garbage', () => {
  const r = parseIntake('I could not produce JSON');
  assert.equal(Array.isArray(r.questions), true);
  assert.equal(r.needsSubdomain, true);
});
