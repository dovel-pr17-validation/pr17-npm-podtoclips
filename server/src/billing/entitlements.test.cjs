const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const localPath = path.join(__dirname, '..', '..', 'data', 'entitlements.json');

function loadModule() {
  delete require.cache[require.resolve('./entitlements.cjs')];
  return require('./entitlements.cjs');
}

async function withLocalEntitlements(initialData, callback) {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousFile = fs.existsSync(localPath) ? fs.readFileSync(localPath) : null;
  delete process.env.DATABASE_URL;
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, JSON.stringify(initialData));
    return await callback(loadModule());
  } finally {
    if (previousFile) fs.writeFileSync(localPath, previousFile);
    else if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

const reserve = (billing, userId, generationId, requestedClips = 8) => billing.reserveClipQuota({
  userId,
  episodeId: `episode-${generationId}`,
  generationId,
  requestedClips,
});

test('a free account receives exactly eight lifetime clips', async () => {
  await withLocalEntitlements({}, async (billing) => {
    const initial = await billing.getAccountEntitlement('free-user');
    assert.equal(initial.clipsLimit, 8);
    assert.equal(initial.clipsRemaining, 8);
    assert.equal(initial.canGenerateClips, true);

    const first = await reserve(billing, 'free-user', 'free-generation');
    assert.equal(first.reservedClips, 8);
    await billing.settleClipQuota({ generationId: 'free-generation', successfulClips: 8 });
    const exhausted = await billing.getAccountEntitlement('free-user');
    assert.equal(exhausted.clipsUsed, 8);
    assert.equal(exhausted.clipsRemaining, 0);
    assert.equal(exhausted.canGenerateClips, false);
    assert.equal((await reserve(billing, 'free-user', 'free-generation-2')).reservedClips, 0);
  });
});

for (const [plan, limit] of [['creator', 40], ['growth', 96], ['studio', 192]]) {
  test(`${plan} is strictly capped at ${limit} clips per billing period`, async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await withLocalEntitlements({
      [`${plan}-user`]: {
        userId: `${plan}-user`,
        plan,
        subscriptionStatus: 'active',
        monthlyClipsUsed: 0,
        usagePeriodStart: '2026-07-01T00:00:00.000Z',
        currentPeriodEnd: future,
        usagePeriodEnd: future,
      },
    }, async (billing) => {
      const generations = limit / 8;
      for (let count = 1; count <= generations; count += 1) {
        const generationId = `${plan}-generation-${count}`;
        const claimed = await reserve(billing, `${plan}-user`, generationId);
        assert.equal(claimed.reservedClips, 8);
        await billing.settleClipQuota({ generationId, successfulClips: 8 });
        assert.equal((await billing.getAccountEntitlement(`${plan}-user`)).clipsUsed, count * 8);
      }
      assert.equal((await reserve(billing, `${plan}-user`, `${plan}-over-limit`)).reservedClips, 0);
      const final = await billing.getAccountEntitlement(`${plan}-user`);
      assert.equal(final.clipsRemaining, 0);
      assert.equal(final.canGenerateClips, false);
    });
  });
}

test('concurrent reservations cannot exceed the paid clip limit', async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  await withLocalEntitlements({
    concurrent: {
      userId: 'concurrent',
      plan: 'creator',
      subscriptionStatus: 'active',
      monthlyClipsUsed: 0,
      usagePeriodStart: '2026-07-01T00:00:00.000Z',
      currentPeriodEnd: future,
    },
  }, async (billing) => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (
      reserve(billing, 'concurrent', `concurrent-${index}`)
    )));
    assert.equal(results.reduce((sum, result) => sum + result.reservedClips, 0), 40);
    assert.equal((await billing.getAccountEntitlement('concurrent')).clipsUsed, 40);
  });
});

test('failed clip renders release reserved quota exactly once', async () => {
  await withLocalEntitlements({}, async (billing) => {
    await reserve(billing, 'refund-user', 'refund-generation');
    const settled = await billing.settleClipQuota({ generationId: 'refund-generation', successfulClips: 5 });
    assert.equal(settled.consumedClips, 5);
    assert.equal(settled.releasedClips, 3);
    assert.equal(settled.entitlement.clipsUsed, 5);

    const repeated = await billing.settleClipQuota({ generationId: 'refund-generation', successfulClips: 0 });
    assert.equal(repeated.consumedClips, 5);
    assert.equal(repeated.releasedClips, 3);
    assert.equal(repeated.entitlement.clipsUsed, 5);
  });
});

test('an inactive or expired paid subscription is exposed as Free and cannot regain used lifetime clips', async () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  await withLocalEntitlements({
    inactive: { userId: 'inactive', plan: 'growth', subscriptionStatus: 'cancelled', freeClipsUsed: 8, monthlyClipsUsed: 24 },
    expired: { userId: 'expired', plan: 'studio', subscriptionStatus: 'active', currentPeriodEnd: past, freeClipsUsed: 8, monthlyClipsUsed: 32 },
  }, async (billing) => {
    for (const userId of ['inactive', 'expired']) {
      const entitlement = await billing.getAccountEntitlement(userId);
      assert.equal(entitlement.plan, 'free');
      assert.equal(entitlement.planLabel, 'Free');
      assert.equal(entitlement.clipsLimit, 8);
      assert.equal(entitlement.clipsUsed, 8);
      assert.equal(entitlement.clipsRemaining, 0);
      assert.equal((await reserve(billing, userId, `${userId}-after-cancel`)).reservedClips, 0);
    }
  });
});

test('cancelling after an upgrade returns to the lifetime Free clip pool, never the original paid tier', async () => {
  const previousCreatorProduct = process.env.DODO_CREATOR_PRODUCT_ID;
  const previousGrowthProduct = process.env.DODO_GROWTH_PRODUCT_ID;
  process.env.DODO_CREATOR_PRODUCT_ID = 'creator-product-cancellation-test';
  process.env.DODO_GROWTH_PRODUCT_ID = 'growth-product-cancellation-test';
  const future = new Date(Date.now() + 86_400_000).toISOString();
  try {
    await withLocalEntitlements({
      upgraded: {
        userId: 'upgraded',
        plan: 'creator',
        subscriptionStatus: 'active',
        freeClipsUsed: 3,
        monthlyClipsUsed: 16,
        usagePeriodStart: '2026-07-01T00:00:00.000Z',
        currentPeriodEnd: future,
        dodoSubscriptionId: 'sub_upgrade_cancel',
      },
    }, async (billing) => {
      await billing.syncDodoSubscription({
        eventType: 'subscription.plan_changed',
        eventTimestamp: '2026-07-19T08:00:00.000Z',
        payload: {
          subscription_id: 'sub_upgrade_cancel',
          product_id: 'growth-product-cancellation-test',
          status: 'active',
          previous_billing_date: '2026-07-01T00:00:00.000Z',
          next_billing_date: future,
          metadata: { easyedits_user_id: 'upgraded' },
        },
      });
      await billing.syncDodoSubscription({
        eventType: 'subscription.cancelled',
        eventTimestamp: '2026-07-19T09:00:00.000Z',
        payload: {
          subscription_id: 'sub_upgrade_cancel',
          product_id: 'growth-product-cancellation-test',
          status: 'cancelled',
          previous_billing_date: '2026-07-01T00:00:00.000Z',
          next_billing_date: future,
          metadata: { easyedits_user_id: 'upgraded' },
        },
      });

      const cancelled = await billing.getAccountEntitlement('upgraded');
      assert.equal(cancelled.plan, 'free');
      assert.equal(cancelled.clipsLimit, 8);
      assert.equal(cancelled.clipsUsed, 3);
      assert.equal(cancelled.clipsRemaining, 5);
      const reservation = await reserve(billing, 'upgraded', 'free-after-cancel', 8);
      assert.equal(reservation.reservedClips, 5);
      await billing.settleClipQuota({ generationId: 'free-after-cancel', successfulClips: 5 });
      assert.equal((await billing.getAccountEntitlement('upgraded')).clipsRemaining, 0);
    });
  } finally {
    if (previousCreatorProduct === undefined) delete process.env.DODO_CREATOR_PRODUCT_ID;
    else process.env.DODO_CREATOR_PRODUCT_ID = previousCreatorProduct;
    if (previousGrowthProduct === undefined) delete process.env.DODO_GROWTH_PRODUCT_ID;
    else process.env.DODO_GROWTH_PRODUCT_ID = previousGrowthProduct;
  }
});

test('only a verified new billing period resets paid clip usage', async () => {
  const previousStudioProduct = process.env.DODO_STUDIO_PRODUCT_ID;
  process.env.DODO_STUDIO_PRODUCT_ID = 'studio-product-renewal-test';
  try {
    await withLocalEntitlements({
      renewing: {
        userId: 'renewing',
        plan: 'studio',
        subscriptionStatus: 'active',
        freeClipsUsed: 8,
        monthlyClipsUsed: 62,
        usagePeriodStart: '2026-07-01T00:00:00.000Z',
        dodoSubscriptionId: 'sub_test',
      },
    }, async (billing) => {
      await billing.syncDodoSubscription({
        eventType: 'subscription.updated',
        eventTimestamp: '2026-07-20T00:00:01.000Z',
        payload: {
          subscription_id: 'sub_test',
          product_id: 'studio-product-renewal-test',
          status: 'active',
          created_at: '2026-01-01T00:00:00.000Z',
          next_billing_date: '2026-08-01T00:00:00.000Z',
          metadata: { easyedits_user_id: 'renewing' },
        },
      });
      assert.equal((await billing.getAccountEntitlement('renewing')).clipsUsed, 62);

      await billing.syncDodoSubscription({
        eventType: 'subscription.renewed',
        eventTimestamp: '2026-08-01T00:00:01.000Z',
        payload: {
          subscription_id: 'sub_test',
          product_id: 'studio-product-renewal-test',
          status: 'active',
          previous_billing_date: '2026-08-01T00:00:00.000Z',
          next_billing_date: '2026-09-01T00:00:00.000Z',
          metadata: { easyedits_user_id: 'renewing' },
        },
      });
      const entitlement = await billing.getAccountEntitlement('renewing');
      assert.equal(entitlement.clipsUsed, 0);
      assert.equal(entitlement.clipsRemaining, 192);
      assert.equal(entitlement.freeClipsUsed, 8);
    });
  } finally {
    if (previousStudioProduct === undefined) delete process.env.DODO_STUDIO_PRODUCT_ID;
    else process.env.DODO_STUDIO_PRODUCT_ID = previousStudioProduct;
  }
});

test('webhook event IDs are reserved once and can be released for retry', async () => {
  await withLocalEntitlements({}, async ({ releaseDodoWebhook, reserveDodoWebhook }) => {
    assert.equal(await reserveDodoWebhook('webhook-1', 'subscription.active'), true);
    assert.equal(await reserveDodoWebhook('webhook-1', 'subscription.active'), false);
    await releaseDodoWebhook('webhook-1');
    assert.equal(await reserveDodoWebhook('webhook-1', 'subscription.active'), true);
  });
});
