const PLAN_DEFINITIONS = Object.freeze({
  free: Object.freeze({
    id: 'free',
    label: 'Free',
    clips: 8,
    period: 'lifetime',
    productEnv: null,
  }),
  creator: Object.freeze({
    id: 'creator',
    label: 'Creator',
    clips: 40,
    period: 'month',
    productEnv: 'DODO_CREATOR_PRODUCT_ID',
  }),
  growth: Object.freeze({
    id: 'growth',
    label: 'Growth',
    clips: 96,
    period: 'month',
    productEnv: 'DODO_GROWTH_PRODUCT_ID',
  }),
  studio: Object.freeze({
    id: 'studio',
    label: 'Studio',
    clips: 192,
    period: 'month',
    productEnv: 'DODO_STUDIO_PRODUCT_ID',
  }),
  enterprise: Object.freeze({
    id: 'enterprise',
    label: 'Enterprise',
    clips: null,
    period: 'month',
    productEnv: 'DODO_ENTERPRISE_PRODUCT_ID',
  }),
});

const PAID_PLAN_IDS = Object.freeze(['creator', 'growth', 'studio', 'enterprise']);

function getPlanDefinition(planId) {
  return PLAN_DEFINITIONS[String(planId || '').toLowerCase()] || null;
}

function productIdForPlan(planId) {
  const plan = getPlanDefinition(planId);
  if (!plan?.productEnv) return null;
  return String(process.env[plan.productEnv] || '').trim() || null;
}

function planForProductId(productId) {
  const normalized = String(productId || '').trim();
  if (!normalized) return null;
  return PAID_PLAN_IDS.find((planId) => productIdForPlan(planId) === normalized) || null;
}

function publicPlanCatalog() {
  return Object.values(PLAN_DEFINITIONS).map(({ productEnv: _productEnv, ...plan }) => ({
    ...plan,
    checkoutAvailable: plan.id === 'free' ? false : Boolean(productIdForPlan(plan.id)),
  }));
}

module.exports = {
  PAID_PLAN_IDS,
  PLAN_DEFINITIONS,
  getPlanDefinition,
  planForProductId,
  productIdForPlan,
  publicPlanCatalog,
};
