const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPickKeyboard, buildAbsenKeyboard } = require('../src/format/keyboard');

test('buildPickKeyboard makes one button per item, chunked', () => {
  const kb = buildPickKeyboard(
    [{ id: 3, nama: '4A' }, { id: 4, nama: '4B' }, { id: 5, nama: '5A' }],
    'nilai', 'kelas', 'nama', 'id', 2);
  assert.deepEqual(kb, [
    [ { text: '4A', callback_data: 'nilai:kelas:3' }, { text: '4B', callback_data: 'nilai:kelas:4' } ],
    [ { text: '5A', callback_data: 'nilai:kelas:5' } ],
  ]);
});

test('buildAbsenKeyboard marks active status and paginates', () => {
  const roster = [
    { idx: 1, santri_id: 10, nama: 'Adi' },
    { idx: 2, santri_id: 11, nama: 'Budi' },
  ];
  const status = { 1: 'hadir', 2: 'sakit' };
  const kb = buildAbsenKeyboard(roster, status, 1, 10);
  // First row = student label (noop), second row = 4 status buttons.
  assert.equal(kb[0][0].text, '1. Adi — ✅ Hadir');
  assert.equal(kb[0][0].callback_data, 'absen:noop:1');
  assert.deepEqual(kb[1].map((b) => b.callback_data),
    ['absen:set:1:H', 'absen:set:1:S', 'absen:set:1:I', 'absen:set:1:A']);
  assert.equal(kb[2][0].text, '2. Budi — 🤒 Sakit');
  // Last rows = actions (no pagination needed for 2 ≤ 10 page size).
  const flat = kb.flat().map((b) => b.callback_data);
  assert.ok(flat.includes('absen:ket'));
  assert.ok(flat.includes('absen:save'));
  assert.ok(flat.includes('absen:cancel'));
  assert.ok(!flat.includes('absen:page:2'));
});
