'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../server/actions/extras');

test('calculatrice valide : arithmétique, fonctions autorisées et refus de code', () => {
  assert.equal(calculate('1 + 2 * 3'), 7);
  assert.equal(calculate('(2 + 3)^2'), 25);
  assert.equal(calculate('sqrt(81) + abs(-1)'), 10);
  assert.equal(calculate('1,5 + pi - pi'), 1.5);
  assert.equal(calculate('round(3.14159, 2)'), 3.14);
  assert.throws(() => calculate('process.exit()'), /caractère|fonction/);
  assert.throws(() => calculate('1 / 0'), /zéro/);
  assert.throws(() => calculate('globalThis.process'), /caractère/);
});
