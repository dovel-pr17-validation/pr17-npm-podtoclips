const test = require('node:test');
const assert = require('node:assert/strict');

const { internalStateForPaymentStatus, isTerminalPlanChangeState } = require('./planChangeStore.cjs');

test('payment webhooks map to durable plan-change states', () => {
  assert.equal(internalStateForPaymentStatus('processing'), 'processing');
  assert.equal(internalStateForPaymentStatus('requires_customer_action'), 'action_required');
  assert.equal(internalStateForPaymentStatus('succeeded'), 'payment_succeeded');
  assert.equal(internalStateForPaymentStatus('failed'), 'failed');
  assert.equal(internalStateForPaymentStatus('cancelled'), 'cancelled');
});

test('unknown non-terminal provider states remain processing', () => {
  assert.equal(internalStateForPaymentStatus('requires_merchant_action'), 'processing');
  assert.equal(internalStateForPaymentStatus(null, 'created'), 'created');
});

test('late provider events cannot reopen terminal plan changes', () => {
  assert.equal(isTerminalPlanChangeState('cancelled'), true);
  assert.equal(isTerminalPlanChangeState('failed'), true);
  assert.equal(isTerminalPlanChangeState('completed'), true);
  assert.equal(isTerminalPlanChangeState('processing'), false);
});
