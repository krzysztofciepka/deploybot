import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidLabel, isReserved, validateAppName } from '../../runner/lib/names.js';

test('valid labels', () => {
  assert.equal(isValidLabel('clock'), true);
  assert.equal(isValidLabel('my-app-2'), true);
});
test('invalid labels', () => {
  assert.equal(isValidLabel('-bad'), false);
  assert.equal(isValidLabel('Bad'), false);
  assert.equal(isValidLabel('a_b'), false);
  assert.equal(isValidLabel('a'.repeat(64)), false);
});
test('reserved names', () => {
  assert.equal(isReserved('n8n'), true);
  assert.equal(isReserved('deploybot'), true);
  assert.equal(isReserved('clock'), false);
});
test('validateAppName combines both', () => {
  assert.equal(validateAppName('clock').ok, true);
  assert.equal(validateAppName('n8n').ok, false);
  assert.equal(validateAppName('Bad').ok, false);
});
