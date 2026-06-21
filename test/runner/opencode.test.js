import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildCommand } from '../../runner/lib/opencode.js';

test('prompt embeds description, answers, and the hard contract', () => {
  const p = buildPrompt({ description: 'a clock', answers: { tz: 'Europe/Warsaw' }, subdomain: 'clock', public: true });
  assert.match(p, /a clock/);
  assert.match(p, /Europe\/Warsaw/);
  assert.match(p, /Dockerfile/);
  assert.match(p, /\.deploybot\/app\.json/);
  assert.match(p, /containerPort/);
  assert.match(p, /autonomous/i);          // self-approve plans/design
  assert.match(p, /SQLite/);               // allowed stack guidance
});

test('command runs opencode headless in the workdir', () => {
  const c = buildCommand('/opt/apps/clock');
  assert.match(c, /opencode run/);
  assert.match(c, /\/opt\/apps\/clock/);
});
