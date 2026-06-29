function formatAbsenSummary(s) {
  let txt = `✅ Tersimpan. ${s.hadir} Hadir, ${s.sakit} Sakit, ${s.izin} Izin, ${s.alpha} Alpha.`;
  if (s.terlambat) txt += ` (${s.terlambat} terlambat)`;
  return txt;
}

function formatNilaiSummary(komponen, count, mapel, kelas) {
  return `✅ ${komponen} tersimpan untuk ${count} santri (${mapel} ${kelas}).`;
}

function formatTugasHistory(nama, list, rata) {
  const parts = list.map((t) => `T${t.ke} ${t.nilai}`).join(' · ');
  return `${nama}: ${parts} → rata² ${rata}`;
}

function formatCatatanList(nama, list) {
  if (!list || list.length === 0) return `Belum ada catatan untuk ${nama}.`;
  const lines = list.map((c) => `• ${c.tanggal}: ${c.teks}`).join('\n');
  return `Catatan terakhir untuk ${nama}:\n${lines}`;
}

function formatCatatanSaved(nama) {
  return `✅ Catatan untuk ${nama} tersimpan.`;
}

function formatTugasSaved(mapel, kelas, tenggat) {
  let txt = `✅ Tugas ${mapel} ${kelas} tersimpan.`;
  if (tenggat) txt += ` (tenggat ${tenggat})`;
  return txt;
}

module.exports = {
  formatAbsenSummary, formatNilaiSummary, formatTugasHistory,
  formatCatatanList, formatCatatanSaved, formatTugasSaved,
};
