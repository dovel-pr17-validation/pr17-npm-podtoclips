const assert = require('node:assert/strict');
const test = require('node:test');
const { createRenderPlan } = require('./localRenderer.cjs');

test('render plans use Remotion pagination when upgrades are enabled', async () => {
  const previousGlobal = process.env.EASYED_UPGRADES_ENABLED;
  const previousCaptions = process.env.REMOTION_CAPTIONS_ENABLED;
  process.env.EASYED_UPGRADES_ENABLED = '1';
  process.env.REMOTION_CAPTIONS_ENABLED = '1';
  const words = ['Responsive', 'captions', 'highlight', 'each', 'spoken', 'word'].map((word, index) => ({
    word,
    start: index * 0.3,
    end: index * 0.3 + 0.25,
    speaker: 'Speaker A',
  }));
  const plan = await createRenderPlan(
    { transcript: { words }, source: { assetKey: 'test' } },
    { id: 'candidate_test', start: 0, end: 12, category: 'insight' },
    { speakerRegions: [{ x: 0.3, y: 0.2, width: 0.2, height: 0.4 }], regions: [], compositionHint: 'speaker_focus' },
    null,
  );
  if (previousGlobal === undefined) delete process.env.EASYED_UPGRADES_ENABLED;
  else process.env.EASYED_UPGRADES_ENABLED = previousGlobal;
  if (previousCaptions === undefined) delete process.env.REMOTION_CAPTIONS_ENABLED;
  else process.env.REMOTION_CAPTIONS_ENABLED = previousCaptions;
  assert.equal(plan.captionTrack.engine, 'remotion_captions');
  assert.equal(plan.captionStyle.wordHighlight, true);
  assert.ok(plan.captionTrack.lines.every((line) => line.words.length <= 6));
});

test('global rollback restores legacy caption plans', async () => {
  const previousGlobal = process.env.EASYED_UPGRADES_ENABLED;
  process.env.EASYED_UPGRADES_ENABLED = '0';
  const plan = await createRenderPlan(
    { transcript: { words: [{ word: 'Legacy', start: 0, end: 0.5, speaker: 'A' }] }, source: { assetKey: 'test' } },
    { id: 'candidate_legacy', start: 0, end: 12, category: 'insight' },
    { speakerRegions: [], regions: [] },
    null,
  );
  if (previousGlobal === undefined) delete process.env.EASYED_UPGRADES_ENABLED;
  else process.env.EASYED_UPGRADES_ENABLED = previousGlobal;
  assert.equal(plan.captionTrack.engine, 'legacy_ass');
});

test('transient podcast graphics do not force the whole clip into safe contain', async () => {
  const sampledFrames = Array.from({ length: 10 }, (_, index) => ({ index, t: index }));
  const plan = await createRenderPlan(
    { transcript: { words: [{ word: 'Insight', start: 0, end: 0.5, speaker: 'A' }] }, source: { assetKey: 'test' } },
    { id: 'candidate_transient_graphic', start: 0, end: 12, category: 'insight' },
    {
      hasScreenRecording: true,
      compositionHint: 'speaker_plus_screen',
      sampledFrames,
      speakerRegions: [{ frameIndex: 0, x: 0.1, y: 0.1, width: 0.25, height: 0.7 }],
      regions: [{ frameIndex: 4, x: 0.65, y: 0.1, width: 0.3, height: 0.7 }],
    },
    null,
  );
  assert.equal(plan.composition.mode, 'speaker_focus_crop');
  assert.equal(plan.composition.detectedRegions.visualRegionFrameRatio, 0.1);
});

test('persistent non-overlapping screen content keeps the split composition', async () => {
  const sampledFrames = Array.from({ length: 10 }, (_, index) => ({ index, t: index }));
  const plan = await createRenderPlan(
    { transcript: { words: [{ word: 'Demo', start: 0, end: 0.5, speaker: 'A' }] }, source: { assetKey: 'test' } },
    { id: 'candidate_persistent_screen', start: 0, end: 12, category: 'show_and_tell' },
    {
      hasScreenRecording: true,
      compositionHint: 'speaker_plus_screen',
      sampledFrames,
      speakerRegions: [{ frameIndex: 0, x: 0.02, y: 0.2, width: 0.18, height: 0.45 }],
      regions: [0, 2, 4, 6, 8].map((frameIndex) => ({ frameIndex, x: 0.45, y: 0.05, width: 0.5, height: 0.85 })),
    },
    null,
  );
  assert.equal(plan.composition.mode, 'speaker_plus_screen');
  assert.equal(plan.composition.detectedRegions.visualRegionFrameRatio, 0.5);
});
