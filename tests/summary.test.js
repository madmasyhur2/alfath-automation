const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatAbsenSummary, formatNilaiSummary, formatTugasHistory } = require('../src/format/summary');

test('formatAbsenSummary includes counts and late', () => {
  const s = formatAbsenSummary({ hadir: 27, sakit: 1, izin: 1, alpha: 1, terlambat: 2 });
  assert.match(s, /27 Hadir/);
  assert.match(s, /2 terlambat/i);
});

test('formatNilaiSummary names component, count, context', () => {
  assert.equal(
    formatNilaiSummary('Tugas ke-3', 28, 'Matematika', '4A'),
    '✅ Tugas ke-3 tersimpan untuk 28 santri (Matematika 4A).');
});

test('formatTugasHistory renders T1..Tn and average', () => {
  assert.equal(
    formatTugasHistory('Budi', [{ ke: 1, nilai: 80 }, { ke: 2, nilai: 90 }], 85),
    'Budi: T1 80 · T2 90 → rata² 85');
});
