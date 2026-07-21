const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { createId } = require('../utils/ids.cjs');
const { getObjectStorage } = require('../objectStorage/index.cjs');

const execFileAsync = promisify(execFile);
const MAX_SEGMENTS = 12;
const MAX_DURATION_SECONDS = 300;
const FADE_DURATION_SECONDS = 0.35;

function numberInRange(value, min, max, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return parsed;
}

async function assetInput(assetKey) {
  if (typeof assetKey !== 'string' || !assetKey || assetKey.includes('..')) {
    throw new Error('Invalid editor asset.');
  }
  const storage = getObjectStorage();
  if (storage.resolveKey) {
    const localPath = storage.resolveKey(encodeURIComponent(assetKey));
    if (!localPath) throw new Error('An editor asset is no longer available.');
    return localPath;
  }
  if (storage.getSignedReadUrl) return storage.getSignedReadUrl(assetKey);
  throw new Error('The active object storage cannot provide an editor asset.');
}

function normalizeProject(project) {
  const segments = Array.isArray(project?.segments) ? project.segments : [];
  if (!segments.length) throw new Error('Add at least one video segment before exporting.');
  if (segments.length > MAX_SEGMENTS) throw new Error(`Use ${MAX_SEGMENTS} clips or fewer in one export.`);

  let totalDuration = 0;
  const normalizedSegments = segments.map((segment, index) => {
    const start = numberInRange(segment.start, 0, 60 * 60 * 8, `Segment ${index + 1} start`);
    const end = numberInRange(segment.end, start + 0.1, 60 * 60 * 8, `Segment ${index + 1} end`);
    totalDuration += end - start;
    return { assetKey: String(segment.assetKey || ''), start, end };
  });
  if (totalDuration > MAX_DURATION_SECONDS) {
    throw new Error(`Editor exports are limited to ${MAX_DURATION_SECONDS} seconds.`);
  }

  const music = project?.music?.assetKey ? {
    assetKey: String(project.music.assetKey),
    volume: numberInRange(project.music.volume ?? 0.22, 0, 1, 'Music volume'),
  } : null;
  const transitions = normalizedSegments.slice(0, -1).map((_, index) => (
    project?.transitions?.[index] === 'fade' ? 'fade' : 'none'
  ));
  return {
    segments: normalizedSegments,
    music,
    totalDuration,
    programVolume: numberInRange(project?.programVolume ?? 1, 0, 1, 'Video volume'),
    transitions,
  };
}

function segmentDuration(segment) {
  return segment.end - segment.start;
}

function fadeDurationAt(project, boundaryIndex) {
  if (project.transitions[boundaryIndex] !== 'fade') return 0;
  return Math.min(
    FADE_DURATION_SECONDS,
    segmentDuration(project.segments[boundaryIndex]) / 2,
    segmentDuration(project.segments[boundaryIndex + 1]) / 2,
  );
}

function buildFilterGraph(project, hasMusic) {
  const chains = project.segments.flatMap((segment, index) => {
    const duration = segmentDuration(segment);
    const incomingFadeDuration = fadeDurationAt(project, index - 1);
    const outgoingFadeDuration = fadeDurationAt(project, index);
    const videoFilters = [
      'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black',
      'setsar=1',
      'fps=30',
      'settb=AVTB',
      'format=yuv420p',
      'setpts=PTS-STARTPTS',
    ];
    const audioFilters = [
      'aresample=48000',
      `volume=${project.programVolume.toFixed(2)}`,
      'asetpts=PTS-STARTPTS',
    ];
    if (incomingFadeDuration > 0) {
      videoFilters.push(`fade=t=in:st=0:d=${incomingFadeDuration.toFixed(3)}:color=black`);
      audioFilters.push(`afade=t=in:st=0:d=${incomingFadeDuration.toFixed(3)}`);
    }
    if (outgoingFadeDuration > 0) {
      const fadeStart = Math.max(0, duration - outgoingFadeDuration);
      videoFilters.push(`fade=t=out:st=${fadeStart.toFixed(3)}:d=${outgoingFadeDuration.toFixed(3)}:color=black`);
      audioFilters.push(`afade=t=out:st=${fadeStart.toFixed(3)}:d=${outgoingFadeDuration.toFixed(3)}`);
    }
    return [
      `[${index}:v]${videoFilters.join(',')}[v${index}]`,
      `[${index}:a]${audioFilters.join(',')}[a${index}]`,
    ];
  });

  let videoLabel = 'v0';
  let audioLabel = 'a0';
  let outputDuration = segmentDuration(project.segments[0]);
  for (let index = 1; index < project.segments.length; index += 1) {
    const nextVideoLabel = `vx${index}`;
    const nextAudioLabel = `ax${index}`;
    chains.push(
      `[${videoLabel}][${audioLabel}][v${index}][a${index}]concat=n=2:v=1:a=1[${nextVideoLabel}][${nextAudioLabel}]`,
    );
    outputDuration += segmentDuration(project.segments[index]);
    videoLabel = nextVideoLabel;
    audioLabel = nextAudioLabel;
  }

  let audioMap = `[${audioLabel}]`;
  if (hasMusic) {
    const musicIndex = project.segments.length;
    chains.push(
      `[${musicIndex}:a]aresample=48000,volume=${project.music.volume.toFixed(2)},atrim=duration=${outputDuration.toFixed(3)},asetpts=PTS-STARTPTS[music]`,
      `[${audioLabel}][music]amix=inputs=2:duration=first:dropout_transition=2[audio]`,
    );
    audioMap = '[audio]';
  }

  return {
    filterComplex: chains.join(';'),
    videoMap: `[${videoLabel}]`,
    audioMap,
    outputDuration,
  };
}

async function exportVideoProject(project) {
  const normalized = normalizeProject(project);
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'easyed-editor-'));
  const outputPath = path.join(workDir, 'edited-clip.mp4');
  try {
    const inputs = await Promise.all(normalized.segments.map((segment) => assetInput(segment.assetKey)));
    const musicInput = normalized.music ? await assetInput(normalized.music.assetKey) : null;
    const args = ['-hide_banner', '-y'];
    // Input arguments must be interleaved with their seek values.
    const inputArgs = [];
    inputs.forEach((source, index) => inputArgs.push('-ss', String(normalized.segments[index].start), '-t', String(normalized.segments[index].end - normalized.segments[index].start), '-i', source));
    args.push(...inputArgs);
    if (musicInput) args.push('-stream_loop', '-1', '-i', musicInput);

    const graph = buildFilterGraph(normalized, Boolean(musicInput));
    args.push('-filter_complex', graph.filterComplex, '-map', graph.videoMap, '-map', graph.audioMap, '-c:v', 'libx264', '-preset', process.env.EDITOR_FFMPEG_PRESET || 'veryfast', '-crf', process.env.EDITOR_FFMPEG_CRF || '20', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath);
    try {
      await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 4 });
    } catch (error) {
      console.error(`Editor export failed: ${error.message}`);
      throw new Error('Editor export failed. Check that the selected video and audio files are playable, then try again.');
    }

    const outputKey = `editor_exports/${createId('export')}.mp4`;
    const stored = await getObjectStorage().putFile(outputPath, outputKey, 'video/mp4');
    return {
      outputAssetKey: stored.key,
      previewUrl: stored.url,
      downloadUrl: `/api/assets/download/${encodeURIComponent(stored.key)}`,
      duration: Number(graph.outputDuration.toFixed(2)),
    };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

module.exports = { exportVideoProject, normalizeProject, _test: { buildFilterGraph, fadeDurationAt } };
