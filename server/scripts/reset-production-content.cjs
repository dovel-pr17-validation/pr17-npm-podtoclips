const path = require('path');
const {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} = require('@aws-sdk/client-s3');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });

const { getSql } = require('../src/storage/neonDb.cjs');

const EXECUTE_FLAG = '--execute-permanent-reset';
const execute = process.argv.includes(EXECUTE_FLAG);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function createR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: required('CLOUDFLARE_R2_ENDPOINT'),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required('CLOUDFLARE_R2_ACCESS_KEY_ID'),
      secretAccessKey: required('CLOUDFLARE_R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function listR2Objects(client, bucket) {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents || []) {
      if (object.Key) objects.push({ key: object.Key, size: Number(object.Size || 0) });
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

function summarizeObjects(objects) {
  const knownPrefixes = ['episodes/', 'renders/', 'render_jobs/', 'editor_uploads/', 'editor_exports/'];
  const summary = Object.fromEntries(knownPrefixes.map((prefix) => [prefix, 0]));
  summary.other = 0;
  for (const object of objects) {
    const prefix = knownPrefixes.find((candidate) => object.key.startsWith(candidate));
    summary[prefix || 'other'] += 1;
  }
  return {
    totalObjects: objects.length,
    totalBytes: objects.reduce((total, object) => total + object.size, 0),
    byPrefix: summary,
  };
}

async function databaseInventory(sql) {
  const [counts] = await sql`
    select
      (select count(*)::integer from episodes) as episodes,
      (select count(*)::integer from clips) as clips,
      (select count(*)::integer from social_posts) as social_posts,
      (select count(*)::integer from user_assets) as user_assets,
      (select count(*)::integer from clip_quota_reservations) as clip_quota_reservations,
      (select count(*)::integer from account_entitlements) as preserved_entitlements,
      (select count(*)::integer from billing_webhook_events) as preserved_webhook_events,
      (select count(*)::integer from billing_plan_changes) as preserved_plan_changes
  `;
  const statuses = await sql`
    select status, count(*)::integer as count
    from episodes
    group by status
    order by status
  `;
  return { counts, statuses };
}

async function deleteR2Objects(client, bucket, objects) {
  for (let index = 0; index < objects.length; index += 1000) {
    const batch = objects.slice(index, index + 1000);
    const result = await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: batch.map((object) => ({ Key: object.key })),
        Quiet: true,
      },
    }));
    if (result.Errors?.length) {
      throw new Error(`R2 rejected ${result.Errors.length} object deletions.`);
    }
  }
}

async function deleteDatabaseContent(sql) {
  await sql`delete from user_assets`;
  await sql`delete from episodes`;
}

async function main() {
  const sql = getSql();
  const bucket = required('CLOUDFLARE_R2_BUCKET_NAME');
  const r2 = createR2Client();

  const beforeObjects = await listR2Objects(r2, bucket);
  const beforeDatabase = await databaseInventory(sql);
  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'inventory',
    r2: summarizeObjects(beforeObjects),
    database: beforeDatabase,
    preserved: ['account_entitlements', 'billing_webhook_events', 'billing_plan_changes'],
  }, null, 2));

  if (!execute) {
    console.log(`Inventory only. Re-run with ${EXECUTE_FLAG} to permanently delete content.`);
    return;
  }

  await deleteR2Objects(r2, bucket, beforeObjects);
  await deleteDatabaseContent(sql);

  const afterObjects = await listR2Objects(r2, bucket);
  const afterDatabase = await databaseInventory(sql);
  const remainingContentRows = afterDatabase.counts.episodes
    + afterDatabase.counts.clips
    + afterDatabase.counts.social_posts
    + afterDatabase.counts.user_assets
    + afterDatabase.counts.clip_quota_reservations;
  if (afterObjects.length || remainingContentRows) {
    throw new Error(`Reset verification failed: ${afterObjects.length} R2 objects and ${remainingContentRows} content rows remain.`);
  }

  console.log(JSON.stringify({
    result: 'production content reset complete',
    r2: summarizeObjects(afterObjects),
    database: afterDatabase,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
