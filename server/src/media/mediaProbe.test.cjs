const assert = require('node:assert/strict');
const test = require('node:test');
const { parseDurationSeconds } = require('./mediaProbe.cjs');

test('media probe accepts a positive FFprobe duration', () => {
  assert.equal(parseDurationSeconds('9000.250000\n'), 9000.25);
});

test('media probe rejects missing or invalid duration output', () => {
  assert.throws(() => parseDurationSeconds('N/A'), /could not be read/);
  assert.throws(() => parseDurationSeconds('0'), /could not be read/);
});
