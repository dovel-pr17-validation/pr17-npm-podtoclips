const fs = require('node:fs');
const path = require('node:path');
const { getSql, hasDatabaseUrl } = require('../storage/neonDb.cjs');
const { getPlanDefinition, PAID_PLAN_IDS, planForProductId } = require('./plans.cjs');

const FREE_CLIP_LIMIT = 8;
const LOCAL_PATH = path.join(__dirname, '..', '..', 'data', 'entitlements.json');
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active']);

function assertDurableBillingStore() {
  if (!hasDatabaseUrl() && (process.env.NODE_ENV === 'production' || process.env.BILLING_REQUIRE_DATABASE === '1')) {
    const error = new Error('Billing access is temporarily unavailable because the durable quota store is not configured.');
    error.statusCode = 503;
    error.code = 'BILLING_DATABASE_REQUIRED';
    throw error;
  }
}

function defaultRecord(userId) {
  const now = new Date().toISOString();
  return {
    userId,
    plan: 'free',
    subscriptionStatus: 'none',
    freeClipsUsed: 0,
    monthlyClipsUsed: 0,
    usagePeriodStart: null,
    usagePeriodEnd: null,
    dodoCustomerId: null,
    dodoSubscriptionId: null,
    dodoProductId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastDodoEventAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeRecord(record, userId = record?.userId) {
  return {
    ...defaultRecord(userId),
    ...record,
    userId,
    freeClipsUsed: Number(record?.freeClipsUsed || 0),
    monthlyClipsUsed: Number(record?.monthlyClipsUsed || 0),
    cancelAtPeriodEnd: Boolean(record?.cancelAtPeriodEnd),
  };
}

function mapRow(row) {
  if (!row) return null;
  return normalizeRecord({
    userId: row.user_id,
    plan: row.plan,
    subscriptionStatus: row.subscription_status,
    freeClipsUsed: Number(row.free_clips_used || 0),
    monthlyClipsUsed: Number(row.monthly_clips_used || 0),
    usagePeriodStart: row.usage_period_start || null,
    usagePeriodEnd: row.usage_period_end || null,
    dodoCustomerId: row.dodo_customer_id || null,
    dodoSubscriptionId: row.dodo_subscription_id || null,
    dodoProductId: row.dodo_product_id || null,
    currentPeriodEnd: row.current_period_end || null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    lastDodoEventAt: row.last_dodo_event_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function subscriptionPeriodIsCurrent(record, now = Date.now()) {
  if (!record.currentPeriodEnd) return true;
  const periodEnd = new Date(record.currentPeriodEnd).getTime();
  return Number.isFinite(periodEnd) && periodEnd > now;
}

function isPaid(record) {
  return PAID_PLAN_IDS.includes(record.plan)
    && ACTIVE_SUBSCRIPTION_STATUSES.has(record.subscriptionStatus)
    && subscriptionPeriodIsCurrent(record);
}

function publicEntitlement(record) {
  const normalized = normalizeRecord(record);
  const paid = isPaid(normalized);
  // Keep the provider plan on the durable record for billing history, but only
  // expose a paid plan while its subscription is actually entitled. Otherwise
  // every product surface must behave as Free (including cancelled/expired
  // subscriptions) instead of advertising a stale paid allowance.
  const effectivePlanId = paid ? normalized.plan : 'free';
  const plan = getPlanDefinition(effectivePlanId) || getPlanDefinition('free');
  const freeUsed = Math.max(0, Number(normalized.freeClipsUsed || 0));
  const monthlyUsed = Math.max(0, Number(normalized.monthlyClipsUsed || 0));
  const limit = effectivePlanId === 'free' ? FREE_CLIP_LIMIT : plan.clips;
  const used = effectivePlanId === 'free' ? freeUsed : monthlyUsed;
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const canGenerateClips = effectivePlanId === 'free'
    ? freeUsed < FREE_CLIP_LIMIT
    : paid && (limit === null || monthlyUsed < limit);

  return {
    plan: effectivePlanId,
    planLabel: plan.label,
    subscriptionStatus: normalized.subscriptionStatus,
    isPaid: paid,
    clipsLimit: limit,
    clipsUsed: used,
    clipsRemaining: remaining,
    billingPeriodStart: normalized.usagePeriodStart,
    billingPeriodEnd: normalized.usagePeriodEnd || normalized.currentPeriodEnd,
    cancelAtPeriodEnd: normalized.cancelAtPeriodEnd,
    canManageBilling: Boolean(normalized.dodoCustomerId),
    freeClipsLimit: FREE_CLIP_LIMIT,
    freeClipsUsed: freeUsed,
    freeClipsRemaining: paid ? null : Math.max(0, FREE_CLIP_LIMIT - freeUsed),
    canGenerateClips,
    // Compatibility aliases keep older clients safe during the rollout. They
    // now represent clips, never podcast uploads or transcriptions.
    conversionsLimit: limit,
    conversionsUsed: used,
    conversionsRemaining: remaining,
    freeConversionsLimit: FREE_CLIP_LIMIT,
    freeConversionsUsed: freeUsed,
    freeConversionsRemaining: paid ? null : Math.max(0, FREE_CLIP_LIMIT - freeUsed),
    canConvertPodcast: canGenerateClips,
    currentPeriodEnd: normalized.currentPeriodEnd,
  };
}

function readLocal() {
  fs.mkdirSync(path.dirname(LOCAL_PATH), { recursive: true });
  if (!fs.existsSync(LOCAL_PATH)) fs.writeFileSync(LOCAL_PATH, '{}');
  return JSON.parse(fs.readFileSync(LOCAL_PATH, 'utf8'));
}

function writeLocal(data) {
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
}

async function getRecord(userId) {
  if (!userId) throw new Error('A user ID is required for entitlement checks.');
  assertDurableBillingStore();
  if (!hasDatabaseUrl()) {
    const data = readLocal();
    const record = normalizeRecord(data[userId], userId);
    data[userId] = record;
    writeLocal(data);
    return record;
  }

  const sql = getSql();
  const [row] = await sql`
    insert into account_entitlements (user_id)
    values (${userId})
    on conflict (user_id) do update set user_id = excluded.user_id
    returning *
  `;
  return mapRow(row);
}

async function getAccountEntitlement(userId) {
  return publicEntitlement(await getRecord(userId));
}

async function getAccountBillingIdentity(userId) {
  const record = await getRecord(userId);
  return {
    userId: record.userId,
    dodoCustomerId: record.dodoCustomerId,
    dodoSubscriptionId: record.dodoSubscriptionId,
    dodoProductId: record.dodoProductId,
  };
}

function normalizeClipCount(value) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function reservationResult(reservation, entitlement) {
  return {
    generationId: reservation?.generationId || reservation?.generation_id || null,
    episodeId: reservation?.episodeId || reservation?.episode_id || null,
    reservedClips: Number(reservation?.reservedClips ?? reservation?.reserved_clips ?? 0),
    consumedClips: Number(reservation?.consumedClips ?? reservation?.consumed_clips ?? 0),
    releasedClips: Number(reservation?.releasedClips ?? reservation?.released_clips ?? 0),
    state: reservation?.state || 'unavailable',
    entitlement,
  };
}

async function reserveClipQuota({ userId, episodeId, generationId, requestedClips }) {
  if (!userId || !episodeId || !generationId) {
    throw new Error('User, episode, and generation IDs are required to reserve clip quota.');
  }
  const requested = Math.min(8, normalizeClipCount(requestedClips));
  assertDurableBillingStore();
  if (!requested) return reservationResult(null, await getAccountEntitlement(userId));

  if (!hasDatabaseUrl()) {
    const data = readLocal();
    data.__clipQuotaReservations ||= {};
    const existing = data.__clipQuotaReservations[generationId];
    if (existing) {
      if (existing.userId !== userId || existing.episodeId !== episodeId) {
        throw new Error('Clip quota reservation identity mismatch.');
      }
      return reservationResult(existing, publicEntitlement(normalizeRecord(data[userId], userId)));
    }

    const record = normalizeRecord(data[userId], userId);
    const entitlement = publicEntitlement(record);
    const available = entitlement.clipsRemaining === null ? requested : Math.min(requested, entitlement.clipsRemaining);
    if (!available) return reservationResult(null, entitlement);
    const bucket = entitlement.isPaid ? 'paid_period' : 'free_lifetime';
    if (bucket === 'paid_period') record.monthlyClipsUsed += available;
    else record.freeClipsUsed += available;
    record.updatedAt = new Date().toISOString();
    const reservation = {
      generationId,
      episodeId,
      userId,
      plan: entitlement.plan,
      bucket,
      periodStart: entitlement.billingPeriodStart,
      reservedClips: available,
      consumedClips: 0,
      releasedClips: 0,
      state: 'reserved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data[userId] = record;
    data.__clipQuotaReservations[generationId] = reservation;
    writeLocal(data);
    return reservationResult(reservation, publicEntitlement(record));
  }

  const sql = getSql();
  const creatorLimit = getPlanDefinition('creator').clips;
  const growthLimit = getPlanDefinition('growth').clips;
  const studioLimit = getPlanDefinition('studio').clips;
  await sql`
    insert into account_entitlements (user_id)
    values (${userId})
    on conflict (user_id) do nothing
  `;
  const existingRows = await sql`
    select * from clip_quota_reservations where generation_id = ${generationId}
  `;
  if (existingRows[0]) {
    if (existingRows[0].user_id !== userId || existingRows[0].episode_id !== episodeId) {
      throw new Error('Clip quota reservation identity mismatch.');
    }
    return reservationResult(existingRows[0], await getAccountEntitlement(userId));
  }

  const rows = await sql`
    with locked_account as materialized (
      select *,
        case
          when plan = 'free'
            or subscription_status <> 'active'
            or (current_period_end is not null and current_period_end <= now())
          then 'free_lifetime'
          else 'paid_period'
        end as quota_bucket,
        case
          when plan = 'free'
            or subscription_status <> 'active'
            or (current_period_end is not null and current_period_end <= now())
          then ${FREE_CLIP_LIMIT}
          when plan = 'creator' then ${creatorLimit}
          when plan = 'growth' then ${growthLimit}
          when plan = 'studio' then ${studioLimit}
          else 2147483647
        end as quota_limit
      from account_entitlements
      where user_id = ${userId}
      for update
    ), capacity as (
      select *, least(
        ${requested},
        greatest(0, quota_limit - case when quota_bucket = 'free_lifetime' then free_clips_used else monthly_clips_used end)
      )::integer as clips_to_reserve
      from locked_account
    ), inserted as (
      insert into clip_quota_reservations (
        generation_id, episode_id, user_id, plan, quota_bucket, period_start,
        reserved_clips, consumed_clips, released_clips, state
      )
      select
        ${generationId}, ${episodeId}, ${userId},
        case when quota_bucket = 'free_lifetime' then 'free' else plan end,
        quota_bucket, usage_period_start, clips_to_reserve, 0, 0, 'reserved'
      from capacity
      where clips_to_reserve > 0
      on conflict (generation_id) do nothing
      returning *
    ), charged as (
      update account_entitlements entitlement
      set free_clips_used = entitlement.free_clips_used + case when inserted.quota_bucket = 'free_lifetime' then inserted.reserved_clips else 0 end,
          monthly_clips_used = entitlement.monthly_clips_used + case when inserted.quota_bucket = 'paid_period' then inserted.reserved_clips else 0 end,
          updated_at = now()
      from inserted
      where entitlement.user_id = inserted.user_id
      returning entitlement.user_id
    )
    select inserted.* from inserted join charged using (user_id)
  `;
  const reservation = rows[0] || (await sql`select * from clip_quota_reservations where generation_id = ${generationId}`)[0] || null;
  if (reservation && (reservation.user_id !== userId || reservation.episode_id !== episodeId)) {
    throw new Error('Clip quota reservation identity mismatch.');
  }
  return reservationResult(reservation, await getAccountEntitlement(userId));
}

async function settleClipQuota({ generationId, successfulClips }) {
  if (!generationId) return null;
  const successful = normalizeClipCount(successfulClips);
  assertDurableBillingStore();

  if (!hasDatabaseUrl()) {
    const data = readLocal();
    const reservation = data.__clipQuotaReservations?.[generationId];
    if (!reservation) return null;
    if (reservation.state !== 'reserved') {
      return reservationResult(reservation, publicEntitlement(normalizeRecord(data[reservation.userId], reservation.userId)));
    }
    const consumed = Math.min(successful, reservation.reservedClips);
    const released = reservation.reservedClips - consumed;
    const record = normalizeRecord(data[reservation.userId], reservation.userId);
    if (reservation.bucket === 'free_lifetime') {
      record.freeClipsUsed = Math.max(0, record.freeClipsUsed - released);
    } else if (record.usagePeriodStart === reservation.periodStart) {
      record.monthlyClipsUsed = Math.max(0, record.monthlyClipsUsed - released);
    }
    reservation.consumedClips = consumed;
    reservation.releasedClips = released;
    reservation.state = 'settled';
    reservation.updatedAt = new Date().toISOString();
    data[reservation.userId] = record;
    data.__clipQuotaReservations[generationId] = reservation;
    writeLocal(data);
    return reservationResult(reservation, publicEntitlement(record));
  }

  const sql = getSql();
  const rows = await sql`
    with settled as (
      update clip_quota_reservations
      set consumed_clips = least(reserved_clips, ${successful}),
          released_clips = reserved_clips - least(reserved_clips, ${successful}),
          state = 'settled',
          updated_at = now()
      where generation_id = ${generationId} and state = 'reserved'
      returning *
    ), refunded as (
      update account_entitlements entitlement
      set free_clips_used = greatest(0, entitlement.free_clips_used - case
            when settled.quota_bucket = 'free_lifetime' then settled.released_clips else 0 end),
          monthly_clips_used = greatest(0, entitlement.monthly_clips_used - case
            when settled.quota_bucket = 'paid_period'
              and entitlement.usage_period_start is not distinct from settled.period_start
            then settled.released_clips else 0 end),
          updated_at = now()
      from settled
      where entitlement.user_id = settled.user_id
      returning entitlement.user_id
    )
    select settled.* from settled join refunded using (user_id)
  `;
  const reservation = rows[0] || (await sql`select * from clip_quota_reservations where generation_id = ${generationId}`)[0] || null;
  if (!reservation) return null;
  return reservationResult(reservation, await getAccountEntitlement(reservation.user_id));
}

async function settleEpisodeClipQuota({ episodeId, successfulClips, generationId = null }) {
  if (!episodeId) return null;
  if (generationId) {
    const exact = await settleClipQuota({ generationId, successfulClips });
    if (exact) return exact;
  }
  if (!hasDatabaseUrl()) {
    const data = readLocal();
    const reservation = Object.values(data.__clipQuotaReservations || {})
      .filter((item) => item.episodeId === episodeId && item.state === 'reserved')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    return reservation ? settleClipQuota({ generationId: reservation.generationId, successfulClips }) : null;
  }
  const sql = getSql();
  const [reservation] = await sql`
    select generation_id from clip_quota_reservations
    where episode_id = ${episodeId} and state = 'reserved'
    order by created_at desc limit 1
  `;
  return reservation ? settleClipQuota({ generationId: reservation.generation_id, successfulClips }) : null;
}

function statusForSubscriptionEvent(eventType, payloadStatus) {
  const explicit = String(payloadStatus || '').trim().toLowerCase();
  if (explicit) return explicit;
  const suffix = String(eventType || '').split('.').pop();
  if (['active', 'renewed', 'plan_changed'].includes(suffix)) return 'active';
  if (['on_hold', 'cancelled', 'failed', 'expired'].includes(suffix)) return suffix;
  return 'updated';
}

function identityFromSubscription(payload) {
  return String(
    payload?.metadata?.easyedits_user_id
    || payload?.metadata?.clerk_user_id
    || payload?.customer?.metadata?.easyedits_user_id
    || payload?.customer?.metadata?.clerk_user_id
    || '',
  ).trim() || null;
}

async function findUserForSubscription(payload) {
  const metadataUserId = identityFromSubscription(payload);
  if (metadataUserId) return metadataUserId;
  if (!hasDatabaseUrl()) {
    const data = readLocal();
    const match = Object.values(data).map((record) => normalizeRecord(record)).find((record) => (
      (payload.subscription_id && record.dodoSubscriptionId === payload.subscription_id)
      || (payload.customer?.customer_id && record.dodoCustomerId === payload.customer.customer_id)
    ));
    return match?.userId || null;
  }
  const sql = getSql();
  const subscriptionId = payload.subscription_id || '';
  const customerId = payload.customer?.customer_id || '';
  const [row] = await sql`
    select user_id from account_entitlements
    where (${subscriptionId} <> '' and dodo_subscription_id = ${subscriptionId})
       or (${customerId} <> '' and dodo_customer_id = ${customerId})
    limit 1
  `;
  return row?.user_id || null;
}

async function syncDodoSubscription({ eventType, payload, eventTimestamp }) {
  assertDurableBillingStore();
  const userId = await findUserForSubscription(payload);
  if (!userId) return { applied: false, reason: 'missing_user_identity' };
  const productId = String(payload.product_id || '').trim();
  const plan = planForProductId(productId);
  if (!plan) return { applied: false, reason: 'unknown_product' };

  const status = statusForSubscriptionEvent(eventType, payload.status);
  const customerId = payload.customer?.customer_id || null;
  const subscriptionId = payload.subscription_id || null;
  // `created_at` is the lifetime subscription creation timestamp, not a
  // billing-period boundary. Treating it as one lets ordinary update events
  // reset monthly quota. Only Dodo's explicit period field may advance usage.
  const periodStart = payload.previous_billing_date || null;
  const periodEnd = payload.next_billing_date || payload.expires_at || null;
  const occurredAt = eventTimestamp || new Date().toISOString();
  const cancelAtPeriodEnd = Boolean(payload.cancel_at_next_billing_date);

  if (!hasDatabaseUrl()) {
    const data = readLocal();
    const record = normalizeRecord(data[userId], userId);
    if (record.lastDodoEventAt && new Date(record.lastDodoEventAt) > new Date(occurredAt)) {
      return { applied: false, reason: 'stale_event' };
    }
    const periodChanged = Boolean(periodStart && record.usagePeriodStart !== periodStart);
    const subscriptionChanged = Boolean(subscriptionId && record.dodoSubscriptionId !== subscriptionId);
    record.plan = plan;
    record.subscriptionStatus = status;
    record.monthlyClipsUsed = periodChanged || subscriptionChanged ? 0 : record.monthlyClipsUsed;
    record.usagePeriodStart = periodStart || record.usagePeriodStart;
    record.usagePeriodEnd = periodEnd || record.usagePeriodEnd;
    record.currentPeriodEnd = periodEnd || record.currentPeriodEnd;
    record.dodoCustomerId = customerId || record.dodoCustomerId;
    record.dodoSubscriptionId = subscriptionId || record.dodoSubscriptionId;
    record.dodoProductId = productId;
    record.cancelAtPeriodEnd = cancelAtPeriodEnd;
    record.lastDodoEventAt = occurredAt;
    record.updatedAt = new Date().toISOString();
    data[userId] = record;
    writeLocal(data);
    return { applied: true, userId, entitlement: publicEntitlement(record) };
  }

  const sql = getSql();
  const [row] = await sql`
    insert into account_entitlements (
      user_id, plan, subscription_status, monthly_clips_used,
      usage_period_start, usage_period_end, dodo_customer_id,
      dodo_subscription_id, dodo_product_id, current_period_end,
      cancel_at_period_end, last_dodo_event_at
    ) values (
      ${userId}, ${plan}, ${status}, 0,
      ${periodStart}, ${periodEnd}, ${customerId},
      ${subscriptionId}, ${productId}, ${periodEnd},
      ${cancelAtPeriodEnd}, ${occurredAt}
    )
    on conflict (user_id) do update set
      plan = excluded.plan,
      subscription_status = excluded.subscription_status,
      monthly_clips_used = case
        when account_entitlements.dodo_subscription_id is distinct from excluded.dodo_subscription_id
          or (
            excluded.usage_period_start is not null
            and account_entitlements.usage_period_start is distinct from excluded.usage_period_start
          )
        then 0 else account_entitlements.monthly_clips_used end,
      usage_period_start = coalesce(excluded.usage_period_start, account_entitlements.usage_period_start),
      usage_period_end = coalesce(excluded.usage_period_end, account_entitlements.usage_period_end),
      dodo_customer_id = coalesce(excluded.dodo_customer_id, account_entitlements.dodo_customer_id),
      dodo_subscription_id = coalesce(excluded.dodo_subscription_id, account_entitlements.dodo_subscription_id),
      dodo_product_id = excluded.dodo_product_id,
      current_period_end = coalesce(excluded.current_period_end, account_entitlements.current_period_end),
      cancel_at_period_end = excluded.cancel_at_period_end,
      last_dodo_event_at = excluded.last_dodo_event_at,
      updated_at = now()
    where account_entitlements.last_dodo_event_at is null
       or account_entitlements.last_dodo_event_at <= excluded.last_dodo_event_at
    returning *
  `;
  return row
    ? { applied: true, userId, entitlement: publicEntitlement(mapRow(row)) }
    : { applied: false, reason: 'stale_event' };
}

async function reserveDodoWebhook(webhookId, eventType) {
  if (!webhookId) throw new Error('A Dodo webhook ID is required.');
  assertDurableBillingStore();
  if (!hasDatabaseUrl()) {
    const data = readLocal();
    data.__processedWebhooks ||= {};
    if (data.__processedWebhooks[webhookId]) return false;
    data.__processedWebhooks[webhookId] = { eventType, processedAt: new Date().toISOString() };
    writeLocal(data);
    return true;
  }
  const sql = getSql();
  const [row] = await sql`
    insert into billing_webhook_events (webhook_id, event_type)
    values (${webhookId}, ${eventType})
    on conflict (webhook_id) do nothing
    returning webhook_id
  `;
  return Boolean(row);
}

async function releaseDodoWebhook(webhookId) {
  if (!webhookId) return;
  if (!hasDatabaseUrl()) {
    const data = readLocal();
    if (data.__processedWebhooks) delete data.__processedWebhooks[webhookId];
    writeLocal(data);
    return;
  }
  const sql = getSql();
  await sql`delete from billing_webhook_events where webhook_id = ${webhookId}`;
}

async function hasPaidPodcastAccess(userId) {
  return (await getAccountEntitlement(userId)).isPaid;
}

module.exports = {
  FREE_CLIP_LIMIT,
  getAccountBillingIdentity,
  getAccountEntitlement,
  hasPaidPodcastAccess,
  identityFromSubscription,
  publicEntitlement,
  releaseDodoWebhook,
  reserveClipQuota,
  reserveDodoWebhook,
  settleClipQuota,
  settleEpisodeClipQuota,
  statusForSubscriptionEvent,
  syncDodoSubscription,
};
