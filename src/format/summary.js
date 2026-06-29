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

module.exports = { formatAbsenSummary, formatNilaiSummary, formatTugasHistory };
