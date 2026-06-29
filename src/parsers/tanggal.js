// src/parsers/tanggal.js
function parseTenggat(text) {
  const t = (text || '').trim();
  if (t === '') return { error: 'Tenggat kosong. Kirim YYYY-MM-DD atau /lewati.' };
  if (t.toLowerCase() === '/lewati') return { date: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return { error: 'Format tanggal harus YYYY-MM-DD, atau /lewati.' };
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { error: 'Tanggal tidak valid.' };
  return { date: t };
}
module.exports = { parseTenggat };
