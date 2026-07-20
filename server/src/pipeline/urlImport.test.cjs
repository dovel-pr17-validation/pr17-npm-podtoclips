const assert = require('node:assert/strict');
const test = require('node:test');
const { _test } = require('./urlImport.cjs');

test('same-key imports execute serially to prevent duplicate downloads', async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = _test.withImportLock('youtube:one', async () => {
    order.push('first-start');
    await firstGate;
    order.push('first-end');
  });
  const second = _test.withImportLock('youtube:one', async () => {
    order.push('second-start');
    order.push('second-end');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('different cache keys do not block one another', async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = _test.withImportLock('youtube:one', async () => {
    order.push('one');
    await firstGate;
  });
  const second = _test.withImportLock('youtube:two', async () => {
    order.push('two');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order.sort(), ['one', 'two']);
  releaseFirst();
  await Promise.all([first, second]);
});

test('completed URL imports preserve the requesting account and discard cached ownership', () => {
  const episode = {
    source: {
      billing: { accountId: 'user_requesting' },
      import: { sourceUrl: 'https://example.com/new' },
    },
  };
  const cachedSource = {
    originalName: 'cached.mp4',
    mimeType: 'video/mp4',
    assetKey: 'episodes/cached/source.mp4',
    assetUrl: 'https://storage.example/cached.mp4',
    size: 100,
    billing: { accountId: 'user_cached_owner', generationId: 'old-generation' },
    orchestration: { runId: 'old-run' },
    directUploadPending: true,
    import: { sourceUrl: 'https://example.com/new', cacheHit: true },
  };

  const source = _test.completedImportSource(episode, cachedSource);
  assert.deepEqual(source.billing, { accountId: 'user_requesting' });
  assert.equal(source.orchestration, undefined);
  assert.equal(source.directUploadPending, undefined);
  assert.equal(source.assetKey, cachedSource.assetKey);
});
