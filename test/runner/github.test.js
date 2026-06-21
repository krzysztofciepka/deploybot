import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushCommands } from '../../runner/lib/github.js';

test('creates a private repo and pushes', () => {
  const cmds = pushCommands('clock', '/opt/apps/clock');
  const joined = cmds.join(' && ');
  assert.match(joined, /git init/);
  assert.match(joined, /gh repo create clock --private/);
  assert.match(joined, /--source=\/opt\/apps\/clock/);
  assert.match(joined, /--push/);
});
