import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedPorts, pickPort } from '../../runner/lib/ports.js';

test('usedPorts parses host ports from docker ps output', () => {
  const text = '0.0.0.0:5678->5678/tcp\n0.0.0.0:8123->80/tcp, :::8123->80/tcp\n';
  const u = usedPorts(text);
  assert.equal(u.has(5678), true);
  assert.equal(u.has(8123), true);
});

test('pickPort returns the lowest free port in range', () => {
  const used = new Set([8100, 8101]);
  assert.equal(pickPort(used, { min: 8100, max: 8999 }), 8102);
});

test('pickPort throws when range exhausted', () => {
  const used = new Set([8100]);
  assert.throws(() => pickPort(used, { min: 8100, max: 8100 }), /no free port/);
});
