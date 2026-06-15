const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAttendanceMessage } = require('../src/parsers/attendance');

const roster = [
  { idx: 1, student_id: 'S-001', name: 'Adi Nugroho' },
  { idx: 2, student_id: 'S-002', name: 'Budi Santoso' },
  { idx: 3, student_id: 'S-003', name: 'Citra Dewi' },
];

test('nihil means everyone present', () => {
  const r = parseAttendanceMessage('nihil', roster);
  assert.equal(r.allPresent, true);
  assert.deepEqual(r.exceptions, []);
  assert.deepEqual(r.errors, []);
});

test('parses one student with status and reason', () => {
  const r = parseAttendanceMessage('2 S demam', roster);
  assert.equal(r.allPresent, false);
  assert.deepEqual(r.exceptions, [
    { student_id: 'S-002', name: 'Budi Santoso', status: 'S', reason: 'demam' },
  ]);
  assert.deepEqual(r.errors, []);
});

test('parses multiple lines incl. late with arrival time', () => {
  const r = parseAttendanceMessage('1 T 18:10\n3 A', roster);
  assert.deepEqual(r.exceptions, [
    { student_id: 'S-001', name: 'Adi Nugroho', status: 'T', reason: '18:10' },
    { student_id: 'S-003', name: 'Citra Dewi', status: 'A', reason: '' },
  ]);
  assert.deepEqual(r.errors, []);
});

test('flags unknown roster number', () => {
  const r = parseAttendanceMessage('9 S sakit', roster);
  assert.equal(r.exceptions.length, 0);
  assert.match(r.errors[0], /Nomor tidak dikenal/);
});

test('flags invalid status', () => {
  const r = parseAttendanceMessage('1 X', roster);
  assert.equal(r.exceptions.length, 0);
  assert.match(r.errors[0], /Status tidak valid/);
});

test('flags duplicate number but keeps the first', () => {
  const r = parseAttendanceMessage('1 S\n1 A', roster);
  assert.equal(r.exceptions.length, 1);
  assert.match(r.errors[0], /dua kali/);
});

test('empty message is an error', () => {
  const r = parseAttendanceMessage('   ', roster);
  assert.equal(r.allPresent, false);
  assert.match(r.errors[0], /kosong/);
});
