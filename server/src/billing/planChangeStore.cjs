const { randomUUID } = require('node:crypto');
const { getSql, hasDatabaseUrl } = require('../storage/neonDb.cjs');

const OPEN_PLAN_CHANGE_STATES = Object.freeze(['created', 'processing', 'action_required', 'payment_succeeded']);
const TERMINAL_PLAN_CHANGE_STATES = Object.freeze(['completed', 'failed', 'cancelled']);

const isTerminalPlanChangeState = (state) => TERMINAL_PLAN_CHANGE_STATES.includes(state);

function requirePlanChangeDatabase() {
  if (hasDatabaseUrl()) return;
  const error = new Error('Durable billing changes require the billing database.');
  error.statusCode = 503;
  error.code = 'BILLING_DATABASE_REQUIRED';
  throw error;
}

function mapPlanChange(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    subscriptionId: row.dodo_subscription_id,
    fromPlan: row.from_plan,
    targetPlan: row.target_plan,
    direction: row.direction,
    state: row.state,
    providerIdempotencyKey: row.provider_idempotency_key,
    paymentId: row.dodo_payment_id || null,
    paymentStatus: row.payment_status || null,
    paymentAmount: row.payment_amount === null ? null : Number(row.payment_amount),
    paymentCurrency: row.payment_currency || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
  };
}

async function getOpenPlanChange(subscriptionId) {
  requirePlanChangeDatabase();
  const sql = getSql();
  const [row] = await sql`
    select * from billing_plan_changes
    where dodo_subscription_id = ${subscriptionId}
      and state in ('created', 'processing', 'action_required', 'payment_succeeded')
    order by created_at desc
    limit 1
  `;
  return mapPlanChange(row);
}

async function reservePlanChange({ userId, subscriptionId, fromPlan, targetPlan, direction }) {
  requirePlanChangeDatabase();
  const sql = getSql();
  const id = randomUUID();
  const providerIdempotencyKey = `easyedits-plan-change-${id}`;
  const [inserted] = await sql`
    insert into billing_plan_changes (
      id, user_id, dodo_subscription_id, from_plan, target_plan,
      direction, state, provider_idempotency_key
    ) values (
      ${id}, ${userId}, ${subscriptionId}, ${fromPlan}, ${targetPlan},
      ${direction}, 'created', ${providerIdempotencyKey}
    )
    on conflict do nothing
    returning *
  `;
  if (inserted) return { created: true, planChange: mapPlanChange(inserted) };
  return { created: false, planChange: await getOpenPlanChange(subscriptionId) };
}

function internalStateForPaymentStatus(paymentStatus, currentState = 'processing') {
  if (paymentStatus === 'succeeded') return 'payment_succeeded';
  if (paymentStatus === 'failed') return 'failed';
  if (paymentStatus === 'cancelled') return 'cancelled';
  if (['requires_customer_action', 'requires_payment_method', 'requires_confirmation'].includes(paymentStatus)) {
    return 'action_required';
  }
  if (paymentStatus) return 'processing';
  return currentState;
}

async function recordPlanChangePayment(planChangeId, payment, forcedState) {
  if (!planChangeId || !payment || !hasDatabaseUrl()) return null;
  const sql = getSql();
  const paymentStatus = String(payment.status || '').trim().toLowerCase() || null;
  const state = forcedState || internalStateForPaymentStatus(paymentStatus);
  const [row] = await sql`
    update billing_plan_changes
    set state = ${state},
        dodo_payment_id = coalesce(${payment.paymentId || null}, dodo_payment_id),
        payment_status = coalesce(${paymentStatus}, payment_status),
        payment_amount = coalesce(${payment.totalAmount ?? null}, payment_amount),
        payment_currency = coalesce(${payment.currency || null}, payment_currency),
        error_code = ${payment.errorCode || null},
        error_message = ${payment.errorMessage || null},
        completed_at = case when ${state} in ('completed', 'failed', 'cancelled') then now() else completed_at end,
        updated_at = now()
    where id = ${planChangeId}
    returning *
  `;
  return mapPlanChange(row);
}

async function recoverProviderPlanChange({ userId, subscriptionId, fromPlan, targetPlan, direction, payment }) {
  requirePlanChangeDatabase();
  const existing = await getOpenPlanChange(subscriptionId);
  if (existing) return recordPlanChangePayment(existing.id, payment);

  const sql = getSql();
  const id = randomUUID();
  const paymentStatus = String(payment?.status || '').trim().toLowerCase() || 'processing';
  const state = internalStateForPaymentStatus(paymentStatus);
  const providerIdempotencyKey = `easyedits-recovered-${id}`;
  const [inserted] = await sql`
    insert into billing_plan_changes (
      id, user_id, dodo_subscription_id, from_plan, target_plan,
      direction, state, provider_idempotency_key, dodo_payment_id,
      payment_status, payment_amount, payment_currency
    ) values (
      ${id}, ${userId}, ${subscriptionId}, ${fromPlan}, ${targetPlan},
      ${direction}, ${state}, ${providerIdempotencyKey}, ${payment?.paymentId || null},
      ${paymentStatus}, ${payment?.totalAmount ?? null}, ${payment?.currency || null}
    )
    on conflict do nothing
    returning *
  `;
  if (inserted) return mapPlanChange(inserted);
  return getOpenPlanChange(subscriptionId);
}

async function failPlanChange(planChangeId, error) {
  if (!planChangeId || !hasDatabaseUrl()) return null;
  return recordPlanChangePayment(planChangeId, {
    status: 'failed',
    errorCode: String(error?.code || error?.status || 'PLAN_CHANGE_FAILED').slice(0, 120),
    errorMessage: String(error?.message || 'Plan change failed.').slice(0, 500),
  }, 'failed');
}

async function completePlanChange(subscriptionId, targetPlan) {
  if (!subscriptionId || !targetPlan || !hasDatabaseUrl()) return null;
  const sql = getSql();
  const [row] = await sql`
    update billing_plan_changes
    set state = 'completed',
        payment_status = case when payment_status is null then 'succeeded' else payment_status end,
        completed_at = now(),
        updated_at = now()
    where dodo_subscription_id = ${subscriptionId}
      and target_plan = ${targetPlan}
      and state in ('created', 'processing', 'action_required', 'payment_succeeded')
    returning *
  `;
  return mapPlanChange(row);
}

async function closeOpenPlanChanges(subscriptionId, state, message = null) {
  if (!subscriptionId || !['failed', 'cancelled'].includes(state) || !hasDatabaseUrl()) return [];
  const sql = getSql();
  const rows = await sql`
    update billing_plan_changes
    set state = ${state},
        payment_status = ${state},
        error_message = coalesce(${message}, error_message),
        completed_at = now(),
        updated_at = now()
    where dodo_subscription_id = ${subscriptionId}
      and state in ('created', 'processing', 'action_required', 'payment_succeeded')
    returning *
  `;
  return rows.map(mapPlanChange);
}

async function recordPaymentWebhook({ eventType, payload }) {
  if (!hasDatabaseUrl()) return null;
  const subscriptionId = String(payload?.subscription_id || '').trim();
  const paymentId = String(payload?.payment_id || '').trim();
  const metadataId = String(payload?.metadata?.easyedits_plan_change_id || '').trim();
  const targetPlan = String(payload?.metadata?.easyedits_plan || '').trim();
  const sql = getSql();
  let row;
  if (metadataId) {
    [row] = await sql`select * from billing_plan_changes where id = ${metadataId} limit 1`;
  }
  if (!row && paymentId) {
    [row] = await sql`select * from billing_plan_changes where dodo_payment_id = ${paymentId} limit 1`;
  }
  if (!row && subscriptionId) {
    [row] = await sql`
      select * from billing_plan_changes
      where dodo_subscription_id = ${subscriptionId}
        and (${targetPlan} = '' or target_plan = ${targetPlan})
        and state in ('created', 'processing', 'action_required', 'payment_succeeded')
      order by created_at desc limit 1
    `;
  }
  if (!row) return null;
  if (isTerminalPlanChangeState(row.state)) return mapPlanChange(row);
  const paymentStatus = String(payload?.status || eventType.split('.').pop() || '').trim().toLowerCase();
  return recordPlanChangePayment(row.id, {
    paymentId: paymentId || null,
    status: paymentStatus,
    totalAmount: payload?.total_amount ?? null,
    currency: payload?.currency || null,
    errorCode: payload?.error_code || payload?.failure_code || null,
    errorMessage: payload?.error_message || payload?.failure_message || null,
  });
}

module.exports = {
  OPEN_PLAN_CHANGE_STATES,
  closeOpenPlanChanges,
  completePlanChange,
  failPlanChange,
  getOpenPlanChange,
  internalStateForPaymentStatus,
  isTerminalPlanChangeState,
  mapPlanChange,
  recordPaymentWebhook,
  recordPlanChangePayment,
  recoverProviderPlanChange,
  reservePlanChange,
};
