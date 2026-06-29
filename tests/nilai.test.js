const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextKe, previewAverage } = require('../src/logic/nilai');

test('nextKe is max(ke)+1, or 1 when empty', () => {
  assert.equal(nextKe([{ ke: 1 }, { ke: 2 }]), 3);
  assert.equal(nextKe([]), 1);
});

test('previewAverage rounds to 2 decimals', () => {
  assert.equal(previewAverage([80, 90], 70), 80); // (80+90+70)/3 = 80
  assert.equal(previewAverage([], 81.666), 81.67);
});
