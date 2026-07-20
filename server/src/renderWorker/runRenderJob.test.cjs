const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildVideoFilter, writeAss, _test } = require('./runRenderJob.cjs');

function jobWithTracks(tracks, assignments = []) {
  return {
    clip: { start: 0, end: 30, duration: 30 },
    renderPlan: {
      composition: {
        mode: 'speaker_focus_crop',
        denseFaceTracking: {
          sourceWidth: 1920,
          sourceHeight: 1080,
          sampleCount: 20,
          tracks,
          speakerTrackAssignments: assignments,
        },
      },
    },
  };
}

test('stacked fallback rejects two fragmented tracks of the same face', () => {
  const tracks = [
    { id: 1, points: 24, faceX: 0.512, faceY: 0.29, detectorConfidence: 0.92, coVisibleWith: [] },
    { id: 2, points: 22, faceX: 0.514, faceY: 0.30, detectorConfidence: 0.91, coVisibleWith: [] },
  ];
  assert.deepEqual(_test.stackedSpeakerRegions(jobWithTracks(tracks)), []);
});

test('stacked fallback rejects a two-shot that exists for only a small part of an edited clip', () => {
  const job = jobWithTracks([
    { id: 1, points: 8, faceX: 0.25, faceY: 0.34, detectorConfidence: 0.92, coVisibleWith: [{ trackId: 2, samples: 8 }] },
    { id: 2, points: 8, faceX: 0.76, faceY: 0.33, detectorConfidence: 0.92, coVisibleWith: [{ trackId: 1, samples: 8 }] },
  ]);
  job.renderPlan.composition.denseFaceTracking.sampleCount = 40;
  assert.deepEqual(_test.stackedSpeakerRegions(job), []);
});

test('stacked fallback chooses a co-visible distinct pair over same-person fragments', () => {
  const tracks = [
    { id: 1, points: 24, faceX: 0.512, faceY: 0.29, faceWidth: 0.12, faceHeight: 0.28, detectorConfidence: 0.92, coVisibleWith: [] },
    { id: 2, points: 22, faceX: 0.514, faceY: 0.30, faceWidth: 0.12, faceHeight: 0.28, detectorConfidence: 0.91, coVisibleWith: [] },
    { id: 3, points: 16, faceX: 0.27, faceY: 0.34, faceWidth: 0.11, faceHeight: 0.25, detectorConfidence: 0.91, coVisibleWith: [{ trackId: 4, samples: 16 }] },
    { id: 4, points: 16, faceX: 0.76, faceY: 0.33, faceWidth: 0.11, faceHeight: 0.25, detectorConfidence: 0.91, coVisibleWith: [{ trackId: 3, samples: 16 }] },
  ];
  const anchors = _test.groupedSpeakerAnchors(jobWithTracks(tracks));
  assert.deepEqual(anchors.map((anchor) => anchor.trackId), [3, 4]);
  const regions = _test.stackedSpeakerRegions(jobWithTracks(tracks));
  assert.equal(regions.length, 2);
  assert.ok(regions[0].x + regions[0].width <= regions[1].x + 0.051);
});

test('diarized speaker order controls top and bottom panel order when mapping is valid', () => {
  const tracks = [
    { id: 1, points: 20, faceX: 0.76, faceY: 0.33, faceWidth: 0.11, faceHeight: 0.25, detectorConfidence: 0.91, coVisibleWith: [{ trackId: 2, samples: 18 }] },
    { id: 2, points: 20, faceX: 0.27, faceY: 0.34, faceWidth: 0.11, faceHeight: 0.25, detectorConfidence: 0.91, coVisibleWith: [{ trackId: 1, samples: 18 }] },
  ];
  const assignments = [
    { speaker: 'Speaker A', trackId: 1 },
    { speaker: 'Speaker B', trackId: 2 },
  ];
  const anchors = _test.groupedSpeakerAnchors(jobWithTracks(tracks, assignments));
  assert.deepEqual(anchors.map((anchor) => anchor.speaker), ['Speaker A', 'Speaker B']);
  assert.deepEqual(anchors.map((anchor) => anchor.trackId), [1, 2]);
});

test('speaker-focus filter fits unsafe source visuals inside the 9:16 canvas', () => {
  const job = jobWithTracks([]);
  job.renderPlan.captionTrack = { lines: [] };
  job.renderPlan.composition.speakerTrack = [{ t: 0, x: 0.5, y: 0.4, width: 0.4, height: 0.8 }];
  job.renderPlan.composition.sourceVisualFit = {
    intervals: [{ start: 2, end: 5 }],
  };
  const filter = buildVideoFilter(job, '/tmp/captions.ass');
  assert.doesNotMatch(filter, /\[1:v\]/);
  assert.match(filter, /between\(t,2\.00,5\.00\)/);
  assert.match(filter, /fittedVisual/);
  assert.match(filter, /scale=996:1760:force_original_aspect_ratio=decrease/);
  assert.doesNotMatch(filter, /drawbox=x=40/);
});

test('dense tracking timeline stays in the local work directory for signed sources', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easyed-dense-path-test-'));
  const timelinePath = _test.denseTrackingTimelinePath(workDir);
  try {
    await fs.writeFile(timelinePath, '[]', 'utf8');
    assert.equal(await fs.readFile(timelinePath, 'utf8'), '[]');
    assert.doesNotMatch(timelinePath, /https?:/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('signed sources use a local H.264 face-tracking proxy', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'easyed-dense-proxy-test-'));
  try {
    const proxyPath = _test.denseTrackingProxyPath(workDir);
    assert.equal(path.dirname(proxyPath), workDir);
    assert.match(proxyPath, /face-tracking-proxy\.mp4$/);
    assert.equal(_test.shouldCreateDenseTrackingProxy('https://storage.example/source.mp4?signature=abc'), true);
    assert.equal(_test.shouldCreateDenseTrackingProxy('/tmp/source.mp4'), false);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('editorial visual fit is attached before dense face tracking runs', () => {
  const previous = process.env.SOURCE_VISUAL_FIT_V2_ENABLED;
  process.env.SOURCE_VISUAL_FIT_V2_ENABLED = '1';
  const job = jobWithTracks([]);
  job.clip = { start: 10, end: 20, duration: 10 };
  job.renderPlan.visualVerification = {
    sampledFrames: [{ index: 0, t: 12, sceneBoundary: true, sceneEndT: 15 }],
    editorialFrames: [{ frameIndex: 0, type: 'large_text_overlay', fitFullFrame: true }],
  };
  const upgraded = _test.applyEditorialVisualFit(job);
  assert.equal(upgraded.renderPlan.composition.sourceVisualFit.version, 'graphic_safe_v2');
  assert.deepEqual(upgraded.renderPlan.composition.sourceVisualFit.intervals, [{
    start: 2, end: 5, reasons: ['fit_editorial_overlay_or_animation'],
  }]);
  if (previous === undefined) delete process.env.SOURCE_VISUAL_FIT_V2_ENABLED;
  else process.env.SOURCE_VISUAL_FIT_V2_ENABLED = previous;
});

test('runtime editorial visual fitting is disabled unless explicitly enabled', () => {
  const previous = process.env.SOURCE_VISUAL_FIT_V2_ENABLED;
  process.env.SOURCE_VISUAL_FIT_V2_ENABLED = '0';
  const job = jobWithTracks([]);
  job.renderPlan.visualVerification = {
    sampledFrames: [{ index: 0, t: 2, sceneBoundary: true, sceneEndT: 5 }],
    editorialFrames: [{ frameIndex: 0, type: 'large_text_overlay', fitFullFrame: true }],
  };
  assert.equal(_test.applyEditorialVisualFit(job), job);
  if (previous === undefined) delete process.env.SOURCE_VISUAL_FIT_V2_ENABLED;
  else process.env.SOURCE_VISUAL_FIT_V2_ENABLED = previous;
});

test('editorial fit uses exact scene boundaries instead of sample midpoints', () => {
  const job = jobWithTracks([]);
  job.clip = { start: 100, end: 110, duration: 10 };
  job.renderPlan.visualVerification = {
    sampledFrames: [
      { index: 0, t: 100, sceneBoundary: true, sceneEndT: 103 },
      { index: 1, t: 108, sceneBoundary: true, sceneEndT: 110 },
    ],
    editorialFrames: [{ frameIndex: 0, type: 'editorial_animation', fitFullFrame: true }],
  };
  assert.deepEqual(_test.editorialFitIntervals(job), [
    { start: 0, end: 3, reason: 'fit_editorial_overlay_or_animation' },
  ]);
});

test('periodic source-text frames receive a safe midpoint fit interval', () => {
  const job = jobWithTracks([]);
  job.clip = { start: 100, end: 108, duration: 8 };
  job.renderPlan.visualVerification = {
    sampledFrames: [
      { index: 0, t: 100, sceneBoundary: false },
      { index: 1, t: 102.5, sceneBoundary: false },
      { index: 2, t: 105, sceneBoundary: false },
    ],
    editorialFrames: [{ frameIndex: 1, type: 'large_text_overlay', fitFullFrame: true }],
  };
  assert.deepEqual(_test.editorialFitIntervals(job), [
    { start: 1.25, end: 3.75, reason: 'fit_editorial_overlay_or_animation' },
  ]);
});

test('enhanced captions keep one fixed center and font size', async () => {
  const target = path.join(os.tmpdir(), `easyed-caption-${Date.now()}.ass`);
  const job = jobWithTracks([]);
  job.renderPlan.captionTrack = {
    engine: 'remotion_captions',
    lines: [{
      text: 'Stable caption position', start: 0, end: 1,
      fontSize: 74, breakBeforeIndex: 2,
      words: [
        { word: 'Stable', start: 0, end: 0.3 },
        { word: 'caption', start: 0.3, end: 0.6 },
        { word: 'position', start: 0.6, end: 1 },
      ],
    }],
  };
  await writeAss(job, target);
  const ass = await fs.readFile(target, 'utf8');
  await fs.rm(target, { force: true });
  assert.match(ass, /Style: Default,Inter,74,.*?,4,2,2,80,80,200,1/);
  assert.match(ass, /\\an5\\pos\(540,1520\)\\fs74/);
  assert.match(ass, /STABLE/);
  assert.match(ass, /CAPTION/);
  assert.doesNotMatch(ass, /Stable caption position/);
});

test('Devanagari captions select the installed Noto script font', async () => {
  const target = path.join(os.tmpdir(), `easyed-caption-hi-${Date.now()}.ass`);
  const job = jobWithTracks([]);
  job.renderPlan.captionTrack = {
    engine: 'remotion_captions',
    lines: [{
      text: 'यह एक परीक्षण है', start: 0, end: 1,
      fontSize: 74, breakBeforeIndex: 2,
      words: [
        { word: 'यह', start: 0, end: 0.3 },
        { word: 'एक', start: 0.3, end: 0.6 },
        { word: 'परीक्षण', start: 0.6, end: 1 },
      ],
    }],
  };
  await writeAss(job, target);
  const ass = await fs.readFile(target, 'utf8');
  await fs.rm(target, { force: true });
  assert.match(ass, /Style: Default,Noto Sans Devanagari,74/);
  assert.match(ass, /यह/);
});

test('caption filter explicitly exposes the configured font directory to libass', () => {
  const previous = process.env.CAPTION_FONTS_DIR;
  process.env.CAPTION_FONTS_DIR = os.tmpdir();
  const job = jobWithTracks([]);
  job.renderPlan.captionTrack = {
    lines: [{ text: 'यह एक परीक्षण है', start: 0, end: 1 }],
  };
  const filter = buildVideoFilter(job, '/tmp/captions.ass');
  assert.ok(filter.includes(`subtitles=filename='/tmp/captions.ass':fontsdir='${os.tmpdir()}'`));
  if (previous === undefined) delete process.env.CAPTION_FONTS_DIR;
  else process.env.CAPTION_FONTS_DIR = previous;
});
