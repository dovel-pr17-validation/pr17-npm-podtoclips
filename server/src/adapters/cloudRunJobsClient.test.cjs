const assert = require('node:assert/strict');
const test = require('node:test');
const client = require('./cloudRunJobsClient.cjs');

test('Cloud Run operation URLs accept only regional operation resource names', () => {
  assert.equal(
    client._test.operationUrl('projects/demo/locations/asia-south1/operations/abc-123'),
    'https://run.googleapis.com/v2/projects/demo/locations/asia-south1/operations/abc-123',
  );
  assert.throws(() => client._test.operationUrl('https://example.com/not-an-operation'), /Invalid Cloud Run operation/);
});

test('Cloud Run render configuration requires project, location, and job', () => {
  const previous = {
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.CLOUD_RUN_LOCATION,
    job: process.env.CLOUD_RUN_RENDER_JOB,
  };
  try {
    process.env.GOOGLE_CLOUD_PROJECT = 'demo';
    process.env.CLOUD_RUN_LOCATION = 'asia-south1';
    process.env.CLOUD_RUN_RENDER_JOB = 'render';
    assert.equal(client.configured(), true);
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.CLOUD_RUN_PROJECT_ID;
    assert.equal(client.configured(), false);
  } finally {
    if (previous.project === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previous.project;
    if (previous.location === undefined) delete process.env.CLOUD_RUN_LOCATION;
    else process.env.CLOUD_RUN_LOCATION = previous.location;
    if (previous.job === undefined) delete process.env.CLOUD_RUN_RENDER_JOB;
    else process.env.CLOUD_RUN_RENDER_JOB = previous.job;
  }
});
