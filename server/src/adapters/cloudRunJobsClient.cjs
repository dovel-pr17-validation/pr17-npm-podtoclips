const { GoogleAuth } = require('google-auth-library');

const RUN_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function config() {
  return {
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.CLOUD_RUN_PROJECT_ID || '',
    location: process.env.CLOUD_RUN_LOCATION || 'asia-south1',
    renderJob: process.env.CLOUD_RUN_RENDER_JOB || 'easyedits-render-worker',
    timeoutSeconds: Number(process.env.CLOUD_RUN_RENDER_TIMEOUT_SECONDS || 1200),
    pollMilliseconds: Number(process.env.CLOUD_RUN_OPERATION_POLL_MS || 5000),
  };
}

function configured() {
  const settings = config();
  return Boolean(settings.projectId && settings.location && settings.renderJob);
}

function operationUrl(name) {
  if (!name || !/^projects\/[^/]+\/locations\/[^/]+\/operations\/[^/]+$/.test(name)) {
    throw new Error(`Invalid Cloud Run operation name: ${name || '<empty>'}`);
  }
  return `https://run.googleapis.com/v2/${name}`;
}

async function authenticatedClient() {
  const auth = new GoogleAuth({ scopes: [RUN_SCOPE] });
  return auth.getClient();
}

async function executeRenderJob({ jobSpecAssetKey }) {
  const settings = config();
  if (!configured()) {
    throw new Error('Set GOOGLE_CLOUD_PROJECT, CLOUD_RUN_LOCATION, and CLOUD_RUN_RENDER_JOB before dispatching renders.');
  }
  if (!jobSpecAssetKey) throw new Error('A render job spec asset key is required.');

  const client = await authenticatedClient();
  const jobName = `projects/${settings.projectId}/locations/${settings.location}/jobs/${settings.renderJob}`;
  const response = await client.request({
    url: `https://run.googleapis.com/v2/${jobName}:run`,
    method: 'POST',
    data: {
      overrides: {
        taskCount: 1,
        timeout: `${settings.timeoutSeconds}s`,
        containerOverrides: [{
          env: [
            { name: 'RENDER_JOB_SPEC_KEY', value: jobSpecAssetKey },
            { name: 'RENDER_SOURCE_ACCESS_MODE', value: process.env.RENDER_SOURCE_ACCESS_MODE || 'signed_url' },
          ],
        }],
      },
    },
  });
  if (!response.data?.name) throw new Error('Cloud Run did not return an operation name.');
  return response.data;
}

async function getOperation(name) {
  const client = await authenticatedClient();
  const response = await client.request({ url: operationUrl(name), method: 'GET' });
  return response.data;
}

async function waitForOperation(name, options = {}) {
  const settings = config();
  const timeoutMilliseconds = Number(options.timeoutMilliseconds || settings.timeoutSeconds * 1000 + 120000);
  const pollMilliseconds = Number(options.pollMilliseconds || settings.pollMilliseconds);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMilliseconds) {
    const operation = await getOperation(name);
    if (operation.done) {
      if (operation.error) {
        const detail = operation.error.message || JSON.stringify(operation.error);
        throw new Error(`Cloud Run render execution failed: ${detail}`);
      }
      return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  }
  throw new Error(`Timed out waiting for Cloud Run operation ${name}.`);
}

module.exports = {
  configured,
  config,
  executeRenderJob,
  getOperation,
  waitForOperation,
  _test: { operationUrl },
};
