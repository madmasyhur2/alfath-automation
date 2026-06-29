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

// --- Phase B additions ---
const {
  formatCatatanList, formatCatatanSaved, formatTugasSaved,
} = require('../src/format/summary');

test('formatCatatanList renders recent notes newest-first', () => {
  const s = formatCatatanList('Budi', [
    { tanggal: '2026-06-29', teks: 'Aktif bertanya.' },
    { tanggal: '2026-06-28', teks: 'Lupa buku.' },
  ]);
  assert.match(s, /Catatan terakhir untuk Budi/);
  assert.match(s, /• 2026-06-29: Aktif bertanya\./);
  assert.match(s, /• 2026-06-28: Lupa buku\./);
});

test('formatCatatanList handles empty history', () => {
  assert.equal(formatCatatanList('Budi', []), 'Belum ada catatan untuk Budi.');
});

test('formatCatatanSaved confirms by name', () => {
  assert.equal(formatCatatanSaved('Budi'), '✅ Catatan untuk Budi tersimpan.');
});

test('formatTugasSaved includes tenggat only when set', () => {
  assert.equal(formatTugasSaved('Matematika', '4A', '2026-07-05'),
    '✅ Tugas Matematika 4A tersimpan. (tenggat 2026-07-05)');
  assert.equal(formatTugasSaved('IPA', '5B', null),
    '✅ Tugas IPA 5B tersimpan.');
});
