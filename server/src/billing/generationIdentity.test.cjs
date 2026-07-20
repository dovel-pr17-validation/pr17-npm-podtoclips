const assert = require('node:assert/strict');
const test = require('node:test');
const { requireEpisodeBillingAccountId } = require('./generationIdentity.cjs');

test('returns the authenticated account stored on the episode', () => {
  const episode = { source: { billing: { accountId: 'user_production' } } };
  assert.equal(requireEpisodeBillingAccountId(episode), 'user_production');
});

test('fails closed instead of charging a shared fallback account', () => {
  assert.throws(
    () => requireEpisodeBillingAccountId({ source: {} }),
    (error) => error.code === 'BILLING_IDENTITY_MISSING' && error.statusCode === 409,
  );
});
