const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRenderJobPayload } = require('./cloudRunRenderer.cjs');

test('render payload preserves exact context boundaries and adds an independent result object', () => {
  const payload = buildRenderJobPayload(
    {
      id: 'episode_1', title: 'Full podcast',
      source: { assetKey: 'episodes/episode_1/source.mp4', mimeType: 'video/mp4' },
    },
    {
      id: 'candidate_1', title: 'Complete insight', category: 'insight',
      narrativeType: 'talking_head', transcript: 'A complete thought.',
      boundaryRefinement: { contextComplete: true },
    },
    {
      start: 152.45, end: 185.66, duration: 33.21,
      aspectRatio: '9:16', captionTrack: { engine: 'remotion_captions' },
      composition: { mode: 'speaker_focus_crop' },
    },
  );

  assert.equal(payload.clip.start, 152.45);
  assert.equal(payload.clip.end, 185.66);
  assert.equal(payload.clip.boundaryRefinement.contextComplete, true);
  assert.equal(payload.episode.source.assetKey, 'episodes/episode_1/source.mp4');
  assert.equal(payload.result.assetKey, 'render_results/episode_1/candidate_1.json');
});
