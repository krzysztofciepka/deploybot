import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollbackCommands } from '../../runner/lib/rollback.js';

test('full rollback includes container, image, workdir', () => {
  const cmds = rollbackCommands({ appName: 'clock', caddyAdded: false });
  const j = cmds.join('\n');
  assert.match(j, /docker rm -f clock/);
  assert.match(j, /docker image rm -f clock/);
  assert.match(j, /rm -rf \/opt\/apps\/clock/);
  assert.doesNotMatch(j, /caddy reload/);
});

test('rollback restores caddy only when a block was added', () => {
  const cmds = rollbackCommands({ appName: 'clock', caddyAdded: true });
  const j = cmds.join('\n');
  assert.match(j, /caddy reload/);
});
