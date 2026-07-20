const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { reserveClipQuota } = require('../src/billing/entitlements.cjs');
const { getSql } = require('../src/storage/neonDb.cjs');

async function main() {
  const sql = getSql();
  const userId = `quota-concurrency-test-${randomUUID()}`;
  const runs = Array.from({ length: 20 }, (_, index) => ({
    episodeId: `episode-quota-${randomUUID()}`,
    generationId: `generation-quota-${index}-${randomUUID()}`,
  }));
  try {
    await sql`
      insert into account_entitlements (
        user_id, plan, subscription_status, monthly_clips_used,
        usage_period_start, usage_period_end, current_period_end
      ) values (
        ${userId}, 'creator', 'active', 0,
        now(), now() + interval '1 month', now() + interval '1 month'
      )
    `;
    for (const run of runs) {
      await sql`
        insert into episodes (id, owner_user_id, title, status, source, stages)
        values (${run.episodeId}, ${userId}, 'Quota concurrency test', 'processing', ${JSON.stringify({ billing: { accountId: userId } })}::jsonb, '[]'::jsonb)
      `;
    }

    const results = await Promise.all(
      runs.map((run) => reserveClipQuota({ userId, ...run, requestedClips: 8 })),
    );
    const reserved = results.reduce((total, result) => total + result.reservedClips, 0);
    const [record] = await sql`
      select monthly_clips_used
      from account_entitlements
      where user_id = ${userId}
    `;
    if (reserved !== 40 || Number(record?.monthly_clips_used) !== 40) {
      throw new Error(`Expected exactly 40 reserved clips; reserved=${reserved}, stored=${record?.monthly_clips_used}`);
    }
    console.log('Billing concurrency check passed: concurrent Creator reservations stopped exactly at 40 clips.');
  } finally {
    for (const run of runs) await sql`delete from episodes where id = ${run.episodeId}`;
    await sql`delete from account_entitlements where user_id = ${userId}`;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
