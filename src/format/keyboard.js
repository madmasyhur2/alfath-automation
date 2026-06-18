const STATUS_LABEL = { hadir: '✅ Hadir', sakit: '🤒 Sakit', izin: '📝 Izin', alpha: '❌ Alpha' };
const STATUS_BUTTONS = [['H', 'Hadir'], ['S', 'Sakit'], ['I', 'Izin'], ['A', 'Alpha']];

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildPickKeyboard(items, cmd, action, labelKey, valueKey, perRow = 2) {
  const buttons = items.map((it) => ({
    text: String(it[labelKey]),
    callback_data: `${cmd}:${action}:${it[valueKey]}`,
  }));
  return chunk(buttons, perRow);
}

function buildAbsenKeyboard(roster, statusMap, page = 1, pageSize = 8) {
  const start = (page - 1) * pageSize;
  const pageRows = roster.slice(start, start + pageSize);
  const rows = [];
  for (const r of pageRows) {
    const st = statusMap[r.idx] || 'hadir';
    rows.push([{ text: `${r.idx}. ${r.nama} — ${STATUS_LABEL[st]}`, callback_data: `absen:noop:${r.idx}` }]);
    rows.push(STATUS_BUTTONS.map(([code]) => ({ text: code, callback_data: `absen:set:${r.idx}:${code}` })));
  }
  const totalPages = Math.ceil(roster.length / pageSize);
  if (totalPages > 1) {
    const nav = [];
    if (page > 1) nav.push({ text: '◀', callback_data: `absen:page:${page - 1}` });
    if (page < totalPages) nav.push({ text: '▶', callback_data: `absen:page:${page + 1}` });
    rows.push(nav);
  }
  rows.push([
    { text: '➕ Keterangan', callback_data: 'absen:ket' },
    { text: '💾 Simpan', callback_data: 'absen:save' },
    { text: '✖ Batal', callback_data: 'absen:cancel' },
  ]);
  return rows;
}

module.exports = { buildPickKeyboard, buildAbsenKeyboard, STATUS_LABEL, STATUS_BUTTONS };
