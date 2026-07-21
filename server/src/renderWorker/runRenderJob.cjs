require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const sentry = require('../monitoring/sentry.cjs');
sentry.initSentry('podtoclips-render-worker');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const execFileAsync = promisify(execFile);

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
  return process.env[name];
}

function shouldUseDenseFaceTracking(job) {
  if (process.env.DENSE_FACE_TRACKING !== '1') return false;
  return job.renderPlan.composition?.mode === 'speaker_focus_crop';
}

function faceTrackScriptPath() {
  return path.join(__dirname, 'faceTrack.py');
}

function renderQcScriptPath() {
  return path.join(__dirname, 'renderQc.py');
}

function denseTrackingTimelinePath(workDir) {
  return path.join(workDir || os.tmpdir(), 'active-speaker-timeline.json');
}

function denseTrackingProxyPath(workDir) {
  return path.join(workDir || os.tmpdir(), 'face-tracking-proxy.mp4');
}

function shouldCreateDenseTrackingProxy(sourcePath) {
  return process.env.DENSE_FACE_TRACKING_PROXY === '1' || /^https?:\/\//i.test(String(sourcePath || ''));
}

async function createDenseTrackingProxy(sourcePath, job, workDir) {
  const outputPath = denseTrackingProxyPath(workDir);
  const duration = Math.max(1, Number(job.clip.duration || job.clip.end - job.clip.start));
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(job.clip.start),
    '-t',
    String(duration),
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-an',
    '-vf',
    'scale=1280:-2:force_original_aspect_ratio=decrease',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    String(process.env.DENSE_FACE_TRACKING_PROXY_CRF || 26),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-y',
    outputPath,
  ], {
    timeout: Number(process.env.DENSE_FACE_TRACKING_PROXY_TIMEOUT_MS || 120000),
    maxBuffer: 1024 * 1024 * 4,
  });
  return outputPath;
}

function activeSpeakerTimeline(job) {
  const existing = job.renderPlan.composition?.activeSpeakerTimeline;
  if (Array.isArray(existing) && existing.length) return existing;

  const words = job.renderPlan.captionTrack?.words || [];
  const duration = Math.max(1, Number(job.clip.duration || job.clip.end - job.clip.start));
  const timeline = [];
  for (const word of words) {
    if (!word.speaker) continue;
    const start = Math.max(0, Math.min(duration, Number(word.start || 0)));
    const end = Math.max(start + 0.05, Math.min(duration, Number(word.end || start + 0.05)));
    const last = timeline[timeline.length - 1];
    if (last && last.speaker === word.speaker && start - last.end <= 0.8) {
      last.end = Number(Math.max(last.end, end).toFixed(2));
      continue;
    }
    timeline.push({
      speaker: word.speaker,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
    });
  }
  return timeline;
}

function editorialFitIntervals(job) {
  const visual = job.renderPlan.visualVerification || {};
  const sampledFrames = Array.isArray(visual.sampledFrames) ? visual.sampledFrames : [];
  const flagged = new Set(
    (visual.editorialFrames || [])
      .filter((item) => item.fitFullFrame || ['large_text_overlay', 'editorial_animation', 'title_card', 'broll'].includes(item.type))
      .map((item) => Number(item.frameIndex)),
  );
  if (!flagged.size || !sampledFrames.length) return [];

  const duration = Math.max(1, Number(job.clip.duration || job.clip.end - job.clip.start));
  const clipStart = Number(job.clip.start || 0);
  const points = sampledFrames
    .map((frame, index) => ({
      index: Number(frame.index ?? index),
      t: Math.max(0, Math.min(duration, Number(frame.t) - clipStart)),
      sceneBoundary: Boolean(frame.sceneBoundary),
      sceneEndT: Number.isFinite(Number(frame.sceneEndT))
        ? Math.max(0, Math.min(duration, Number(frame.sceneEndT) - clipStart))
        : null,
    }))
    .filter((frame) => Number.isFinite(frame.t))
    .sort((a, b) => a.t - b.t);

  return points
    .filter((point) => flagged.has(point.index))
    .map((point) => {
      const position = points.indexOf(point);
      const previous = points[position - 1];
      const next = points[position + 1];
      if (point.sceneBoundary) {
        return {
          start: Number(point.t.toFixed(2)),
          end: Number(Math.min(duration, point.sceneEndT ?? (next ? next.t : point.t + 2)).toFixed(2)),
          reason: 'fit_editorial_overlay_or_animation',
        };
      }
      return {
        start: Number(Math.max(0, previous ? (previous.t + point.t) / 2 : point.t - 1.5).toFixed(2)),
        end: Number(Math.min(duration, next ? (point.t + next.t) / 2 : point.t + 1.5).toFixed(2)),
        reason: 'fit_editorial_overlay_or_animation',
      };
    });
}

function visualFitUpgradeEnabled() {
  return process.env.EASYED_UPGRADES_ENABLED !== '0'
    && process.env.SOURCE_VISUAL_FIT_V2_ENABLED === '1';
}

function applyEditorialVisualFit(job) {
  if (!visualFitUpgradeEnabled()) return job;
  const duration = Math.max(1, Number(job.clip.duration || job.clip.end - job.clip.start));
  const existing = job.renderPlan.composition?.sourceVisualFit?.intervals || [];
  const intervals = mergeSuppressionIntervals([...existing, ...editorialFitIntervals(job)], duration);
  if (!intervals.length) return job;
  return {
    ...job,
    renderPlan: {
      ...job.renderPlan,
      composition: {
        ...job.renderPlan.composition,
        sourceVisualFit: {
          mode: 'fit_full_source_on_9_16_canvas',
          version: 'graphic_safe_v2',
          intervals,
        },
      },
    },
  };
}

function mergeSuppressionIntervals(intervals, duration) {
  const ordered = intervals
    .filter((item) => Number(item.end) > Number(item.start))
    .map((item) => ({
      start: Math.max(0, Math.min(duration, Number(item.start))),
      end: Math.max(0, Math.min(duration, Number(item.end))),
      reasons: [item.reason || 'unsafe_source_visual'],
    }))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of ordered) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end + 0.2) {
      last.end = Math.max(last.end, interval.end);
      last.reasons = [...new Set([...last.reasons, ...interval.reasons])];
    } else {
      merged.push(interval);
    }
  }
  return merged.map((item) => ({
    start: Number(item.start.toFixed(2)),
    end: Number(item.end.toFixed(2)),
    reasons: item.reasons,
  }));
}

async function applyDenseFaceTracking(job, sourcePath, workDir) {
  if (!shouldUseDenseFaceTracking(job)) return job;

  const pythonPath = process.env.PYTHON_PATH || 'python3';
  const duration = Math.max(1, Number(job.clip.duration || job.clip.end - job.clip.start));
  const speakerTimeline = activeSpeakerTimeline(job);
  // sourcePath may be an HTTPS signed R2 URL in Cloud Run. Never derive a
  // writable path from it; local renderer work files belong in the per-job
  // temporary directory regardless of how FFmpeg accesses the source.
  const speakerTimelinePath = denseTrackingTimelinePath(workDir);

  try {
    const useProxy = shouldCreateDenseTrackingProxy(sourcePath);
    const trackingSource = useProxy
      ? await createDenseTrackingProxy(sourcePath, job, workDir)
      : sourcePath;
    const trackingStart = useProxy ? 0 : job.clip.start;

    if (speakerTimeline.length) {
      await fsp.writeFile(speakerTimelinePath, JSON.stringify(speakerTimeline), 'utf8');
    }

    const args = [
      faceTrackScriptPath(),
      '--source',
      trackingSource,
      '--start',
      String(trackingStart),
      '--duration',
      String(duration),
      '--fps',
      String(process.env.DENSE_FACE_TRACKING_FPS || 4),
      '--max-points',
      String(process.env.DENSE_FACE_TRACKING_MAX_POINTS || 96),
    ];
    if (speakerTimeline.length) {
      args.push('--speaker-timeline', speakerTimelinePath);
    }

    const { stdout } = await execFileAsync(pythonPath, args, {
      timeout: Number(process.env.DENSE_FACE_TRACKING_TIMEOUT_MS || 120000),
      maxBuffer: 1024 * 1024 * 4,
    });

    const result = JSON.parse(stdout);
    if (!result.speakerTrack?.length || result.confidence < Number(process.env.DENSE_FACE_TRACKING_MIN_CONFIDENCE || 0.35)) {
      return job;
    }

    const existingVisualFitIntervals = visualFitUpgradeEnabled()
      ? (job.renderPlan.composition?.sourceVisualFit?.intervals || [])
      : editorialFitIntervals(job);
    const sourceVisualFitIntervals = mergeSuppressionIntervals([
      ...(result.speakerMissingIntervals || []),
      ...existingVisualFitIntervals,
    ], duration);
    const sourceVisualFit = sourceVisualFitIntervals.length
      ? {
        mode: 'fit_full_source_on_9_16_canvas',
        intervals: sourceVisualFitIntervals,
      }
      : null;

    return {
      ...job,
      renderPlan: {
        ...job.renderPlan,
        composition: {
          ...job.renderPlan.composition,
          speakerTrack: result.speakerTrack,
          sourceVisualFit,
          denseFaceTracking: {
            provider: result.provider,
            faceDetector: result.faceDetector,
            mediaPipeFaceLandmarker: result.mediaPipeFaceLandmarker,
            sourceWidth: result.sourceWidth,
            sourceHeight: result.sourceHeight,
            confidence: result.confidence,
            detections: result.detections,
            detectedSamples: result.detectedSamples,
            sampleCount: result.sampleCount,
            trackCount: result.trackCount,
            tracks: result.tracks,
            activeSpeakerMode: result.activeSpeakerMode,
            speakerTimelineSegments: speakerTimeline.length,
            speakerTrackAssignments: result.speakerTrackAssignments,
            rawSpeakerTrackPoints: result.rawSpeakerTrackPoints,
            stabilizedSpeakerTrackPoints: result.stabilizedSpeakerTrackPoints,
            lowConfidenceFallbackPoints: result.lowConfidenceFallbackPoints,
            edgeSafeFallbackPoints: result.edgeSafeFallbackPoints,
            speakerTimelineAfterFiltering: result.speakerTimelineAfterFiltering,
            stabilizationMode: result.stabilizationMode,
            cleanSpeakerFrame: result.cleanSpeakerFrame,
            speakerMissingIntervals: result.speakerMissingIntervals,
          },
        },
      },
    };
  } catch (error) {
    if (process.env.DENSE_FACE_TRACKING_REQUIRED === '1') throw error;
    console.warn(`Dense face tracking skipped: ${error.message}`);
    return job;
  }
}

function createR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: requireEnv('CLOUDFLARE_R2_ENDPOINT'),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv('CLOUDFLARE_R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function streamToFile(stream, targetPath) {
  await new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(targetPath);
    stream.pipe(writeStream);
    stream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });
}

async function readR2Json(client, key) {
  const result = await client.send(new GetObjectCommand({
    Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
    Key: key,
  }));
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function loadJobSpec(client) {
  if (process.env.RENDER_JOB_SPEC_FILE) {
    return JSON.parse(await fsp.readFile(process.env.RENDER_JOB_SPEC_FILE, 'utf8'));
  }

  if (process.env.RENDER_JOB_SPEC_KEY) {
    return readR2Json(client, process.env.RENDER_JOB_SPEC_KEY);
  }

  if (process.env.RENDER_JOB_SPEC_URL) {
    const response = await fetch(process.env.RENDER_JOB_SPEC_URL);
    if (!response.ok) throw new Error(`Could not fetch render job spec: ${response.status}`);
    return response.json();
  }

  throw new Error('Set RENDER_JOB_SPEC_KEY, RENDER_JOB_SPEC_FILE, or RENDER_JOB_SPEC_URL.');
}

function srtTimestamp(seconds) {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function assTimestamp(seconds) {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  const centis = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function escapeAssText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function assColor(hex, alphaHex = '00') {
  const namedColors = {
    white: 'ffffff',
    black: '000000',
    yellow: 'ffd84d',
    red: 'ff3b30',
    green: '34c759',
    blue: '007aff',
  };
  const input = String(hex || '#ffffff').trim().toLowerCase();
  const normalized = (namedColors[input] || input.replace('#', '')).padEnd(6, 'f').slice(0, 6);
  const rr = normalized.slice(0, 2);
  const gg = normalized.slice(2, 4);
  const bb = normalized.slice(4, 6);
  return `&H${alphaHex}${bb}${gg}${rr}`;
}

function captionStyle(job) {
  const style = job.renderPlan.captionStyle || job.renderPlan.captionTrack?.style || {};
  const captionText = (job.renderPlan.captionTrack?.lines || [])
    .map((line) => line.text || '')
    .join(' ');
  const hasDevanagari = /[\u0900-\u097f]/u.test(captionText);
  const enhanced = process.env.EASYED_UPGRADES_ENABLED !== '0'
    && process.env.REMOTION_CAPTIONS_ENABLED !== '0'
    && job.renderPlan.captionTrack?.engine === 'remotion_captions';
  const hasSourceCaptions = Boolean(job.renderPlan.visualVerification?.hasBurnedInCaptions);
  return {
    fontName: hasDevanagari
      ? (process.env.CAPTION_DEVANAGARI_FONT || 'Noto Sans Devanagari')
      : (process.env.CAPTION_FONT || 'Inter'),
    fontSize: Number(process.env.CAPTION_FONT_SIZE || style.fontSize || 74),
    primaryColor: assColor(style.primaryColor || '#ffffff'),
    highlightColor: assColor(style.highlightColor || '#ffd447'),
    outlineColor: assColor(process.env.CAPTION_BOX_COLOR || '#101010', process.env.CAPTION_BOX_ALPHA || '60'),
    borderStyle: enhanced ? 1 : 4,
    outline: enhanced ? Number(process.env.REMOTION_CAPTION_OUTLINE || 4) : Number(process.env.CAPTION_BOX_PADDING || 20),
    shadow: enhanced ? Number(process.env.REMOTION_CAPTION_SHADOW || 2) : 0,
    alignment: 2,
    marginL: Number(process.env.CAPTION_MARGIN_L || style.safeArea?.x || 80),
    marginR: Number(process.env.CAPTION_MARGIN_R || style.safeArea?.x || 80),
    marginV: Number(enhanced
      ? (hasSourceCaptions
          ? process.env.REMOTION_CAPTION_BURNED_IN_MARGIN_V || 360
          : process.env.REMOTION_CAPTION_MARGIN_V || 200)
      : process.env.CAPTION_MARGIN_V || 180),
    centerY: Number(hasSourceCaptions
      ? process.env.REMOTION_CAPTION_BURNED_IN_CENTER_Y || 1310
      : process.env.REMOTION_CAPTION_CENTER_Y || 1520),
    enhanced,
  };
}

function enhancedCaptionText(line, activeWordIndex, style) {
  const words = Array.isArray(line.words) ? line.words : [];
  const fontSize = Math.max(48, Math.min(82, Number(process.env.REMOTION_CAPTION_FIXED_FONT_SIZE || 74)));
  const parts = words.map((word, index) => {
    const prefix = index === Number(line.breakBeforeIndex) ? '\\N' : (index === 0 ? '' : ' ');
    const escaped = escapeAssText(String(word.word || '').toUpperCase());
    if (index !== activeWordIndex) return `${prefix}${escaped}`;
    return `${prefix}{\\c${style.highlightColor}}${escaped}{\\c${style.primaryColor}}`;
  });
  return `{\\an5\\pos(540,${Math.round(style.centerY)})\\fs${fontSize}}${parts.join('')}`;
}

function captionDialogueEvents(job, style) {
  const lines = job.renderPlan.captionTrack?.lines || [];
  if (!style.enhanced) {
    return lines.map((line) => (
      `Dialogue: 0,${assTimestamp(line.start)},${assTimestamp(Math.max(line.end, line.start + 0.35))},Default,,0,0,0,,${escapeAssText(String(line.text || '').toUpperCase())}`
    ));
  }

  return lines.flatMap((line) => {
    const words = Array.isArray(line.words) ? line.words : [];
    if (!words.length) {
      const fontSize = Math.max(48, Math.min(82, Number(process.env.REMOTION_CAPTION_FIXED_FONT_SIZE || 74)));
      const text = escapeAssText(String(line.text || '').toUpperCase());
      return [`Dialogue: 0,${assTimestamp(line.start)},${assTimestamp(Math.max(line.end, line.start + 0.35))},Default,,0,0,0,,{\\an5\\pos(540,${Math.round(style.centerY)})\\fs${fontSize}}${text}`];
    }
    return words.map((word, index) => {
      const next = words[index + 1];
      const start = Math.max(Number(line.start), Number(word.start));
      const end = Math.max(start + 0.08, Number(next?.start ?? line.end ?? word.end));
      return `Dialogue: 0,${assTimestamp(start)},${assTimestamp(end)},Default,,0,0,0,,${enhancedCaptionText(line, index, style)}`;
    });
  });
}

async function writeAss(job, targetPath) {
  const lines = job.renderPlan.captionTrack?.lines || [];
  const style = captionStyle(job);
  const body = captionDialogueEvents(job, style).join('\n');

  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,${style.fontName},${style.fontSize},${style.primaryColor},${style.highlightColor},${style.outlineColor},${style.outlineColor},1,0,0,0,100,100,0,0,${style.borderStyle},${style.outline},${style.shadow},${style.alignment},${style.marginL},${style.marginR},${style.marginV},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${body}
`;

  await fsp.writeFile(targetPath, ass, 'utf8');
}

function escapeFilterPath(filePath) {
  return filePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

function subtitlesFilter(captionsPath) {
  const escapedCaptionsPath = escapeFilterPath(captionsPath);
  const configuredFontsDir = process.env.CAPTION_FONTS_DIR || '/usr/share/fonts/truetype/noto';
  const fontsDir = fs.existsSync(configuredFontsDir)
    ? `:fontsdir='${escapeFilterPath(configuredFontsDir)}'`
    : '';
  return `subtitles=filename='${escapedCaptionsPath}'${fontsDir}`;
}

function buildSafeContainFilter(job, captionsPath) {
  const composition = job.renderPlan.composition || {};
  const foreground = composition.foreground || {};
  const background = composition.background || {};
  const maxWidth = Number(process.env.RENDER_FOREGROUND_MAX_WIDTH || foreground.maxWidth || 1040);
  const maxHeight = Number(process.env.RENDER_FOREGROUND_MAX_HEIGHT || foreground.maxHeight || 1180);
  const y = Number(process.env.RENDER_FOREGROUND_Y || foreground.y || 150);
  const blur = Number(process.env.RENDER_BACKGROUND_BLUR || background.blurSigma || 34);
  const dim = Math.max(0, Math.min(0.65, Number(process.env.RENDER_BACKGROUND_DIM || background.dim || 0.18)));
  const brightness = Number((-dim).toFixed(2));
  const layers = [
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=${blur},eq=brightness=${brightness}:saturation=0.82[bg]`,
    `[0:v]scale=${maxWidth}:${maxHeight}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[fg]`,
    `[bg][fg]overlay=(W-w)/2:${y}:format=auto,setsar=1[composed]`,
  ];

  if (job.renderPlan.captionTrack?.lines?.length) {
    layers.push(`[composed]${subtitlesFilter(captionsPath)}[vout]`);
  } else {
    layers.push('[composed]null[vout]');
  }

  return layers.join(';');
}

function firstSpeakerRegion(job) {
  const speakerRegions = job.renderPlan.composition?.detectedRegions?.speaker
    || job.renderPlan.visualVerification?.speakerRegions
    || [];
  return speakerRegions[0] || null;
}

function speakerTrack(job) {
  const track = job.renderPlan.composition?.speakerTrack || [];
  if (track.length) return track;

  const speaker = firstSpeakerRegion(job);
  if (!speaker) return [];
  const centerX = Math.max(0.18, Math.min(0.82, Number((speaker.x || 0.5) + (speaker.width || 0) / 2)));
  const centerY = Math.max(0.16, Math.min(0.86, Number((speaker.y || 0.5) + (speaker.height || 0) / 2)));
  const width = Math.max(0.08, Math.min(0.8, Number(speaker.width || 0.25)));
  const height = Math.max(0.12, Math.min(0.95, Number(speaker.height || 0.35)));
  const duration = Math.max(1, Number(job.clip.duration || job.clip.end - job.clip.start || 12));
  return [
    { t: 0, x: Number(centerX.toFixed(4)), y: Number(centerY.toFixed(4)), width: Number(width.toFixed(4)), height: Number(height.toFixed(4)) },
    { t: Number(duration.toFixed(2)), x: Number(centerX.toFixed(4)), y: Number(centerY.toFixed(4)), width: Number(width.toFixed(4)), height: Number(height.toFixed(4)) },
  ];
}

function interpolationExpression(start, end, field) {
  const deltaT = Math.max(0.01, end.t - start.t);
  const startValue = Number(start[field]);
  const endValue = Number(end[field]);
  const delta = endValue - startValue;
  return `(${startValue.toFixed(4)}+(${delta.toFixed(4)})*(t-${start.t.toFixed(2)})/${deltaT.toFixed(2)})`;
}

function isHardTrackTransition(start, end) {
  const source = `${start.source || ''} ${end.source || ''}`;
  return source.includes('cut')
    || source.includes('boundary')
    || start.speakerSwitchNear
    || end.speakerSwitchNear
    || start.activeTranscriptSpeaker !== end.activeTranscriptSpeaker
    || start.trackId !== end.trackId;
}

function isImportantTrackPoint(point, index, points) {
  if (index === 0 || index === points.length - 1) return true;
  const source = String(point.source || '');
  if (source.includes('hard_cut') || source.includes('boundary')) return true;
  if (point.speakerSwitchNear) return true;
  const previous = points[index - 1];
  if (previous && previous.activeTranscriptSpeaker !== point.activeTranscriptSpeaker) return true;
  if (previous && previous.trackId !== point.trackId && Math.abs(Number(point.t) - Number(previous.t)) <= 0.25) return true;
  return false;
}

function selectedSpeakerTrackPoints(job, field) {
  const maxPoints = Number(process.env.DENSE_FACE_TRACKING_MAX_RENDER_POINTS || 48);
  const points = speakerTrack(job)
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point[field]))
    .sort((a, b) => a.t - b.t)
    .map((point, index) => ({ ...point, __index: index }));

  if (points.length <= maxPoints) return points;

  const selected = new Map();
  points.forEach((point, index) => {
    if (isImportantTrackPoint(point, index, points)) {
      selected.set(point.__index, point);
    }
  });

  const remainingSlots = Math.max(0, maxPoints - selected.size);
  const optional = points.filter((point) => !selected.has(point.__index));
  if (remainingSlots > 0 && optional.length > 0) {
    const step = optional.length / remainingSlots;
    for (let index = 0; index < remainingSlots; index += 1) {
      const point = optional[Math.min(optional.length - 1, Math.floor(index * step))];
      selected.set(point.__index, point);
    }
  }

  return [...selected.values()]
    .sort((a, b) => a.t - b.t)
    .map(({ __index, ...point }) => point);
}

function speakerTrackExpression(job, field, fallback) {
  const points = selectedSpeakerTrackPoints(job, field);

  if (points.length === 0) return String(fallback);
  if (points.length === 1) return Number(points[0][field]).toFixed(4);

  let expression = Number(points[points.length - 1][field]).toFixed(4);
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const start = points[index];
    const end = points[index + 1];
    const segment = isHardTrackTransition(start, end)
      ? Number(start[field]).toFixed(4)
      : interpolationExpression(start, end, field);
    expression = `if(lt(t,${end.t.toFixed(2)}),${segment},${expression})`;
  }

  return `if(lte(t,${points[0].t.toFixed(2)}),${Number(points[0][field]).toFixed(4)},${expression})`;
}

function median(values, fallback) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return fallback;
  return sorted[Math.floor(sorted.length / 2)];
}

function average(values, fallback) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return fallback;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function percentile(values, ratio, fallback) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return fallback;
  return sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * ratio))];
}

function speakerCropHeightNorm(job) {
  const points = speakerTrack(job);
  const dense = job.renderPlan.composition?.denseFaceTracking || {};
  const sourceWidth = Number(dense.sourceWidth || 1920);
  const sourceHeight = Number(dense.sourceHeight || 1080);
  const aspectFactor = (sourceHeight / sourceWidth) * (9 / 16);
  // A static crop size must be safe for every shot in the clip, not merely the
  // median shot. The old median allowed brief edge-speaker shots to be cut off.
  const safeHeight = percentile(points.map((point) => Number(point.height)), 0.9, 0.45);
  const safeWidth = percentile(points.map((point) => Number(point.width)), 0.9, 0.24);
  const byHeight = safeHeight / 0.72;
  const byWidth = safeWidth / Math.max(0.1, aspectFactor * 0.9);
  return Math.max(0.72, Math.min(0.98, Number(Math.max(byHeight, byWidth).toFixed(4))));
}

function sourceVisualFit(job) {
  const fit = job.renderPlan.composition?.sourceVisualFit;
  if (!Array.isArray(fit?.intervals) || !fit.intervals.length) return null;
  return fit;
}

function sourceCaptionMask(job, inputLabel, outputLabel) {
  const visual = job.renderPlan.visualVerification || {};
  if (!visual.hasBurnedInCaptions) return `${inputLabel}null[${outputLabel}]`;
  const band = visual.sourceCaptionBand || {};
  const y = Math.max(0.65, Math.min(0.98, Number(band.y || 0.84)));
  // Remove the narrow source subtitle strip before fitting the complete visual.
  // Cropping it out avoids introducing another visible black rectangle.
  return `${inputLabel}crop=w=iw:h='trunc(ih*${y.toFixed(4)}/2)*2':x=0:y=0[${outputLabel}]`;
}

function buildSpeakerFocusFilter(job, captionsPath) {
  const centerXExpr = speakerTrackExpression(job, 'x', 0.5);
  const centerYExpr = speakerTrackExpression(job, 'y', 0.5);
  const cropHeightNorm = speakerCropHeightNorm(job);
  const fit = sourceVisualFit(job);
  const layers = [];
  if (fit) {
    layers.push('[0:v]setpts=PTS-STARTPTS,split=3[speakerSource][visualBgSource][visualFgSource]');
  } else {
    layers.push('[0:v]setpts=PTS-STARTPTS[speakerSource]');
  }
  layers.push(`[speakerSource]crop=w='trunc(ih*${cropHeightNorm.toFixed(4)}*9/16/2)*2':h='trunc(ih*${cropHeightNorm.toFixed(4)}/2)*2':x='clip(iw*(${centerXExpr})-ow/2,0,iw-ow)':y='clip(ih*(${centerYExpr})-oh/2,0,ih-oh)',scale=1080:1920:flags=lanczos,setsar=1[live]`);
  if (fit) {
    const enable = fit.intervals
      .map((interval) => `between(t,${Number(interval.start).toFixed(2)},${Number(interval.end).toFixed(2)})`)
      .join('+');
    const graphicSafeV2 = visualFitUpgradeEnabled();
    const fitWidth = Number(process.env.SOURCE_VISUAL_FIT_MAX_WIDTH || (graphicSafeV2 ? 996 : 1040));
    const fitHeight = Number(process.env.SOURCE_VISUAL_FIT_MAX_HEIGHT || (graphicSafeV2 ? 1760 : 1500));
    const fitY = Number(process.env.SOURCE_VISUAL_FIT_Y_OFFSET || (graphicSafeV2 ? -40 : -80));
    const graphicBlur = Number(process.env.SOURCE_VISUAL_FIT_BACKGROUND_BLUR || 38);
    const graphicDim = Number(process.env.SOURCE_VISUAL_FIT_BACKGROUND_BRIGHTNESS || -0.12);
    layers.push(`[visualBgSource]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=${graphicBlur},eq=brightness=${graphicDim}:saturation=0.78[visualBg]`);
    layers.push(sourceCaptionMask(job, '[visualFgSource]', 'visualMasked'));
    layers.push(`[visualMasked]scale=${fitWidth}:${fitHeight}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[visualFg]`);
    layers.push(`[visualBg][visualFg]overlay=(W-w)/2:(H-h)/2${fitY >= 0 ? '+' : ''}${fitY}:format=auto,setsar=1[fittedVisual]`);
    layers.push(`[live][fittedVisual]overlay=0:0:enable='${enable}'[sourceComposed]`);
  } else {
    layers.push('[live]null[sourceComposed]');
  }
  layers.push('[sourceComposed]null[composed]');

  if (job.renderPlan.captionTrack?.lines?.length) {
    layers.push(`[composed]${subtitlesFilter(captionsPath)}[vout]`);
  } else {
    layers.push('[composed]null[vout]');
  }

  return layers.join(';');
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedRegion(region, fallback = { x: 0, y: 0, width: 1, height: 1 }) {
  return {
    x: Math.max(0, Math.min(0.98, Number(region?.x ?? fallback.x))),
    y: Math.max(0, Math.min(0.98, Number(region?.y ?? fallback.y))),
    width: Math.max(0.02, Math.min(1, Number(region?.width ?? fallback.width))),
    height: Math.max(0.02, Math.min(1, Number(region?.height ?? fallback.height))),
  };
}

function cropPanelFilter(inputLabel, region, width, height, outputLabel) {
  const safe = normalizedRegion(region);
  const cropW = `trunc(iw*${safe.width.toFixed(4)}/2)*2`;
  const cropH = `trunc(ih*${safe.height.toFixed(4)}/2)*2`;
  const cropX = `clip(iw*${safe.x.toFixed(4)},0,iw-${cropW})`;
  const cropY = `clip(ih*${safe.y.toFixed(4)},0,ih-${cropH})`;
  const innerW = Math.max(2, width - 12);
  const innerH = Math.max(2, height - 12);
  return `${inputLabel}crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x101010,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.22:t=4,setsar=1[${outputLabel}]`;
}

function panelRegionFromAnchor(anchor, sourceAspect = 16 / 9, panelAspect = 1008 / 720) {
  const faceX = Number(anchor.faceX ?? anchor.x ?? 0.5);
  const faceY = Number(anchor.faceY ?? anchor.y ?? 0.48);
  const faceWidth = Number(anchor.faceWidth ?? 0.08);
  const faceHeight = Number(anchor.faceHeight ?? 0.14);
  const centerX = clamp(faceX, 0.16, 0.84);
  const centerY = clamp(faceY + 0.11, 0.2, 0.72);
  const height = clamp(Math.max(0.5, faceHeight * 2.7), 0.5, 0.8);
  const width = clamp(Math.max(0.34, faceWidth * 3.4, height * panelAspect / sourceAspect), 0.34, 0.68);
  return normalizedRegion({
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  });
}

function anchorFromDenseTrack(track, speaker = null) {
  return {
    key: speaker || `track:${track.id}`,
    speaker,
    trackId: track.id,
    samples: Number(track.points || 0),
    firstT: Number(track.start || 0),
    faceX: Number(track.faceX),
    faceY: Number(track.faceY),
    faceWidth: Number(track.faceWidth || 0.08),
    faceHeight: Number(track.faceHeight || 0.14),
    confidence: Number(track.detectorConfidence || 0.65),
    coVisibleWith: Array.isArray(track.coVisibleWith) ? track.coVisibleWith : [],
  };
}

function coVisibleSamples(a, b) {
  return Number(a.coVisibleWith?.find((item) => Number(item.trackId) === Number(b.trackId))?.samples || 0);
}

function distinctSpeakerPair(a, b, minimumCoVisibleSamples) {
  if (!a || !b || Number(a.trackId) === Number(b.trackId)) return false;
  const distance = Math.hypot(Number(a.faceX) - Number(b.faceX), Number(a.faceY) - Number(b.faceY));
  return distance >= Number(process.env.RENDER_STACKED_MIN_FACE_DISTANCE || 0.16)
    && coVisibleSamples(a, b) >= minimumCoVisibleSamples;
}

function groupedSpeakerAnchors(job) {
  const denseTracks = job.renderPlan.composition?.denseFaceTracking?.tracks || [];
  const trackAnchors = denseTracks
    .filter((track) => Number(track.points || 0) >= Number(process.env.RENDER_STACKED_MIN_SAMPLES || 3))
    .filter((track) => Number.isFinite(Number(track.faceX)) && Number.isFinite(Number(track.faceY)))
    .map((track) => anchorFromDenseTrack(track));

  const tracksById = new Map(trackAnchors.map((track) => [Number(track.trackId), track]));
  const sampleCount = Number(job.renderPlan.composition?.denseFaceTracking?.sampleCount || 0);
  const minimumCoVisibleSamples = Math.max(
    Number(process.env.RENDER_STACKED_MIN_COVISIBLE_SAMPLES || 3),
    Math.ceil(sampleCount * Number(process.env.RENDER_STACKED_MIN_COVISIBLE_RATIO || 0.6)),
  );
  const assignments = job.renderPlan.composition?.denseFaceTracking?.speakerTrackAssignments || [];
  const assigned = assignments
    .map((assignment) => {
      const track = tracksById.get(Number(assignment.trackId));
      return track ? { ...track, key: assignment.speaker, speaker: assignment.speaker } : null;
    })
    .filter(Boolean);
  if (assigned.length >= 2 && distinctSpeakerPair(assigned[0], assigned[1], minimumCoVisibleSamples)) {
    return assigned.slice(0, 2);
  }

  let bestPair = null;
  let bestScore = -1;
  for (let left = 0; left < trackAnchors.length; left += 1) {
    for (let right = left + 1; right < trackAnchors.length; right += 1) {
      const a = trackAnchors[left];
      const b = trackAnchors[right];
      if (!distinctSpeakerPair(a, b, minimumCoVisibleSamples)) continue;
      const score = coVisibleSamples(a, b) * 100
        + Math.min(a.samples, b.samples) * 2
        + (a.confidence + b.confidence);
      if (score > bestScore) {
        bestPair = [a, b];
        bestScore = score;
      }
    }
  }
  if (bestPair) return bestPair.sort((a, b) => Number(a.faceX) - Number(b.faceX));

  // Dense tracking is authoritative when present. If it cannot prove that two
  // faces were visible together, a stacked layout risks duplicating one person.
  if (denseTracks.length) return [];

  const points = speakerTrack(job)
    .filter((point) => Number.isFinite(Number(point.faceX ?? point.x)) && Number.isFinite(Number(point.faceY ?? point.y)));

  const groups = new Map();
  for (const point of points) {
    const key = point.activeTranscriptSpeaker || (point.trackId ? `track:${point.trackId}` : null);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }

  const legacyAnchors = [...groups.entries()]
    .map(([key, group]) => ({
      key,
      samples: group.length,
      firstT: Math.min(...group.map((point) => Number(point.t || 0))),
      faceX: median(group.map((point) => Number(point.faceX ?? point.x)), 0.5),
      faceY: median(group.map((point) => Number(point.faceY ?? point.y)), 0.48),
      faceWidth: median(group.map((point) => Number(point.faceWidth)), 0.08),
      faceHeight: median(group.map((point) => Number(point.faceHeight)), 0.14),
      confidence: average(group.map((point) => Number(point.detectorConfidence)), 0.65),
    }))
    .filter((anchor) => anchor.samples >= Number(process.env.RENDER_STACKED_MIN_SAMPLES || 3))
    .sort((a, b) => {
      if (Math.abs(a.faceX - b.faceX) >= 0.12) return a.faceX - b.faceX;
      return a.firstT - b.firstT;
    });
  if (legacyAnchors.length < 2) return [];
  const distance = Math.hypot(
    legacyAnchors[0].faceX - legacyAnchors[1].faceX,
    legacyAnchors[0].faceY - legacyAnchors[1].faceY,
  );
  return distance >= Number(process.env.RENDER_STACKED_MIN_FACE_DISTANCE || 0.16)
    ? legacyAnchors.slice(0, 2)
    : [];
}

function stackedSpeakerRegions(job) {
  const anchors = groupedSpeakerAnchors(job);
  if (anchors.length < 2) return [];

  const dense = job.renderPlan.composition?.denseFaceTracking || {};
  const sourceWidth = Number(dense.sourceWidth || 1920);
  const sourceHeight = Number(dense.sourceHeight || 1080);
  const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
  const selected = anchors.slice(0, 2);
  const regions = selected.map((anchor) => panelRegionFromAnchor(anchor, sourceAspect));
  const horizontalOrder = [0, 1].sort((a, b) => selected[a].faceX - selected[b].faceX);
  const leftIndex = horizontalOrder[0];
  const rightIndex = horizontalOrder[1];
  const boundary = (selected[leftIndex].faceX + selected[rightIndex].faceX) / 2;
  const overlapAllowance = 0.025;
  const left = regions[leftIndex];
  const right = regions[rightIndex];
  left.width = Math.max(0.2, Math.min(left.width, boundary + overlapAllowance - left.x));
  const rightEdge = right.x + right.width;
  right.x = Math.max(right.x, boundary - overlapAllowance);
  right.width = Math.max(0.2, rightEdge - right.x);
  return regions.map((region) => normalizedRegion(region));
}

function fillPanelFilter(inputLabel, region, width, height, outputLabel) {
  const safe = normalizedRegion(region);
  const cropW = `trunc(iw*${safe.width.toFixed(4)}/2)*2`;
  const cropH = `trunc(ih*${safe.height.toFixed(4)}/2)*2`;
  const cropX = `clip(iw*${safe.x.toFixed(4)},0,iw-${cropW})`;
  const cropY = `clip(ih*${safe.y.toFixed(4)},0,ih-${cropH})`;
  const innerW = Math.max(2, width - 10);
  const innerH = Math.max(2, height - 10);
  return `${inputLabel}crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',scale=${innerW}:${innerH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${innerW}:${innerH},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x080808,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.28:t=5,setsar=1[${outputLabel}]`;
}

function buildStackedSpeakerFallbackFilter(job, captionsPath) {
  const layout = job.renderPlan.composition?.stackedSpeakerFallback || {};
  const regions = Array.isArray(layout.regions) && layout.regions.length >= 2
    ? layout.regions
    : stackedSpeakerRegions(job);

  if (regions.length < 2) return buildSafeContainFilter(job, captionsPath);

  const duration = Math.max(1, Number(job.clip.duration || job.clip.end - job.clip.start || 12));
  const topPanel = layout.topPanel || { x: 0, y: 0, width: 1080, height: 850 };
  const bottomPanel = layout.bottomPanel || { x: 0, y: 850, width: 1080, height: 850 };
  const layers = [
    `color=c=0x050505:s=1080x1920:d=${duration.toFixed(2)},setsar=1[base]`,
    fillPanelFilter('[0:v]', regions[0], topPanel.width, topPanel.height, 'speakerTop'),
    fillPanelFilter('[0:v]', regions[1], bottomPanel.width, bottomPanel.height, 'speakerBottom'),
    `[base][speakerTop]overlay=${topPanel.x}:${topPanel.y}:format=auto[withTop]`,
    `[withTop][speakerBottom]overlay=${bottomPanel.x}:${bottomPanel.y}:format=auto,setsar=1[composed]`,
  ];

  if (job.renderPlan.captionTrack?.lines?.length) {
    layers.push(`[composed]${subtitlesFilter(captionsPath)}[vout]`);
  } else {
    layers.push('[composed]null[vout]');
  }

  return layers.join(';');
}

function buildSpeakerPlusScreenFilter(job, captionsPath) {
  const layout = job.renderPlan.composition?.speakerPlusScreen || {};
  const visualFocus = normalizedRegion(layout.visualFocus, { x: 0, y: 0, width: 1, height: 1 });
  const speakerOverlay = normalizedRegion(layout.speakerOverlay, firstSpeakerRegion(job) || { x: 0.62, y: 0.3, width: 0.35, height: 0.55 });
  const visualPanel = layout.visualPanel || { x: 40, y: 120, width: 1000, height: 980 };
  const speakerPanel = layout.speakerPanel || { x: 660, y: 820, width: 360, height: 460 };
  const background = job.renderPlan.composition?.background || {};
  const blur = Number(process.env.RENDER_BACKGROUND_BLUR || background.blurSigma || 34);
  const dim = Math.max(0, Math.min(0.65, Number(process.env.RENDER_BACKGROUND_DIM || background.dim || 0.18)));
  const brightness = Number((-dim).toFixed(2));
  const layers = [
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=${blur},eq=brightness=${brightness}:saturation=0.82[bg]`,
    cropPanelFilter('[0:v]', visualFocus, visualPanel.width, visualPanel.height, 'screenPanel'),
    cropPanelFilter('[0:v]', speakerOverlay, speakerPanel.width, speakerPanel.height, 'speakerPanel'),
    `[bg][screenPanel]overlay=${visualPanel.x}:${visualPanel.y}:format=auto[withScreen]`,
    `[withScreen][speakerPanel]overlay=${speakerPanel.x}:${speakerPanel.y}:format=auto,setsar=1[composed]`,
  ];

  if (job.renderPlan.captionTrack?.lines?.length) {
    layers.push(`[composed]${subtitlesFilter(captionsPath)}[vout]`);
  } else {
    layers.push('[composed]null[vout]');
  }

  return layers.join(';');
}

function buildVideoFilter(job, captionsPath) {
  if (job.renderPlan.composition?.mode === 'speaker_focus_crop') {
    return buildSpeakerFocusFilter(job, captionsPath);
  }
  if (job.renderPlan.composition?.mode === 'speaker_plus_screen') {
    return buildSpeakerPlusScreenFilter(job, captionsPath);
  }
  if (job.renderPlan.composition?.mode === 'stacked_speaker_blur') {
    return buildStackedSpeakerFallbackFilter(job, captionsPath);
  }
  return buildSafeContainFilter(job, captionsPath);
}

async function downloadSource(client, key, targetPath) {
  const result = await client.send(new GetObjectCommand({
    Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
    Key: key,
  }));
  await streamToFile(result.Body, targetPath);
}

async function resolveSourceInput(client, job, targetPath) {
  if (process.env.RENDER_SOURCE_ACCESS_MODE === 'signed_url') {
    return getSignedUrl(client, new GetObjectCommand({
      Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
      Key: job.episode.source.assetKey,
    }), { expiresIn: Number(process.env.RENDER_SOURCE_URL_TTL_SECONDS || 3600) });
  }
  await downloadSource(client, job.episode.source.assetKey, targetPath);
  return targetPath;
}

async function uploadOutput(client, key, filePath) {
  await client.send(new PutObjectCommand({
    Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentType: 'video/mp4',
  }));
}

async function uploadJson(client, key, value) {
  await client.send(new PutObjectCommand({
    Bucket: requireEnv('CLOUDFLARE_R2_BUCKET_NAME'),
    Key: key,
    Body: JSON.stringify(value),
    ContentType: 'application/json',
  }));
}

async function renderVideoOnce(job, sourcePath, captionsPath, outputPath) {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const duration = Math.max(1, Number(job.clip.duration || job.clip.end - job.clip.start));

  const args = [
    '-hide_banner',
    '-y',
    '-ss',
    String(job.clip.start),
    '-i',
    sourcePath,
  ];
  args.push(
    '-t',
    String(duration),
    '-filter_complex',
    buildVideoFilter(job, captionsPath),
    '-map',
    '[vout]',
    '-map',
    '0:a?',
    '-c:v',
    job.ffmpeg?.outputCodec || 'libx264',
    '-preset',
    process.env.FFMPEG_PRESET || 'medium',
    '-crf',
    process.env.FFMPEG_CRF || '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    job.ffmpeg?.audioCodec || 'aac',
    '-b:a',
    process.env.FFMPEG_AUDIO_BITRATE || '160k',
    '-movflags',
    '+faststart',
    outputPath,
  );

  await execFileAsync(ffmpegPath, args, {
    timeout: Number(process.env.RENDER_FFMPEG_TIMEOUT_MS || 15 * 60 * 1000),
    // Keep a defensive ceiling for FFmpeg diagnostics. Production normally
    // points libass at the deliberately small /opt/easyed-fonts directory,
    // but malformed inputs should not fail merely because stderr is verbose.
    maxBuffer: 1024 * 1024 * 64,
  });
}

async function runRenderQc(outputPath, job) {
  if (process.env.RENDER_QC_ENABLED !== '1') return null;
  const pythonPath = process.env.PYTHON_PATH || 'python3';

  try {
    const { stdout } = await execFileAsync(pythonPath, [
      renderQcScriptPath(),
      '--source',
      outputPath,
      '--fps',
      String(process.env.RENDER_QC_FPS || 1),
      '--edge-margin',
      String(process.env.RENDER_QC_EDGE_MARGIN || 0.045),
      '--max-no-face-ratio',
      String(process.env.RENDER_QC_MAX_NO_FACE_RATIO || 0.14),
      '--max-edge-face-ratio',
      String(process.env.RENDER_QC_MAX_EDGE_FACE_RATIO || 0.12),
      '--layout',
      String(job.renderPlan.composition?.mode || 'safe_contain_blur'),
      '--panel-split-y',
      String(Number(job.renderPlan.composition?.stackedSpeakerFallback?.topPanel?.height || 850) / 1920),
    ], {
      timeout: Number(process.env.RENDER_QC_TIMEOUT_MS || 90000),
      maxBuffer: 1024 * 1024 * 2,
    });
    return JSON.parse(stdout);
  } catch (error) {
    return {
      passed: false,
      failReason: 'qc_error',
      error: error.message,
    };
  }
}

function shouldFallbackToSafeContain(job, qc) {
  if (process.env.RENDER_QC_SAFE_CONTAIN_FALLBACK !== '1') return false;
  return job.renderPlan.composition?.mode === 'speaker_focus_crop' && qc && qc.passed === false;
}

function qcFallbackJob(job, qc, forcedMode = null) {
  const regions = forcedMode === 'safe_contain_blur' || process.env.RENDER_QC_STACKED_SPEAKER_FALLBACK === '0'
    ? []
    : stackedSpeakerRegions(job);
  const mode = forcedMode || (regions.length >= 2 ? 'stacked_speaker_blur' : 'safe_contain_blur');
  return {
    ...job,
    renderPlan: {
      ...job.renderPlan,
      composition: {
        ...job.renderPlan.composition,
        mode,
        stackedSpeakerFallback: regions.length >= 2 ? {
          regions,
          topPanel: { x: 0, y: 0, width: 1080, height: 850 },
          bottomPanel: { x: 0, y: 850, width: 1080, height: 850 },
        } : undefined,
        qcFallback: {
          fromMode: job.renderPlan.composition?.mode,
          reason: qc?.failReason || 'render_qc_failed',
          fallbackMode: mode,
        },
      },
    },
  };
}

async function renderWithFfmpeg(job, workDir) {
  const client = createR2Client();
  const sourcePath = path.join(workDir, 'source');
  const captionsPath = path.join(workDir, 'captions.ass');
  const outputPath = path.join(workDir, 'output.mp4');

  const sourceInput = await resolveSourceInput(client, job, sourcePath);
  job = applyEditorialVisualFit(job);
  job = await applyDenseFaceTracking(job, sourceInput, workDir);
  await writeAss(job, captionsPath);

  await renderVideoOnce(job, sourceInput, captionsPath, outputPath);
  let renderQc = await runRenderQc(outputPath, job);
  let qcFallbackApplied = false;
  if (shouldFallbackToSafeContain(job, renderQc)) {
    const initialQc = renderQc;
    job = qcFallbackJob(job, renderQc);
    await renderVideoOnce(job, sourceInput, captionsPath, outputPath);
    let fallbackQc = await runRenderQc(outputPath, job);
    let safetyFallbackQc = null;
    if (job.renderPlan.composition?.mode === 'stacked_speaker_blur' && fallbackQc?.passed === false) {
      job = qcFallbackJob(job, fallbackQc, 'safe_contain_blur');
      await renderVideoOnce(job, sourceInput, captionsPath, outputPath);
      safetyFallbackQc = await runRenderQc(outputPath, job);
    }
    const finalQc = safetyFallbackQc || fallbackQc;
    renderQc = {
      initial: initialQc,
      fallback: fallbackQc,
      ...(safetyFallbackQc ? { safetyFallback: safetyFallbackQc } : {}),
      passed: finalQc?.passed === true,
      failReason: finalQc?.passed === true ? null : (finalQc?.failReason || 'fallback_qc_failed'),
    };
    qcFallbackApplied = true;
  }

  await uploadOutput(client, job.output.assetKey, outputPath);

  return {
    outputAssetKey: job.output.assetKey,
    outputBytes: fs.statSync(outputPath).size,
    renderQc,
    qcFallbackApplied,
    renderPlan: job.renderPlan,
  };
}

async function main() {
  const client = createR2Client();
  const job = await loadJobSpec(client);
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'easyed-render-'));

  try {
    const result = await renderWithFfmpeg(job, workDir);
    const status = result.renderQc?.passed === false ? 'failed_qc' : 'rendered';
    const workerResult = {
      status,
      completedAt: new Date().toISOString(),
      ...result,
    };
    if (job.result?.assetKey) await uploadJson(client, job.result.assetKey, workerResult);
    console.log(JSON.stringify(workerResult, null, 2));
  } catch (error) {
    if (job.result?.assetKey) {
      await uploadJson(client, job.result.assetKey, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error.message,
      }).catch(() => {});
    }
    throw error;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    sentry.captureException(error);
    console.error(error);
    await sentry.flush(2000);
    process.exitCode = 1;
  });
}

module.exports = {
  buildVideoFilter,
  renderWithFfmpeg,
  writeAss,
  applyDenseFaceTracking,
  _test: {
    editorialFitIntervals,
    applyEditorialVisualFit,
    denseTrackingProxyPath,
    denseTrackingTimelinePath,
    shouldCreateDenseTrackingProxy,
    groupedSpeakerAnchors,
    stackedSpeakerRegions,
    qcFallbackJob,
    resolveSourceInput,
  },
};
