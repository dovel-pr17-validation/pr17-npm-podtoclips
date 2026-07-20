const assert = require('node:assert/strict');
const test = require('node:test');

process.env.ASSET_ACCESS_TOKEN_SECRET = 'test-only-asset-secret-with-enough-entropy';
const { createLocalAssetToken, normalizeAssetKey, verifyLocalAssetToken } = require('./assetAccess.cjs');

test('local asset tokens are scoped to one key and expire', () => {
  const now = Date.parse('2026-07-19T12:00:00.000Z');
  const token = createLocalAssetToken({ assetKey: 'renders/owned.mp4', nowMs: now });
  assert.equal(verifyLocalAssetToken(token, 'renders/owned.mp4', now + 1_000).key, 'renders/owned.mp4');
  assert.equal(verifyLocalAssetToken(token, 'renders/other.mp4', now + 1_000), null);
  assert.equal(verifyLocalAssetToken(token, 'renders/owned.mp4', now + 301_000), null);
});

test('local asset tokens reject tampering and unsafe keys', () => {
  const token = createLocalAssetToken({ assetKey: 'editor_uploads/music.mp3' });
  assert.equal(verifyLocalAssetToken(`${token}x`, 'editor_uploads/music.mp3'), null);
  assert.throws(() => normalizeAssetKey('../secret'), /invalid asset key/i);
  assert.throws(() => normalizeAssetKey('/absolute/path'), /invalid asset key/i);
});
