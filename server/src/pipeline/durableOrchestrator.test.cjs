const assert = require('node:assert/strict');
const test = require('node:test');
const durable = require('./durableOrchestrator.cjs');

test('production cloud mode never silently falls back to local rendering', () => {
  const previous = {
    provider: process.env.RENDER_PROVIDER,
    local: process.env.AUTO_RENDER_LOCAL,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    projectAlias: process.env.CLOUD_RUN_PROJECT_ID,
  };
  try {
    process.env.RENDER_PROVIDER = 'cloud_run';
    process.env.AUTO_RENDER_LOCAL = '0';
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.CLOUD_RUN_PROJECT_ID;
    assert.equal(durable.localRenderingEnabled(), false);
    assert.throws(() => durable._test.assertRenderModeConfigured(), /Cloud rendering is selected/);

    process.env.AUTO_RENDER_LOCAL = '1';
    assert.equal(durable.localRenderingEnabled(), true);
    assert.doesNotThrow(() => durable._test.assertRenderModeConfigured());
  } finally {
    for (const [key, value] of Object.entries({
      RENDER_PROVIDER: previous.provider,
      AUTO_RENDER_LOCAL: previous.local,
      GOOGLE_CLOUD_PROJECT: previous.project,
      CLOUD_RUN_PROJECT_ID: previous.projectAlias,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('finds the episode bound to a cancelled Inngest run', () => {
  const episodes = [
    { id: 'episode_a', source: { orchestration: { runId: 'run_a' } } },
    { id: 'episode_b', source: { orchestration: { runId: 'run_b' } } },
  ];
  assert.equal(durable._test.episodeForInngestRun(episodes, 'run_b').id, 'episode_b');
  assert.equal(durable._test.episodeForInngestRun(episodes, 'missing'), null);
});

test('marks the active pipeline stage failed when a run is cancelled', () => {
  const stages = [
    { name: 'ingest', status: 'completed', completedAt: 'before' },
    { name: 'transcribe', status: 'running', startedAt: 'before', completedAt: null },
    { name: 'score_transcript', status: 'pending', startedAt: null, completedAt: null },
  ];
  const next = durable._test.terminalStages(stages, 'Cancelled.', 'now');
  assert.equal(next[0].status, 'completed');
  assert.equal(next[1].status, 'failed');
  assert.equal(next[1].message, 'Cancelled.');
  assert.equal(next[1].completedAt, 'now');
  assert.equal(next[2].status, 'pending');
});

test('durable billing uses the episode owner and fails closed when it is missing', () => {
  assert.deepEqual(durable._test.billingContextForEpisode({
    source: {
      billing: { accountId: 'user_owner' },
      orchestration: { runId: 'run_owner' },
    },
  }), { userId: 'user_owner', generationId: 'run_owner' });

  assert.throws(
    () => durable._test.billingContextForEpisode({ source: { orchestration: { runId: 'run_missing' } } }),
    /missing its authenticated billing account/i,
  );
});
