const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  STATUS_BY_CODE, initStatus, applyStatus, setKeterangan, summarize, toAbsensiBatch,
} = require('../src/logic/absen');

const roster = [
  { idx: 1, santri_id: 10, nama: 'Adi' },
  { idx: 2, santri_id: 11, nama: 'Budi' },
  { idx: 3, santri_id: 12, nama: 'Citra' },
];

test('initStatus defaults everyone to hadir', () => {
  assert.deepEqual(initStatus(roster), { 1: 'hadir', 2: 'hadir', 3: 'hadir' });
});

test('applyStatus maps a code and rejects unknown', () => {
  const s = applyStatus(initStatus(roster), 2, 'S');
  assert.equal(s[2], 'sakit');
  assert.throws(() => applyStatus(s, 2, 'X'));
});

test('summarize counts statuses and late (keterangan "Terlambat")', () => {
  let s = applyStatus(initStatus(roster), 2, 'S');
  const ket = setKeterangan({}, 1, 'Terlambat 10 Menit');
  const sum = summarize(s, roster, ket);
  assert.deepEqual(sum, { hadir: 2, sakit: 1, izin: 0, alpha: 0, terlambat: 1 });
});

test('toAbsensiBatch emits all students with keterangan only where set', () => {
  let s = applyStatus(initStatus(roster), 2, 'S');
  const ket = setKeterangan({}, 1, 'Terlambat 10 Menit');
  const batch = toAbsensiBatch({ kelas_id: 3, tanggal: '2026-06-17', roster, statusMap: s, ketMap: ket });
  assert.equal(batch.kelas_id, 3);
  assert.equal(batch.tanggal, '2026-06-17');
  assert.deepEqual(batch.items, [
    { santri_id: 10, status: 'hadir', keterangan: 'Terlambat 10 Menit' },
    { santri_id: 11, status: 'sakit' },
    { santri_id: 12, status: 'hadir' },
  ]);
});
