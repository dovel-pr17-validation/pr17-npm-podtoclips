const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyedits-ownership-'));
process.env.EASYED_LOCAL_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;

const store = require('./episodeStore.cjs');
const routeOwnership = require('../routes/podcasts.cjs')._test;
delete process.env.DATABASE_URL;

function episode(id, ownerUserId, assetKey) {
  return store.createEpisode({
    id,
    ownerUserId,
    title: id,
    description: '',
    source: { assetKey, billing: { accountId: ownerUserId } },
  });
}

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('episode and clip reads are isolated by immutable owner', () => {
  episode('episode-a', 'user-a', 'episodes/a/source.mp4');
  episode('episode-b', 'user-b', 'episodes/b/source.mp4');
  store.replaceEpisodeClips('episode-a', [{ id: 'clip-a', episodeId: 'episode-a', render: { outputAssetKey: 'renders/a.mp4' } }]);
  store.replaceEpisodeClips('episode-b', [{ id: 'clip-b', episodeId: 'episode-b', render: { outputAssetKey: 'renders/b.mp4' } }]);

  assert.deepEqual(store.listEpisodesForOwner('user-a').map((item) => item.id), ['episode-a']);
  assert.equal(store.getEpisodeForOwner('episode-b', 'user-a'), null);
  assert.equal(store.getClipForOwner('clip-b', 'user-a'), null);
  assert.deepEqual(store.listClipsForEpisodeForOwner('episode-b', 'user-a'), []);
  assert.equal(store.getClipForOwner('clip-a', 'user-a').id, 'clip-a');
});

test('source, render, upload, and export assets remain private to their owner', () => {
  store.recordUserAsset({ assetKey: 'editor/user-a/music.mp3', userId: 'user-a', kind: 'editor_upload' });
  store.recordUserAsset({ assetKey: 'editor/user-a/export.mp4', userId: 'user-a', kind: 'editor_export' });

  for (const key of ['episodes/a/source.mp4', 'renders/a.mp4', 'editor/user-a/music.mp3', 'editor/user-a/export.mp4']) {
    assert.equal(store.assetBelongsToOwner(key, 'user-a'), true, key);
    assert.equal(store.assetBelongsToOwner(key, 'user-b'), false, key);
  }
  assert.throws(
    () => store.recordUserAsset({ assetKey: 'editor/user-a/music.mp3', userId: 'user-b', kind: 'editor_upload' }),
    /cannot be reassigned/i,
  );
});

test('new episodes fail closed without ownership', () => {
  assert.throws(() => store.createEpisode({ id: 'ownerless', title: 'Ownerless', source: {} }), /ownership is required/i);
});

test('request ownership helpers return not-found semantics across accounts and redact internal identity', async () => {
  assert.equal(await routeOwnership.ownedEpisodeForRequest({ authUserId: 'user-a' }, 'episode-b'), null);
  assert.equal(await routeOwnership.ownedClipForRequest({ authUserId: 'user-a' }, 'clip-b'), null);
  const visible = routeOwnership.publicEpisode(await routeOwnership.ownedEpisodeForRequest({ authUserId: 'user-a' }, 'episode-a'));
  assert.equal(visible.id, 'episode-a');
  assert.equal('ownerUserId' in visible, false);
  assert.equal('billing' in visible.source, false);
});
