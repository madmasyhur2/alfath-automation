function parseScores(text, roster) {
  const result = { entries: [], errors: [] };
  const trimmed = (text || '').trim();
  if (trimmed === '') {
    result.errors.push('Pesan kosong. Kirim pasangan: [no] [nilai].');
    return result;
  }
  const seen = new Set();
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
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
    const nilai = Number(tokens[1]);
    if (!Number.isFinite(nilai) || nilai < 0 || nilai > 100) {
      result.errors.push(`Nilai harus 0–100 pada "${line}".`);
      continue;
    }
    seen.add(num);
    result.entries.push({ idx: num, santri_id: entry.santri_id, nilai });
  }
  return result;
}
module.exports = { parseScores };
