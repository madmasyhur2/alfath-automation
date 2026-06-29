function nextKe(history) {
  const max = (history || []).reduce((m, t) => Math.max(m, Number(t.ke) || 0), 0);
  return max + 1;
}

function previewAverage(existingValues, newValue) {
  const all = [...(existingValues || []), Number(newValue)];
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  return Math.round(avg * 100) / 100;
}

module.exports = { nextKe, previewAverage };
