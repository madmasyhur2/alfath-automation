const EXCEPTION_STATUSES = ['T', 'S', 'I', 'A']; // Terlambat, Sakit, Izin, Alpa
const ALL_PRESENT_WORDS = ['nihil', 'semua hadir', 'hadir semua'];

function parseAttendanceMessage(text, roster) {
  const result = { allPresent: false, exceptions: [], errors: [] };
  const trimmed = (text || '').trim();

  if (trimmed === '') {
    result.errors.push('Pesan kosong. Ketik "nihil" jika semua hadir.');
    return result;
  }
  if (ALL_PRESENT_WORDS.includes(trimmed.toLowerCase())) {
    result.allPresent = true;
    return result;
  }

  const seen = new Set();
  const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l !== '');

  for (const line of lines) {
    const tokens = line.split(/\s+/);
    const num = Number(tokens[0]);
    const entry = roster.find((r) => r.idx === num);

    if (!Number.isInteger(num) || !entry) {
      result.errors.push(`Nomor tidak dikenal: "${line}"`);
      continue;
    }
    if (seen.has(num)) {
      result.errors.push(`Nomor ${num} ditulis dua kali.`);
      continue;
    }
    const status = (tokens[1] || '').toUpperCase();
    if (!EXCEPTION_STATUSES.includes(status)) {
      result.errors.push(`Status tidak valid pada "${line}" (pakai T/S/I/A).`);
      continue;
    }
    seen.add(num);
    result.exceptions.push({
      student_id: entry.student_id,
      name: entry.name,
      status,
      reason: tokens.slice(2).join(' '),
    });
  }
  return result;
}

module.exports = { parseAttendanceMessage, EXCEPTION_STATUSES, ALL_PRESENT_WORDS };
