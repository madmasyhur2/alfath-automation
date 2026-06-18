const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseScores } = require('../src/parsers/scores');

const roster = [
  { idx: 1, santri_id: 10, nama: 'Adi' },
  { idx: 2, santri_id: 11, nama: 'Budi' },
];

test('parses "no nilai" pairs across lines and spaces', () => {
  const r = parseScores('1 85\n2 90.5', roster);
  assert.deepEqual(r.entries, [
    { idx: 1, santri_id: 10, nilai: 85 },
    { idx: 2, santri_id: 11, nilai: 90.5 },
  ]);
  assert.deepEqual(r.errors, []);
});

test('rejects out-of-range and unknown number and duplicate', () => {
  assert.match(parseScores('1 120', roster).errors[0], /0–100|0-100/);
  assert.match(parseScores('9 80', roster).errors[0], /tidak dikenal/);
  const dup = parseScores('1 80\n1 90', roster);
  assert.equal(dup.entries.length, 1);
  assert.match(dup.errors[0], /dua kali/);
});

test('empty message is an error', () => {
  assert.match(parseScores('   ', roster).errors[0], /kosong/);
});
