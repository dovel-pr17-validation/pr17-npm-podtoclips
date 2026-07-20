const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyPlanChangeState,
  planChangePaymentSummary,
  planChangeRequest,
  safeChargeSummary,
} = require('./dodoBilling.cjs');

test('upgrades are immediate, prorated, and fail closed when payment fails', () => {
  const previous = process.env.DODO_GROWTH_PRODUCT_ID;
  process.env.DODO_GROWTH_PRODUCT_ID = 'growth-product';
  try {
    const change = planChangeRequest('creator', 'growth', 'user-1');
    assert.equal(change.direction, 'upgrade');
    assert.equal(change.parameters.product_id, 'growth-product');
    assert.equal(change.parameters.quantity, 1);
    assert.equal(change.parameters.proration_billing_mode, 'prorated_immediately');
    assert.equal(change.parameters.effective_at, 'immediately');
    assert.equal(change.parameters.on_payment_failure, 'prevent_change');
  } finally {
    if (previous === undefined) delete process.env.DODO_GROWTH_PRODUCT_ID;
    else process.env.DODO_GROWTH_PRODUCT_ID = previous;
  }
});

test('downgrades are scheduled for renewal without an immediate charge', () => {
  const previous = process.env.DODO_CREATOR_PRODUCT_ID;
  process.env.DODO_CREATOR_PRODUCT_ID = 'creator-product';
  try {
    const change = planChangeRequest('studio', 'creator', 'user-1');
    assert.equal(change.direction, 'downgrade');
    assert.equal(change.parameters.product_id, 'creator-product');
    assert.equal(change.parameters.proration_billing_mode, 'do_not_bill');
    assert.equal(change.parameters.effective_at, 'next_billing_date');
  } finally {
    if (previous === undefined) delete process.env.DODO_CREATOR_PRODUCT_ID;
    else process.env.DODO_CREATOR_PRODUCT_ID = previous;
  }
});

test('changing to the currently active plan is rejected', () => {
  assert.throws(() => planChangeRequest('growth', 'growth', 'user-1'), (error) => error.code === 'PLAN_ALREADY_ACTIVE');
});

test('preview charge data exposes only display-safe amounts', () => {
  assert.deepEqual(safeChargeSummary({
    immediate_charge: { summary: { currency: 'USD', total_amount: 412, tax: 12, customer_credits: 0 } },
  }), { currency: 'USD', totalAmount: 412, tax: 12 });
});

test('pending plan-change payments are represented without exposing payment internals', () => {
  const payment = planChangePaymentSummary({
    status: 'processing',
    total_amount: 106390,
    currency: 'INR',
    payment_link: null,
    metadata: { easyedits_plan: 'growth', private_value: 'hidden' },
  });
  assert.deepEqual(payment, {
    paymentId: null,
    targetPlan: 'growth',
    status: 'processing',
    totalAmount: 106390,
    currency: 'INR',
    paymentLink: null,
    createdAt: null,
    errorCode: null,
    errorMessage: null,
  });
  assert.equal(classifyPlanChangeState({ currentPlan: 'creator', targetPlan: 'growth', payment }), 'processing');
});

test('a payment link is surfaced only when customer action is required', () => {
  assert.equal(classifyPlanChangeState({
    currentPlan: 'creator',
    targetPlan: 'growth',
    payment: { status: 'requires_customer_action', paymentLink: 'https://checkout.example' },
  }), 'action_required');
  assert.equal(classifyPlanChangeState({
    currentPlan: 'creator',
    targetPlan: 'growth',
    payment: { status: 'requires_customer_action', paymentLink: null },
  }), 'processing');
});

test('the plan change is complete only after Dodo reports the target product', () => {
  assert.equal(classifyPlanChangeState({ currentPlan: 'growth', targetPlan: 'growth', payment: null }), 'completed');
  assert.equal(classifyPlanChangeState({ currentPlan: 'creator', targetPlan: 'growth', payment: { status: 'succeeded' } }), 'processing');
  assert.equal(classifyPlanChangeState({ currentPlan: 'creator', targetPlan: 'growth', payment: { status: 'failed' } }), 'failed');
});
