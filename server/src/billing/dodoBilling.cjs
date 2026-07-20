const {
  getAccountBillingIdentity,
  getAccountEntitlement,
  releaseDodoWebhook,
  reserveDodoWebhook,
  syncDodoSubscription,
} = require('./entitlements.cjs');
const { getPlanDefinition, planForProductId, productIdForPlan } = require('./plans.cjs');
const {
  closeOpenPlanChanges,
  completePlanChange,
  failPlanChange,
  getOpenPlanChange,
  recordPaymentWebhook,
  recordPlanChangePayment,
  recoverProviderPlanChange,
  reservePlanChange,
} = require('./planChangeStore.cjs');

const SELF_SERVE_PLAN_ORDER = Object.freeze(['creator', 'growth', 'studio']);

const SUBSCRIPTION_EVENTS = new Set([
  'subscription.active',
  'subscription.updated',
  'subscription.on_hold',
  'subscription.renewed',
  'subscription.plan_changed',
  'subscription.cancelled',
  'subscription.failed',
  'subscription.expired',
]);

const PAYMENT_EVENTS = new Set([
  'payment.processing',
  'payment.succeeded',
  'payment.failed',
  'payment.cancelled',
]);

const BILLING_EVENTS = new Set([...SUBSCRIPTION_EVENTS, ...PAYMENT_EVENTS]);

let clientPromise;

function appOrigin() {
  const configured = String(
    process.env.PUBLIC_APP_URL
    || process.env.FRONTEND_URL
    || process.env.APP_URL
    || 'http://localhost:3000',
  ).trim();
  return configured.replace(/\/$/, '');
}

function dodoEnvironment() {
  return process.env.DODO_PAYMENTS_ENVIRONMENT === 'live_mode' ? 'live_mode' : 'test_mode';
}

function billingConfiguration() {
  return {
    environment: dodoEnvironment(),
    hasApiKey: Boolean(String(process.env.DODO_PAYMENTS_API_KEY || '').trim()),
    hasWebhookKey: Boolean(String(process.env.DODO_PAYMENTS_WEBHOOK_KEY || '').trim()),
  };
}

async function getDodoClient() {
  const bearerToken = String(process.env.DODO_PAYMENTS_API_KEY || '').trim();
  if (!bearerToken) {
    const error = new Error('Payments are not configured yet.');
    error.statusCode = 503;
    error.code = 'BILLING_NOT_CONFIGURED';
    throw error;
  }
  if (!clientPromise) {
    clientPromise = import('dodopayments').then(({ default: DodoPayments }) => new DodoPayments({
      bearerToken,
      webhookKey: String(process.env.DODO_PAYMENTS_WEBHOOK_KEY || '').trim() || null,
      environment: dodoEnvironment(),
    }));
  }
  return clientPromise;
}

function checkoutCustomer({ customerId, email, name }) {
  if (customerId) return { customer_id: customerId };
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    const error = new Error('An authenticated customer email is required for checkout.');
    error.statusCode = 400;
    error.code = 'CHECKOUT_EMAIL_REQUIRED';
    throw error;
  }
  return {
    email: normalizedEmail,
    name: String(name || '').trim() || normalizedEmail.split('@')[0],
  };
}

async function createCheckoutSession({ userId, planId, email, name }) {
  const plan = getPlanDefinition(planId);
  if (!plan || plan.id === 'free' || plan.id === 'enterprise') {
    const error = new Error('Choose Creator, Growth, or Studio for checkout.');
    error.statusCode = 400;
    error.code = 'INVALID_CHECKOUT_PLAN';
    throw error;
  }
  const productId = productIdForPlan(plan.id);
  if (!productId) {
    const error = new Error(`${plan.label} checkout is not configured yet.`);
    error.statusCode = 503;
    error.code = 'PLAN_NOT_CONFIGURED';
    throw error;
  }

  const entitlement = await getAccountEntitlement(userId);
  if (entitlement.isPaid) {
    const error = new Error('Manage your active subscription from the billing portal.');
    error.statusCode = 409;
    error.code = 'SUBSCRIPTION_ALREADY_ACTIVE';
    throw error;
  }

  const identity = await getAccountBillingIdentity(userId);
  const client = await getDodoClient();
  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: checkoutCustomer({ customerId: identity.dodoCustomerId, email, name }),
    metadata: {
      easyedits_user_id: userId,
      easyedits_plan: plan.id,
    },
    return_url: `${appOrigin()}/app/settings?billing=success`,
    cancel_url: `${appOrigin()}/pricing?billing=cancelled`,
    customization: { theme: 'system' },
  });

  if (!session.checkout_url) {
    const error = new Error('Dodo Payments did not return a checkout URL.');
    error.statusCode = 502;
    error.code = 'CHECKOUT_URL_MISSING';
    throw error;
  }
  return { checkoutUrl: session.checkout_url, sessionId: session.session_id };
}

async function createCustomerPortalSession(userId) {
  const identity = await getAccountBillingIdentity(userId);
  if (!identity.dodoCustomerId) {
    const error = new Error('No billing account exists for this user yet.');
    error.statusCode = 404;
    error.code = 'BILLING_CUSTOMER_NOT_FOUND';
    throw error;
  }
  const client = await getDodoClient();
  const session = await client.customers.customerPortal.create(identity.dodoCustomerId, {
    return_url: `${appOrigin()}/app/settings`,
    send_email: false,
  });
  return { portalUrl: session.link };
}

function planChangeRequest(currentPlan, targetPlan, userId) {
  const currentIndex = SELF_SERVE_PLAN_ORDER.indexOf(currentPlan);
  const targetIndex = SELF_SERVE_PLAN_ORDER.indexOf(targetPlan);
  if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) {
    const error = new Error(currentIndex === targetIndex ? 'This is already your current plan.' : 'This plan change is not available.');
    error.statusCode = 400;
    error.code = currentIndex === targetIndex ? 'PLAN_ALREADY_ACTIVE' : 'INVALID_PLAN_CHANGE';
    throw error;
  }
  const upgrading = targetIndex > currentIndex;
  return {
    direction: upgrading ? 'upgrade' : 'downgrade',
    parameters: {
      product_id: productIdForPlan(targetPlan),
      quantity: 1,
      proration_billing_mode: upgrading ? 'prorated_immediately' : 'do_not_bill',
      effective_at: upgrading ? 'immediately' : 'next_billing_date',
      on_payment_failure: 'prevent_change',
      metadata: { easyedits_user_id: userId, easyedits_plan: targetPlan },
    },
  };
}

async function activeSubscriptionForPlanChange(userId, targetPlanId, { allowSamePlan = false } = {}) {
  const target = getPlanDefinition(targetPlanId);
  if (!target || !SELF_SERVE_PLAN_ORDER.includes(target.id) || !productIdForPlan(target.id)) {
    const error = new Error('The requested subscription plan is not available.');
    error.statusCode = 400;
    error.code = 'INVALID_PLAN_CHANGE';
    throw error;
  }
  const identity = await getAccountBillingIdentity(userId);
  if (!identity.dodoSubscriptionId) {
    const error = new Error('No active subscription is available to change.');
    error.statusCode = 409;
    error.code = 'SUBSCRIPTION_NOT_FOUND';
    throw error;
  }
  const client = await getDodoClient();
  const subscription = await client.subscriptions.retrieve(identity.dodoSubscriptionId);
  const currentPlan = planForProductId(subscription.product_id);
  if (subscription.status !== 'active' || !currentPlan) {
    const error = new Error('Only an active Creator, Growth, or Studio subscription can change plans.');
    error.statusCode = 409;
    error.code = 'SUBSCRIPTION_NOT_ACTIVE';
    throw error;
  }
  const context = {
    client,
    currentPlan,
    identity,
    subscription,
    target,
  };
  if (allowSamePlan && currentPlan === target.id) return context;
  return { ...context, ...planChangeRequest(currentPlan, target.id, userId) };
}

function safeChargeSummary(preview) {
  const summary = preview?.immediate_charge?.summary;
  if (!summary) return null;
  return {
    currency: summary.currency,
    totalAmount: Number(summary.total_amount || 0),
    tax: Number(summary.tax || 0),
  };
}

const PENDING_PAYMENT_STATUSES = new Set([
  'processing',
  'requires_customer_action',
  'requires_merchant_action',
  'requires_payment_method',
  'requires_confirmation',
  'requires_capture',
  'partially_captured',
  'partially_captured_and_capturable',
]);

const CUSTOMER_ACTION_PAYMENT_STATUSES = new Set([
  'requires_customer_action',
  'requires_payment_method',
  'requires_confirmation',
]);

function planChangePaymentSummary(payment) {
  if (!payment) return null;
  const targetPlan = String(payment.metadata?.easyedits_plan || '').trim();
  if (!SELF_SERVE_PLAN_ORDER.includes(targetPlan)) return null;
  return {
    paymentId: payment.payment_id || null,
    targetPlan,
    status: String(payment.status || '').trim().toLowerCase() || 'processing',
    totalAmount: Number(payment.total_amount || 0),
    currency: payment.currency || null,
    paymentLink: String(payment.payment_link || '').trim() || null,
    createdAt: payment.created_at || null,
    errorCode: payment.error_code || payment.failure_code || null,
    errorMessage: payment.error_message || payment.failure_message || null,
  };
}

function classifyPlanChangeState({ currentPlan, targetPlan, payment }) {
  if (currentPlan === targetPlan) return 'completed';
  if (!payment) return 'ready';
  if (payment.status === 'succeeded') return 'processing';
  if (['failed', 'cancelled'].includes(payment.status)) return 'failed';
  if (CUSTOMER_ACTION_PAYMENT_STATUSES.has(payment.status) && payment.paymentLink) return 'action_required';
  if (PENDING_PAYMENT_STATUSES.has(payment.status)) return 'processing';
  return 'processing';
}

async function latestPlanChangePayment(client, subscriptionId, targetPlan) {
  const page = await client.payments.list({ subscription_id: subscriptionId, page_size: 10 });
  const items = typeof page.getPaginatedItems === 'function' ? page.getPaginatedItems() : (page.items || []);
  const candidates = [...items]
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
    .slice(0, 5);
  for (const candidate of candidates) {
    const detail = await client.payments.retrieve(candidate.payment_id);
    const summary = planChangePaymentSummary(detail);
    if (summary && (!targetPlan || summary.targetPlan === targetPlan)) return summary;
  }
  return null;
}

async function planChangeStatus(change, requestedTargetPlan = change.target.id) {
  const subscriptionId = change.identity.dodoSubscriptionId;
  let ledger = await getOpenPlanChange(subscriptionId);
  const effectiveTargetPlan = ledger?.targetPlan || requestedTargetPlan;
  const [subscription, payment] = await Promise.all([
    change.client.subscriptions.retrieve(subscriptionId),
    latestPlanChangePayment(change.client, subscriptionId, effectiveTargetPlan),
  ]);
  const currentPlan = planForProductId(subscription.product_id) || change.currentPlan;
  const pendingPayment = payment && PENDING_PAYMENT_STATUSES.has(payment.status) ? payment : null;
  const resolvedTargetPlan = ledger?.targetPlan || pendingPayment?.targetPlan || requestedTargetPlan;
  if (!ledger && payment && PENDING_PAYMENT_STATUSES.has(payment.status) && currentPlan !== resolvedTargetPlan) {
    ledger = await recoverProviderPlanChange({
      userId: change.identity.userId,
      subscriptionId,
      fromPlan: currentPlan,
      targetPlan: resolvedTargetPlan,
      direction: planChangeRequest(currentPlan, resolvedTargetPlan, change.identity.userId).direction,
      payment,
    });
  } else if (ledger && payment) {
    ledger = await recordPlanChangePayment(ledger.id, payment);
  }
  if (currentPlan === resolvedTargetPlan) {
    ledger = await completePlanChange(subscriptionId, resolvedTargetPlan) || ledger;
  }
  let state = classifyPlanChangeState({ currentPlan, targetPlan: resolvedTargetPlan, payment });
  if (state === 'ready' && ledger) {
    state = ledger.state === 'action_required' ? 'action_required' : 'processing';
  }
  return {
    state,
    currentPlan,
    targetPlan: resolvedTargetPlan,
    targetPlanLabel: getPlanDefinition(resolvedTargetPlan)?.label || resolvedTargetPlan,
    paymentStatus: payment?.status || null,
    paymentLink: payment?.paymentLink || null,
    paymentAmount: payment?.totalAmount || null,
    paymentCurrency: payment?.currency || null,
    requestedTargetPlan,
    hasPendingChange: ['processing', 'action_required'].includes(state),
    updatedAt: ledger?.updatedAt || payment?.createdAt || null,
  };
}

async function previewSubscriptionPlanChange({ userId, planId }) {
  const change = await activeSubscriptionForPlanChange(userId, planId);
  const existingStatus = await planChangeStatus(change, change.target.id);
  if (['processing', 'action_required'].includes(existingStatus.state)) {
    return {
      currentPlan: change.currentPlan,
      targetPlan: change.target.id,
      targetPlanLabel: change.target.label,
      direction: change.direction,
      effectiveAt: change.parameters.effective_at,
      resumesSubscription: false,
      chargeCalculatedOnConfirmation: false,
      immediateCharge: null,
      nextBillingDate: change.subscription.next_billing_date || null,
      planChange: existingStatus,
    };
  }
  const resumesSubscription = Boolean(change.subscription.cancel_at_next_billing_date);
  const preview = resumesSubscription
    ? null
    : await change.client.subscriptions.previewChangePlan(
      change.identity.dodoSubscriptionId,
      change.parameters,
    );
  return {
    currentPlan: change.currentPlan,
    targetPlan: change.target.id,
    targetPlanLabel: change.target.label,
    direction: change.direction,
    effectiveAt: change.parameters.effective_at,
    resumesSubscription,
    chargeCalculatedOnConfirmation: resumesSubscription && change.direction === 'upgrade',
    immediateCharge: safeChargeSummary(preview),
    nextBillingDate: change.subscription.next_billing_date || null,
    planChange: { ...existingStatus, state: 'ready', targetPlan: change.target.id, targetPlanLabel: change.target.label },
  };
}

async function getSubscriptionPlanChangeStatus({ userId, planId }) {
  const change = await activeSubscriptionForPlanChange(userId, planId, { allowSamePlan: true });
  return planChangeStatus(change, change.target.id);
}

async function getCurrentSubscriptionPlanChange(userId) {
  const identity = await getAccountBillingIdentity(userId);
  if (!identity.dodoSubscriptionId) return null;
  const ledger = await getOpenPlanChange(identity.dodoSubscriptionId);
  if (!ledger) return null;
  const change = await activeSubscriptionForPlanChange(userId, ledger.targetPlan, { allowSamePlan: true });
  return planChangeStatus(change, ledger.targetPlan);
}

async function changeSubscriptionPlan({ userId, planId, requestId }) {
  const change = await activeSubscriptionForPlanChange(userId, planId);
  const subscriptionId = change.identity.dodoSubscriptionId;
  const wasScheduledToCancel = Boolean(change.subscription.cancel_at_next_billing_date);

  const existingStatus = await planChangeStatus(change, change.target.id);
  if (['processing', 'action_required'].includes(existingStatus.state)) {
    return {
      accepted: true,
      currentPlan: change.currentPlan,
      targetPlan: existingStatus.targetPlan,
      direction: change.direction,
      effectiveAt: change.parameters.effective_at,
      resumedSubscription: false,
      planChange: existingStatus,
    };
  }

  const reservation = await reservePlanChange({
    userId,
    subscriptionId,
    fromPlan: change.currentPlan,
    targetPlan: change.target.id,
    direction: change.direction,
  });
  if (!reservation.created) {
    return {
      accepted: true,
      currentPlan: change.currentPlan,
      targetPlan: reservation.planChange.targetPlan,
      direction: reservation.planChange.direction,
      effectiveAt: change.parameters.effective_at,
      resumedSubscription: false,
      planChange: await planChangeStatus(change, reservation.planChange.targetPlan),
    };
  }
  const providerParameters = {
    ...change.parameters,
    metadata: {
      ...change.parameters.metadata,
      easyedits_plan_change_id: reservation.planChange.id,
    },
  };

  if (wasScheduledToCancel) {
    await change.client.subscriptions.update(subscriptionId, { cancel_at_next_billing_date: false });
  }
  try {
    await change.client.subscriptions.changePlan(
      subscriptionId,
      providerParameters,
      { idempotencyKey: reservation.planChange.providerIdempotencyKey },
    );
  } catch (error) {
    if (Number(error?.status || error?.statusCode) === 409 && /pending plan change/i.test(String(error?.message || ''))) {
      return {
        accepted: true,
        currentPlan: change.currentPlan,
        targetPlan: change.target.id,
        direction: change.direction,
        effectiveAt: change.parameters.effective_at,
        resumedSubscription: wasScheduledToCancel,
        planChange: await planChangeStatus(change, change.target.id),
      };
    }
    if (wasScheduledToCancel) {
      await change.client.subscriptions.update(subscriptionId, { cancel_at_next_billing_date: true }).catch(() => undefined);
    }
    await failPlanChange(reservation.planChange.id, error);
    throw error;
  }
  const status = await planChangeStatus(change, change.target.id);
  if (status.state === 'ready') status.state = 'processing';
  return {
    accepted: true,
    currentPlan: change.currentPlan,
    targetPlan: change.target.id,
    direction: change.direction,
    effectiveAt: change.parameters.effective_at,
    resumedSubscription: wasScheduledToCancel,
    planChange: status,
  };
}

function webhookHeaders(req) {
  return {
    'webhook-id': String(req.get('webhook-id') || ''),
    'webhook-signature': String(req.get('webhook-signature') || ''),
    'webhook-timestamp': String(req.get('webhook-timestamp') || ''),
  };
}

async function handleDodoWebhook(req, res) {
  if (!String(process.env.DODO_PAYMENTS_WEBHOOK_KEY || '').trim()) {
    return res.status(503).json({ error: 'Billing webhook verification is not configured.' });
  }
  const headers = webhookHeaders(req);
  let event;
  try {
    const client = await getDodoClient();
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    event = client.webhooks.unwrap(rawBody, { headers });
  } catch (error) {
    console.warn('Rejected Dodo webhook:', error.message);
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  if (!BILLING_EVENTS.has(event.type)) {
    return res.status(200).json({ received: true, ignored: true });
  }

  const webhookId = headers['webhook-id'];
  const reserved = await reserveDodoWebhook(webhookId, event.type);
  if (!reserved) return res.status(200).json({ received: true, duplicate: true });

  try {
    let result;
    if (PAYMENT_EVENTS.has(event.type)) {
      const planChange = await recordPaymentWebhook({ eventType: event.type, payload: event.data });
      result = planChange
        ? { applied: true, planChange }
        : { applied: false, reason: 'payment_not_linked_to_plan_change' };
    } else {
      result = await syncDodoSubscription({
        eventType: event.type,
        payload: event.data,
        eventTimestamp: event.timestamp,
      });
      const subscriptionPlan = planForProductId(event.data?.product_id);
      if (subscriptionPlan && event.data?.subscription_id) {
        if (event.type === 'subscription.cancelled') {
          await closeOpenPlanChanges(event.data.subscription_id, 'cancelled', 'The subscription was cancelled.');
        } else if (['subscription.failed', 'subscription.expired'].includes(event.type)) {
          await closeOpenPlanChanges(event.data.subscription_id, 'failed', `The subscription became ${event.type.split('.').pop()}.`);
        } else {
          await completePlanChange(event.data.subscription_id, subscriptionPlan);
        }
      }
    }
    if (!result.applied) {
      console.warn(`Dodo webhook ${webhookId} was verified but not applied: ${result.reason}`);
    }
    return res.status(200).json({ received: true, applied: result.applied });
  } catch (error) {
    await releaseDodoWebhook(webhookId);
    throw error;
  }
}

module.exports = {
  billingConfiguration,
  checkoutCustomer,
  createCheckoutSession,
  createCustomerPortalSession,
  changeSubscriptionPlan,
  classifyPlanChangeState,
  getCurrentSubscriptionPlanChange,
  getSubscriptionPlanChangeStatus,
  handleDodoWebhook,
  planChangePaymentSummary,
  planChangeRequest,
  previewSubscriptionPlanChange,
  safeChargeSummary,
  planChangeStatus,
};
