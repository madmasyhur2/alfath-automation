const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCallbackData } = require('../src/parsers/callback');

test('parses cmd and action only', () => {
  assert.deepEqual(parseCallbackData('absen:save'), { cmd: 'absen', action: 'save', args: [] });
});

test('parses args', () => {
  assert.deepEqual(parseCallbackData('absen:set:12:S'),
    { cmd: 'absen', action: 'set', args: ['12', 'S'] });
});

test('empty or null yields null', () => {
  assert.equal(parseCallbackData(''), null);
  assert.equal(parseCallbackData(null), null);
});
