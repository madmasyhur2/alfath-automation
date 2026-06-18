// src/logic/absen.js
const STATUS_BY_CODE = { H: 'hadir', S: 'sakit', I: 'izin', A: 'alpha' };
const VALID = new Set(Object.values(STATUS_BY_CODE));

function initStatus(roster) {
  const m = {};
  for (const r of roster) m[r.idx] = 'hadir';
  return m;
}

function applyStatus(statusMap, idx, code) {
  const status = STATUS_BY_CODE[code] || code;
  if (!VALID.has(status)) throw new Error(`Status tidak valid: ${code}`);
  return { ...statusMap, [idx]: status };
}

function setKeterangan(ketMap, idx, text) {
  return { ...ketMap, [idx]: (text || '').trim() };
}

function summarize(statusMap, roster, ketMap = {}) {
  const sum = { hadir: 0, sakit: 0, izin: 0, alpha: 0, terlambat: 0 };
  for (const r of roster) {
    const st = statusMap[r.idx] || 'hadir';
    sum[st]++;
    const ket = ketMap[r.idx] || '';
    if (st === 'hadir' && /^terlambat/i.test(ket)) sum.terlambat++;
  }
  return sum;
}

function toAbsensiBatch({ kelas_id, tanggal, roster, statusMap, ketMap = {} }) {
  const items = roster.map((r) => {
    const item = { santri_id: r.santri_id, status: statusMap[r.idx] || 'hadir' };
    const ket = (ketMap[r.idx] || '').trim();
    if (ket) item.keterangan = ket;
    return item;
  });
  return { kelas_id, tanggal, items };
}

module.exports = { STATUS_BY_CODE, initStatus, applyStatus, setKeterangan, summarize, toAbsensiBatch };
