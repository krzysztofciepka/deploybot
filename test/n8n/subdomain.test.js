import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSubdomain, extractSubdomain, allAnswered } from '../../src/lib/subdomain.js';

test('validates labels and rejects reserved', () => {
  assert.equal(isValidSubdomain('clock'), true);
  assert.equal(isValidSubdomain('n8n'), false);
  assert.equal(isValidSubdomain('Bad'), false);
});
test('extracts a label from a free-form reply', () => {
  assert.equal(extractSubdomain('let us use clock please'), 'clock');
  assert.equal(extractSubdomain('subdomain: my-app'), 'my-app');
  assert.equal(extractSubdomain('???'), null);
});

test('validates explicit-prefix capture (lowercase + isValidSubdomain check)', () => {
  assert.equal(extractSubdomain('subdomain: Clock'), 'clock');  // uppercase gets lowercased & validated
  assert.equal(extractSubdomain('domena: VALID-APP'), 'valid-app');      // i18n keyword, uppercase lowercased, dash preserved
});
test('allAnswered checks coverage', () => {
  assert.equal(allAnswered(['q1', 'q2'], { q1: 'a', q2: 'b' }), true);
  assert.equal(allAnswered(['q1', 'q2'], { q1: 'a' }), false);
  assert.equal(allAnswered([], {}), true);
});
