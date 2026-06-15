const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatRoster } = require('../src/format/roster');

test('numbers each student name on its own line', () => {
  const roster = [
    { idx: 1, student_id: 'S-001', name: 'Adi Nugroho' },
    { idx: 2, student_id: 'S-002', name: 'Budi Santoso' },
  ];
  assert.equal(formatRoster(roster), '1. Adi Nugroho\n2. Budi Santoso');
});

test('empty roster yields empty string', () => {
  assert.equal(formatRoster([]), '');
});
