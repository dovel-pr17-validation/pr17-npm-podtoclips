const assert = require('node:assert/strict');
const test = require('node:test');
const { cacheKeyForVideoUrl, cacheKeyForImport } = require('./videoCacheKey.cjs');

test('YouTube URL variants share one provider cache key', () => {
  const variants = [
    'https://www.youtube.com/watch?v=cpg78ouK54I&t=2s',
    'https://youtu.be/cpg78ouK54I?si=tracking',
    'https://m.youtube.com/watch?v=cpg78ouK54I&utm_source=test',
    'https://www.youtube.com/shorts/cpg78ouK54I',
    'https://www.youtube-nocookie.com/embed/cpg78ouK54I',
  ];
  assert.deepEqual(variants.map(cacheKeyForVideoUrl), variants.map(() => 'youtube:cpg78ouK54I'));
});

test('non-YouTube cache keys remove tracking and sort parameters', () => {
  assert.equal(
    cacheKeyForVideoUrl('https://example.com/video?utm_source=x&b=2&a=1#chapter'),
    'url:https://example.com/video?a=1&b=2',
  );
});

test('stored import cache key wins over URL derivation', () => {
  assert.equal(cacheKeyForImport({
    cacheKey: 'provider:stable-id',
    sourceUrl: 'https://example.com/different',
  }), 'provider:stable-id');
});
