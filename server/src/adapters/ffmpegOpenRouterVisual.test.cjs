const assert = require('node:assert/strict');
const test = require('node:test');
const { _test } = require('./ffmpegOpenRouterVisual.cjs');

test('visual classification drops hallucinated frame indexes and duplicate flags', () => {
  const sanitized = _test.sanitizeFrameClassification({
    regions: [
      { frameIndex: 1, label: 'chart' },
      { frameIndex: 8, label: 'invalid' },
    ],
    speakerRegions: [
      { frameIndex: 0, label: 'guest' },
      { frameIndex: -1, label: 'invalid' },
    ],
    editorialFrames: [
      { frameIndex: 2, type: 'large_text_overlay', fitFullFrame: true },
      { frameIndex: 2, type: 'large_text_overlay', fitFullFrame: true },
      { frameIndex: 3, type: 'broll', fitFullFrame: true },
      { frameIndex: 4, type: 'title_card', fitFullFrame: true },
    ],
  }, 4);

  assert.deepEqual(sanitized.regions.map((item) => item.frameIndex), [1]);
  assert.deepEqual(sanitized.speakerRegions.map((item) => item.frameIndex), [0]);
  assert.deepEqual(sanitized.editorialFrames.map((item) => item.frameIndex), [2, 3]);
});

test('batched visual classifications merge full-frame flags using global indexes', () => {
  const merged = _test.mergeFrameClassifications([
    {
      hasScreenRecording: false,
      confidence: 0.9,
      summary: 'Speaker frames.',
      primarySubject: 'speaker',
      compositionHint: 'speaker_focus',
      regions: [],
      speakerRegions: [{ frameIndex: 1, label: 'guest' }],
      editorialFrames: [],
      hasBurnedInCaptions: false,
      sourceCaptionBand: { y: 0.84, height: 0.14 },
    },
    {
      hasScreenRecording: true,
      confidence: 0.86,
      summary: 'Large graphic frames.',
      primarySubject: 'speaker_and_screen',
      compositionHint: 'speaker_plus_screen',
      regions: [{ frameIndex: 15, label: 'chart' }],
      speakerRegions: [],
      editorialFrames: [{ frameIndex: 18, type: 'large_text_overlay', fitFullFrame: true }],
      hasBurnedInCaptions: true,
      sourceCaptionBand: { y: 0.82, height: 0.12 },
    },
  ], 24);

  assert.equal(merged.hasScreenRecording, true);
  assert.equal(merged.compositionHint, 'speaker_plus_screen');
  assert.equal(merged.primarySubject, 'speaker_and_screen');
  assert.deepEqual(merged.editorialFrames.map((item) => item.frameIndex), [18]);
  assert.deepEqual(merged.sourceCaptionBand, { y: 0.82, height: 0.12 });
});
