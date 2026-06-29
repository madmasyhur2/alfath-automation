// src/parsers/callback.js
function parseCallbackData(data) {
  if (!data || typeof data !== 'string') return null;
  const parts = data.split(':');
  if (parts.length < 2) return null;
  return { cmd: parts[0], action: parts[1], args: parts.slice(2) };
}
module.exports = { parseCallbackData };
