const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FREE_MAX_SOURCE_BYTES,
  FREE_MAX_SOURCE_DURATION_SECONDS,
  PAID_MAX_SOURCE_DURATION_SECONDS,
  assertDurationAllowed,
  assertUploadSizeAllowed,
  durationLimitFor,
  isSourceLimitError,
  sourceDurationSeconds,
} = require('./freeTierLimits.cjs');

test('Free source duration is capped at exactly two hours', () => {
  const free = { plan: 'free' };
  assert.equal(FREE_MAX_SOURCE_DURATION_SECONDS, 7200);
  assert.doesNotThrow(() => assertDurationAllowed(free, FREE_MAX_SOURCE_DURATION_SECONDS));
  assert.throws(() => assertDurationAllowed(free, FREE_MAX_SOURCE_DURATION_SECONDS + 0.01), /2 hours long/);
  assert.throws(() => assertDurationAllowed(free, null), /could not be verified/);
});

test('every paid plan is capped at exactly four hours twenty minutes', () => {
  assert.equal(PAID_MAX_SOURCE_DURATION_SECONDS, 15600);
  for (const plan of ['creator', 'growth', 'studio', 'enterprise']) {
    assert.doesNotThrow(() => assertDurationAllowed({ plan }, PAID_MAX_SOURCE_DURATION_SECONDS));
    assert.throws(() => assertDurationAllowed({ plan }, PAID_MAX_SOURCE_DURATION_SECONDS + 0.01), /4 hours 20 minutes/);
    assert.doesNotThrow(() => assertUploadSizeAllowed({ plan }, FREE_MAX_SOURCE_BYTES + 1));
  }
});

test('duration limit metadata matches the account tier', () => {
  assert.deepEqual(durationLimitFor({ plan: 'free' }), {
    code: 'FREE_SOURCE_LIMIT_EXCEEDED',
    label: 'Free',
    message: 'Free workspaces can process podcasts up to 2 hours long.',
    seconds: 7200,
  });
  assert.equal(durationLimitFor({ plan: 'growth' }).seconds, 15600);
});

test('Free upload size has an early five GiB safety boundary', () => {
  const free = { plan: 'free' };
  assert.doesNotThrow(() => assertUploadSizeAllowed(free, FREE_MAX_SOURCE_BYTES));
  assert.throws(() => assertUploadSizeAllowed(free, FREE_MAX_SOURCE_BYTES + 1), /5 GiB/);
});

test('source duration reads file and URL metadata consistently', () => {
  assert.equal(sourceDurationSeconds({ durationSeconds: 120 }), 120);
  assert.equal(sourceDurationSeconds({ import: { durationSeconds: 240 } }), 240);
  assert.equal(sourceDurationSeconds({}), null);
});

test('source limit errors can terminate workflow retries for every tier', () => {
  let error;
  try {
    assertDurationAllowed({ plan: 'free' }, FREE_MAX_SOURCE_DURATION_SECONDS + 1);
  } catch (reason) {
    error = reason;
  }
  assert.equal(isSourceLimitError(error), true);
  assert.throws(
    () => assertDurationAllowed({ plan: 'studio' }, PAID_MAX_SOURCE_DURATION_SECONDS + 1),
    (reason) => isSourceLimitError(reason),
  );
  assert.equal(isSourceLimitError(new Error('temporary download failure')), false);
});
