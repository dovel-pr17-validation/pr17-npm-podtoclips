const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertClerkConfiguration,
  isClerkConfigured,
  requireAuthenticatedRequest,
} = require('./clerkAuth.cjs');

const authKeys = ['CLERK_AUTH_REQUIRED', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'];

function withAuthEnvironment(values, callback) {
  const previous = Object.fromEntries(authKeys.map((key) => [key, process.env[key]]));
  authKeys.forEach((key) => delete process.env[key]);
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    authKeys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test('local development remains usable when authentication is not configured', () => {
  withAuthEnvironment({}, () => {
    assert.equal(isClerkConfigured(), false);
    assert.doesNotThrow(assertClerkConfiguration);
    let continued = false;
    requireAuthenticatedRequest({}, {}, () => { continued = true; });
    assert.equal(continued, true);
  });
});

test('production auth fails closed when required keys are missing', () => {
  withAuthEnvironment({ CLERK_AUTH_REQUIRED: '1' }, () => {
    assert.throws(assertClerkConfiguration, /requires CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY/);
  });
});

test('production auth accepts a complete key pair', () => {
  withAuthEnvironment({
    CLERK_AUTH_REQUIRED: '1',
    CLERK_PUBLISHABLE_KEY: 'pk_test_example',
    CLERK_SECRET_KEY: 'sk_test_example',
  }, () => {
    assert.equal(isClerkConfigured(), true);
    assert.doesNotThrow(assertClerkConfiguration);
  });
});
