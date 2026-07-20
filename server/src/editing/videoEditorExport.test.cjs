const assert = require('node:assert/strict');
const test = require('node:test');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { normalizeProject, _test } = require('./videoEditorExport.cjs');

const execFileAsync = promisify(execFile);

test('editor export graph uses real video and audio crossfades only at fade boundaries', () => {
  const project = normalizeProject({
    segments: [
      { assetKey: 'one.mp4', start: 0, end: 2 },
      { assetKey: 'two.mp4', start: 0, end: 3 },
      { assetKey: 'three.mp4', start: 0, end: 4 },
    ],
    transitions: ['fade', 'none'],
  });
  const graph = _test.buildFilterGraph(project, false);
  assert.match(graph.filterComplex, /xfade=transition=fade:duration=0\.350:offset=1\.650/);
  assert.match(graph.filterComplex, /acrossfade=d=0\.350/);
  assert.match(graph.filterComplex, /concat=n=2:v=1:a=1/);
  assert.equal(Number(graph.outputDuration.toFixed(2)), 8.65);
});

test('FFmpeg accepts the generated crossfade graph and produces the shortened result', async () => {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'easyed-editor-transition-test-'));
  const first = path.join(workDir, 'first.mp4');
  const second = path.join(workDir, 'second.mp4');
  const output = path.join(workDir, 'output.mp4');
  try {
    for (const [target, color, frequency] of [[first, 'red', '440'], [second, 'blue', '660']]) {
      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `color=c=${color}:s=320x568:r=30`,
        '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000`,
        '-t', '0.8', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', target,
      ]);
    }
    const project = normalizeProject({
      segments: [
        { assetKey: 'first.mp4', start: 0, end: 0.8 },
        { assetKey: 'second.mp4', start: 0, end: 0.8 },
      ],
      transitions: ['fade'],
    });
    const graph = _test.buildFilterGraph(project, false);
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', first, '-i', second,
      '-filter_complex', graph.filterComplex,
      '-map', graph.videoMap, '-map', graph.audioMap,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', output,
    ]);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output,
    ]);
    assert.ok(Number(stdout.trim()) > 1.15 && Number(stdout.trim()) < 1.35);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
});
