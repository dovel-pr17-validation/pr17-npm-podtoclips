const { execFileSync, spawnSync } = require('node:child_process');

const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0403595599';
const endpointUrl = process.env.DODO_WEBHOOK_ENDPOINT
  || 'https://easyedits-api-156759709742.asia-south1.run.app/api/billing/dodo/webhook';

function gcloud(args, options = {}) {
  return execFileSync('gcloud', [...args, '--project', projectId], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

async function main() {
  const apiKey = gcloud(['secrets', 'versions', 'access', 'latest', '--secret', 'DODO_PAYMENTS_API_KEY']);
  const { default: DodoPayments } = await import('dodopayments');
  const client = new DodoPayments({ bearerToken: apiKey, environment: 'test_mode' });

  let endpoint = null;
  for await (const webhook of client.webhooks.list()) {
    if (String(webhook.url || '').replace(/\/$/, '') === endpointUrl.replace(/\/$/, '')) {
      endpoint = webhook;
      break;
    }
  }
  if (!endpoint) throw new Error(`No Dodo test-mode webhook matches ${endpointUrl}`);

  const signingKey = await client.webhooks.retrieveSecret(endpoint.id);
  if (!signingKey?.secret) throw new Error('Dodo did not return a webhook signing key.');

  try {
    gcloud(['secrets', 'describe', 'DODO_PAYMENTS_WEBHOOK_KEY']);
  } catch {
    gcloud(['secrets', 'create', 'DODO_PAYMENTS_WEBHOOK_KEY', '--replication-policy=automatic']);
  }

  const added = spawnSync(
    'gcloud',
    ['secrets', 'versions', 'add', 'DODO_PAYMENTS_WEBHOOK_KEY', '--data-file=-', '--project', projectId],
    { input: signingKey.secret, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  if (added.status !== 0) throw new Error(added.stderr || 'Failed to store the Dodo webhook signing key.');

  console.log(`Stored the signing key for enabled webhook ${endpoint.id}.`);
  console.log(`Subscribed events: ${(endpoint.filter_types || []).join(', ')}`);
  console.log(`Endpoint throttling: ${endpoint.rate_limit == null ? 'disabled' : endpoint.rate_limit}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
