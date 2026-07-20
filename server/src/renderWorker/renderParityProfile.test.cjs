const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runtimeVersions, renderEnvironment, cloudRunEnvCsv } = require('./renderParityProfile.cjs');

test('production runtime versions are pinned to the proven local renderer', () => {
  assert.deepEqual(runtimeVersions, {
    node: '20.20.2',
    npm: '11.18.0',
    python: '3.14.5',
    ffmpeg: '8.1.2',
    x264: '0.165.3222',
    x264Revision: 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55',
    freetype: '2.14.3',
    fontconfig: '2.18.1',
    fribidi: '1.0.16',
    harfbuzz: '14.2.1',
    libass: '0.17.5',
    dav1d: '1.5.3',
    mediapipe: '0.10.35',
    opencv: '5.0.0.93',
    numpy: '2.5.1',
  });
});

test('production render behavior mirrors the effective local settings', () => {
  assert.equal(renderEnvironment.DENSE_FACE_TRACKING_MIN_CONFIDENCE, '0.25');
  assert.equal(renderEnvironment.SOURCE_VISUAL_FIT_V2_ENABLED, '1');
  assert.equal(renderEnvironment.FFMPEG_PRESET, 'medium');
  assert.equal(renderEnvironment.FFMPEG_CRF, '18');
  assert.equal(renderEnvironment.FFMPEG_AUDIO_BITRATE, '160k');
  assert.equal(renderEnvironment.REMOTION_CAPTION_FIXED_FONT_SIZE, '74');
  assert.equal(renderEnvironment.REMOTION_CAPTION_CENTER_Y, '1520');
  assert.equal(renderEnvironment.REMOTION_CAPTION_BURNED_IN_CENTER_Y, '1310');
  assert.equal(renderEnvironment.RENDER_QC_ENABLED, '0');
  assert.equal(renderEnvironment.RENDER_QC_SAFE_CONTAIN_FALLBACK, '0');
  assert.equal(renderEnvironment.RENDER_QC_STACKED_SPEAKER_FALLBACK, '0');
  assert.match(cloudRunEnvCsv(), /DENSE_FACE_TRACKING_MIN_CONFIDENCE=0\.25/);
});

test('worker image declares and verifies every pinned top-level runtime', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'render-worker.Dockerfile'), 'utf8');
  assert.match(dockerfile, /ARG NODE_VERSION=20\.20\.2/);
  assert.match(dockerfile, /ARG NPM_VERSION=11\.18\.0/);
  assert.match(dockerfile, /ARG PYTHON_VERSION=3\.14\.5/);
  assert.match(dockerfile, /ARG FFMPEG_VERSION=8\.1\.2/);
  assert.match(dockerfile, /b35605ace3ddf7c1a5d67a2eb553f034aef41d55/);
  assert.match(dockerfile, /ARG FREETYPE_VERSION=2\.14\.3/);
  assert.match(dockerfile, /ARG FONTCONFIG_VERSION=2\.18\.1/);
  assert.match(dockerfile, /ARG FRIBIDI_VERSION=1\.0\.16/);
  assert.match(dockerfile, /ARG HARFBUZZ_VERSION=14\.2\.1/);
  assert.match(dockerfile, /ARG LIBASS_VERSION=0\.17\.5/);
  assert.match(dockerfile, /ARG DAV1D_VERSION=1\.5\.3/);
  assert.match(dockerfile, /--enable-libdav1d/);
  assert.match(dockerfile, /verify-render-runtime\.py/);
  assert.match(dockerfile, /CMD \["node", "server\/src\/renderWorker\/runRenderJob\.cjs"\]/);
});
