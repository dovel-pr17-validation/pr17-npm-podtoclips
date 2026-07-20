const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });

const { getSql } = require('../src/storage/neonDb.cjs');

async function migrate() {
  const sql = getSql();

  await sql`
    create table if not exists episodes (
      id text primary key,
      title text not null,
      description text not null default '',
      status text not null,
      source jsonb not null,
      stages jsonb not null default '[]'::jsonb,
      transcript jsonb,
      candidates jsonb not null default '[]'::jsonb,
      clip_ids jsonb not null default '[]'::jsonb,
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await sql`
    create table if not exists clips (
      id text primary key,
      episode_id text not null references episodes(id) on delete cascade,
      candidate_id text not null,
      title text not null,
      category text not null,
      narrative_type text not null,
      confidence numeric not null,
      start_seconds numeric not null,
      end_seconds numeric not null,
      transcript text not null,
      reasoning text not null,
      visual_verification jsonb,
      scene_script jsonb,
      render jsonb not null,
      created_at timestamptz not null default now()
    )
  `;

  await sql`alter table episodes add column if not exists owner_user_id text`;
  await sql`
    update episodes
    set owner_user_id = coalesce(nullif(source #>> '{billing,accountId}', ''), 'legacy-unassigned')
    where owner_user_id is null or owner_user_id = ''
  `;
  await sql`alter table episodes alter column owner_user_id set not null`;
  await sql`create index if not exists episodes_owner_created_idx on episodes(owner_user_id, created_at desc)`;

  await sql`
    create table if not exists user_assets (
      asset_key text primary key,
      user_id text not null,
      kind text not null,
      created_at timestamptz not null default now(),
      constraint user_assets_kind_check check (kind in ('editor_upload', 'editor_export'))
    )
  `;
  await sql`create index if not exists user_assets_user_idx on user_assets(user_id, created_at desc)`;

  await sql`
    create table if not exists social_posts (
      id text primary key,
      clip_id text not null references clips(id) on delete cascade,
      linkedin text not null,
      x_thread jsonb not null,
      short_caption text not null,
      created_at timestamptz not null default now()
    )
  `;

  await sql`
    create table if not exists account_entitlements (
      user_id text primary key,
      plan text not null default 'free',
      subscription_status text not null default 'none',
      free_conversions_used integer not null default 0,
      monthly_conversions_used integer not null default 0,
      free_clips_used integer not null default 0,
      monthly_clips_used integer not null default 0,
      clip_quota_initialized boolean not null default true,
      usage_period_start timestamptz,
      usage_period_end timestamptz,
      dodo_customer_id text,
      dodo_subscription_id text unique,
      dodo_product_id text,
      current_period_end timestamptz,
      cancel_at_period_end boolean not null default false,
      last_dodo_event_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint account_entitlements_plan_check check (plan in ('free', 'creator', 'growth', 'studio', 'enterprise')),
      constraint account_entitlements_usage_check check (
        free_conversions_used >= 0 and monthly_conversions_used >= 0
        and free_clips_used >= 0 and monthly_clips_used >= 0
      )
    )
  `;

  await sql`alter table account_entitlements add column if not exists monthly_conversions_used integer not null default 0`;
  await sql`alter table account_entitlements add column if not exists free_clips_used integer not null default 0`;
  await sql`alter table account_entitlements add column if not exists monthly_clips_used integer not null default 0`;
  await sql`alter table account_entitlements add column if not exists clip_quota_initialized boolean not null default false`;
  await sql`
    update account_entitlements
    set free_clips_used = least(8, free_conversions_used * 8),
        monthly_clips_used = least(
          case plan when 'creator' then 40 when 'growth' then 96 when 'studio' then 192 else 2147483647 end,
          monthly_conversions_used * 8
        ),
        clip_quota_initialized = true
    where clip_quota_initialized = false
  `;
  await sql`alter table account_entitlements alter column clip_quota_initialized set default true`;
  await sql`alter table account_entitlements add column if not exists usage_period_start timestamptz`;
  await sql`alter table account_entitlements add column if not exists usage_period_end timestamptz`;
  await sql`alter table account_entitlements add column if not exists dodo_product_id text`;
  await sql`alter table account_entitlements add column if not exists cancel_at_period_end boolean not null default false`;
  await sql`alter table account_entitlements add column if not exists last_dodo_event_at timestamptz`;
  await sql`alter table account_entitlements drop constraint if exists account_entitlements_plan_check`;
  await sql`alter table account_entitlements drop constraint if exists account_entitlements_usage_check`;
  await sql`
    alter table account_entitlements
    add constraint account_entitlements_plan_check
    check (plan in ('free', 'creator', 'growth', 'studio', 'enterprise'))
  `;
  await sql`
    alter table account_entitlements
    add constraint account_entitlements_usage_check
    check (
      free_conversions_used >= 0 and monthly_conversions_used >= 0
      and free_clips_used >= 0 and monthly_clips_used >= 0
    )
  `;

  await sql`
    create table if not exists billing_webhook_events (
      webhook_id text primary key,
      event_type text not null,
      processed_at timestamptz not null default now()
    )
  `;

  await sql`
    create table if not exists billing_plan_changes (
      id text primary key,
      user_id text not null,
      dodo_subscription_id text not null,
      from_plan text not null,
      target_plan text not null,
      direction text not null,
      state text not null,
      provider_idempotency_key text not null unique,
      dodo_payment_id text unique,
      payment_status text,
      payment_amount bigint,
      payment_currency text,
      error_code text,
      error_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz,
      constraint billing_plan_changes_plan_check check (
        from_plan in ('creator', 'growth', 'studio')
        and target_plan in ('creator', 'growth', 'studio')
        and from_plan <> target_plan
      ),
      constraint billing_plan_changes_direction_check check (direction in ('upgrade', 'downgrade')),
      constraint billing_plan_changes_state_check check (
        state in ('created', 'processing', 'action_required', 'payment_succeeded', 'completed', 'failed', 'cancelled')
      )
    )
  `;
  await sql`
    create unique index if not exists billing_plan_changes_one_open_per_subscription_idx
    on billing_plan_changes (dodo_subscription_id)
    where state in ('created', 'processing', 'action_required', 'payment_succeeded')
  `;
  await sql`create index if not exists billing_plan_changes_user_idx on billing_plan_changes(user_id, created_at desc)`;

  await sql`
    create table if not exists clip_quota_reservations (
      generation_id text primary key,
      episode_id text not null references episodes(id) on delete cascade,
      user_id text not null,
      plan text not null,
      quota_bucket text not null,
      period_start timestamptz,
      reserved_clips integer not null,
      consumed_clips integer not null default 0,
      released_clips integer not null default 0,
      state text not null default 'reserved',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint clip_quota_reservations_plan_check check (plan in ('free', 'creator', 'growth', 'studio', 'enterprise')),
      constraint clip_quota_reservations_bucket_check check (quota_bucket in ('free_lifetime', 'paid_period')),
      constraint clip_quota_reservations_state_check check (state in ('reserved', 'settled')),
      constraint clip_quota_reservations_counts_check check (
        reserved_clips between 1 and 8
        and consumed_clips between 0 and reserved_clips
        and released_clips between 0 and reserved_clips
        and consumed_clips + released_clips <= reserved_clips
      )
    )
  `;
  await sql`create index if not exists clip_quota_reservations_episode_idx on clip_quota_reservations(episode_id, created_at desc)`;
  await sql`create index if not exists clip_quota_reservations_user_idx on clip_quota_reservations(user_id, created_at desc)`;
  await sql`
    update episodes
    set owner_user_id = evidence.user_id
    from (
      select distinct on (episode_id) episode_id, user_id
      from clip_quota_reservations
      order by episode_id, created_at desc
    ) evidence
    where episodes.id = evidence.episode_id
      and episodes.owner_user_id = 'legacy-unassigned'
  `;

  await sql`create index if not exists clips_episode_id_idx on clips(episode_id)`;
  await sql`create index if not exists social_posts_clip_id_idx on social_posts(clip_id)`;
  await sql`
    create index if not exists episodes_source_cache_key_idx
    on episodes ((source #>> '{import,cacheKey}'))
    where coalesce(source->>'assetKey', '') <> ''
  `;

  console.log('Neon Postgres migration complete.');
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
