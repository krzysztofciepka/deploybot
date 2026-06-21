import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockFor, addBlock, removeBlock, hasBlock } from '../../runner/lib/caddy.js';

const MARK = '# deploybot:clock';

test('blockFor renders a labelled reverse_proxy block', () => {
  const b = blockFor('clock', 8123);
  assert.match(b, /clock\.s\.ciepka\.com \{/);
  assert.match(b, /reverse_proxy localhost:8123/);
  assert.match(b, new RegExp(MARK));
});

test('addBlock appends and is detectable', () => {
  const out = addBlock('existing.com {\n}\n', 'clock', 8123);
  assert.equal(hasBlock(out, 'clock'), true);
  assert.match(out, /existing\.com/);
});

test('removeBlock is the inverse of addBlock', () => {
  const base = 'existing.com {\n}\n';
  const added = addBlock(base, 'clock', 8123);
  const removed = removeBlock(added, 'clock');
  assert.equal(hasBlock(removed, 'clock'), false);
  assert.match(removed, /existing\.com/);
});
