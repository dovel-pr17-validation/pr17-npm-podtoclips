const assert = require('node:assert/strict');
const test = require('node:test');
const { _test } = require('./functions.cjs');

test('source limit cancellation stops the workflow before downstream processing', () => {
  assert.equal(_test.sourceLimitCanceled({ sourceLimitCanceled: true }), true);
  assert.equal(_test.sourceLimitCanceled({ status: 'canceled' }), true);
  assert.equal(_test.sourceLimitCanceled({ status: 'uploaded' }), false);
  assert.equal(_test.sourceLimitCanceled(null), false);
});

test('URL import workflow does not emit the podcast processing event after a source limit cancellation', async () => {
  const sentEvents = [];
  const step = {
    run: async (_name, operation) => operation(),
    sendEvent: async (_name, event) => sentEvents.push(event),
  };
  const result = await _test.runUrlImportWorkflow({
    event: { data: { episodeId: 'episode_too_long' } },
    step,
    runId: 'run_too_long',
  }, {
    bindRun: async () => undefined,
    processImport: async () => ({
      status: 'canceled',
      sourceLimitCanceled: true,
      error: 'Free workspaces can process podcasts up to 2 hours long.',
    }),
  });

  assert.equal(result.status, 'canceled');
  assert.equal(sentEvents.length, 0);
});

test('successful URL import emits exactly one podcast processing event', async () => {
  const sentEvents = [];
  const step = {
    run: async (_name, operation) => operation(),
    sendEvent: async (_name, event) => sentEvents.push(event),
  };
  const result = await _test.runUrlImportWorkflow({
    event: { data: { episodeId: 'episode_allowed' } },
    step,
    runId: 'run_allowed',
  }, {
    bindRun: async () => undefined,
    processImport: async () => ({ status: 'uploaded' }),
  });

  assert.deepEqual(result, { episodeId: 'episode_allowed' });
  assert.deepEqual(sentEvents, [{
    name: 'podcast.uploaded',
    data: { episodeId: 'episode_allowed' },
  }]);
});
