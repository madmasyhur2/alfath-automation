function formatRoster(roster) {
  return roster.map((r) => `${r.idx}. ${r.name}`).join('\n');
}

module.exports = { formatRoster };
