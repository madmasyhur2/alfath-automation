const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTenggat } = require('../src/parsers/tanggal');

test('/lewati yields null date (skip)', () => {
  assert.deepEqual(parseTenggat('/lewati'), { date: null });
  assert.deepEqual(parseTenggat('  /LEWATI '), { date: null });
});

test('valid YYYY-MM-DD passes through', () => {
  assert.deepEqual(parseTenggat('2026-07-05'), { date: '2026-07-05' });
});

test('malformed or out-of-range is an error', () => {
  assert.match(parseTenggat('5 Juli').error, /YYYY-MM-DD/);
  assert.match(parseTenggat('2026-13-40').error, /tidak valid|YYYY-MM-DD/);
  assert.ok(parseTenggat('').error);
});

test('impossible calendar dates are rejected', () => {
  assert.ok(parseTenggat('2026-02-31').error);
  assert.ok(parseTenggat('2026-04-31').error);
});
