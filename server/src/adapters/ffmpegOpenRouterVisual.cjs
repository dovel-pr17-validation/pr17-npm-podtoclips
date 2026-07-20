const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getObjectStorage } = require('../objectStorage/index.cjs');
const { createJsonCompletion } = require('./openRouterClient.cjs');

const execFileAsync = promisify(execFile);

function getVisionModel() {
  return process.env.OPENROUTER_VISION_MODEL || process.env.OPENROUTER_STRUCTURED_MODEL || 'google/gemini-3-flash-preview';
}

function getFfmpegPath() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function frameExportFilter(selectionFilter) {
  return [
    selectionFilter,
    'scale=640:-2',
    'format=yuvj420p',
  ].filter(Boolean).join(',');
}

function showInfoTimes(stderr, start) {
  return [...String(stderr || '').matchAll(/pts_time:([-+]?\d+(?:\.\d+)?)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite)
    .map((value) => Number((start + Math.max(0, value)).toFixed(2)));
}

async function assertFfmpegAvailable() {
  try {
    await execFileAsync(getFfmpegPath(), ['-version'], { timeout: 5000 });
  } catch (error) {
    throw new Error('FFmpeg is required for VISUAL_PROVIDER=openrouter. Install ffmpeg or set FFMPEG_PATH.');
  }
}

async function resolveVideoInput(episode) {
  const objectStorage = getObjectStorage();

  if (objectStorage.resolveKey) {
    const filePath = objectStorage.resolveKey(episode.source.assetKey);
    if (filePath) return filePath;
  }

  if (objectStorage.getSignedReadUrl) {
    return objectStorage.getSignedReadUrl(episode.source.assetKey);
  }

  if (episode.source.assetUrl?.startsWith('http')) return episode.source.assetUrl;

  throw new Error('Could not resolve source video for visual verification.');
}

async function extractCandidateFrames(episode, candidate) {
  if (!episode.source.mimeType?.startsWith('video/')) {
    return {
      skipped: true,
      reason: `Visual verification skipped because source MIME type is ${episode.source.mimeType || 'unknown'}, not video.`,
      frames: [],
    };
  }

  await assertFfmpegAvailable();

  const input = await resolveVideoInput(episode);
  const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), `easyed-frames-${candidate.id}-`));
  const start = Math.max(0, Number(candidate.start || 0));
  const duration = Math.max(1, Math.min(58, Number(candidate.end || start + 12) - start));
  const maxApiFrames = Number(process.env.VISUAL_MAX_FRAMES || 24);
  const maxSceneScanFrames = Math.max(maxApiFrames, Number(process.env.VISUAL_SCENE_SCAN_MAX_FRAMES || 30));

  try {
    const scenePattern = path.join(outputDir, 'scene_%03d.jpg');
    const sceneExtraction = await execFileAsync(getFfmpegPath(), [
      '-hide_banner',
      '-loglevel',
      'info',
      '-ss',
      String(start),
      '-t',
      String(duration),
      '-i',
      input,
      '-vf',
      `${frameExportFilter(`select='gt(scene,${Number(process.env.VISUAL_SCENE_THRESHOLD || 0.18)})'`)},showinfo`,
      '-vsync',
      'vfr',
      '-frames:v',
      String(maxSceneScanFrames),
      scenePattern,
    ], { timeout: Number(process.env.FFMPEG_TIMEOUT_MS || 60000), maxBuffer: 1024 * 1024 * 4 });
    const sceneTimes = showInfoTimes(sceneExtraction.stderr, start);
    const sceneFiles = (await fsp.readdir(outputDir)).filter((file) => file.startsWith('scene_') && file.endsWith('.jpg')).sort();
    const sceneFrames = sceneFiles.map((file, index) => ({
      path: path.join(outputDir, file),
      t: sceneTimes[index] ?? Number((start + index * Math.max(1, duration / Math.max(sceneFiles.length, 1))).toFixed(2)),
      sceneBoundary: true,
      sceneEndT: sceneTimes[index + 1] ?? Math.min(start + duration, (sceneTimes[index] ?? start) + 2),
    }));

    // Text overlays frequently animate over an otherwise unchanged speaker
    // shot, so scene-change sampling alone never sees them. Add inexpensive
    // periodic safety frames and let the existing vision classifier flag the
    // same full-frame-fit treatment used for graphics and animations.
    const coverageSeconds = Math.max(1, Number(process.env.VISUAL_TEXT_COVERAGE_SECONDS || 1.5));
    const coveragePattern = path.join(outputDir, 'coverage_%03d.jpg');
    const coverageExtraction = await execFileAsync(getFfmpegPath(), [
      '-hide_banner',
      '-loglevel',
      'info',
      '-ss',
      String(start),
      '-t',
      String(duration),
      '-i',
      input,
      '-vf',
      `${frameExportFilter(`fps=${(1 / coverageSeconds).toFixed(4)}`)},showinfo`,
      '-frames:v',
      String(Math.ceil(duration / coverageSeconds) + 1),
      coveragePattern,
    ], { timeout: Number(process.env.FFMPEG_TIMEOUT_MS || 60000), maxBuffer: 1024 * 1024 * 4 });
    const coverageTimes = showInfoTimes(coverageExtraction.stderr, start);
    const coverageFiles = (await fsp.readdir(outputDir)).filter((file) => file.startsWith('coverage_') && file.endsWith('.jpg')).sort();
    const coverageFrames = coverageFiles.map((file, index) => ({
      path: path.join(outputDir, file),
      t: coverageTimes[index] ?? Number((start + index * coverageSeconds).toFixed(2)),
      sceneBoundary: false,
      sceneEndT: null,
    }));

    const combined = [...sceneFrames, ...coverageFrames]
      .sort((a, b) => a.t - b.t || Number(b.sceneBoundary) - Number(a.sceneBoundary));
    const allFrames = combined.filter((frame, index) => (
      index === 0 || Math.abs(frame.t - combined[index - 1].t) >= 0.35 || frame.sceneBoundary
    ));

    if (allFrames.length === 0) {
      await fsp.rm(outputDir, { recursive: true, force: true });
      return { skipped: false, reason: null, frames: [] };
    }
    const frames = allFrames.length <= maxApiFrames
      ? allFrames
      : [...new Set(Array.from({ length: maxApiFrames }, (_, index) => Math.round(index * (allFrames.length - 1) / Math.max(1, maxApiFrames - 1))))]
        .map((index) => allFrames[index]);
    return { skipped: false, reason: null, frames };
  } catch (error) {
    await fsp.rm(outputDir, { recursive: true, force: true });
    throw error;
  }
}

const visualSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hasScreenRecording: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string' },
    primarySubject: {
      type: 'string',
      enum: ['speaker', 'screen', 'speaker_and_screen', 'object', 'unclear'],
    },
    compositionHint: {
      type: 'string',
      enum: ['speaker_focus', 'screen_focus', 'speaker_plus_screen', 'safe_contain'],
    },
    regions: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          frameIndex: { type: 'integer', minimum: 0 },
          label: { type: 'string' },
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
          width: { type: 'number', minimum: 0, maximum: 1 },
          height: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['frameIndex', 'label', 'x', 'y', 'width', 'height'],
      },
    },
    speakerRegions: {
      type: 'array',
      // Gemini's strict-schema endpoint rejects larger per-response array
      // bounds. We classify six frames at a time and merge the batches, so
      // the final verification can still contain data for all 24 frames.
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          frameIndex: { type: 'integer', minimum: 0 },
          label: { type: 'string' },
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
          width: { type: 'number', minimum: 0, maximum: 1 },
          height: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['frameIndex', 'label', 'x', 'y', 'width', 'height'],
      },
    },
    editorialFrames: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          frameIndex: { type: 'integer', minimum: 0 },
          type: {
            type: 'string',
            enum: ['large_text_overlay', 'editorial_animation', 'title_card', 'broll'],
          },
          fitFullFrame: { type: 'boolean' },
        },
        required: ['frameIndex', 'type', 'fitFullFrame'],
      },
    },
    hasBurnedInCaptions: { type: 'boolean' },
    sourceCaptionBand: {
      type: 'object',
      additionalProperties: false,
      properties: {
        y: { type: 'number', minimum: 0, maximum: 1 },
        height: { type: 'number', minimum: 0, maximum: 0.4 },
      },
      required: ['y', 'height'],
    },
  },
  required: ['hasScreenRecording', 'confidence', 'summary', 'primarySubject', 'compositionHint', 'regions', 'speakerRegions', 'editorialFrames', 'hasBurnedInCaptions', 'sourceCaptionBand'],
};

async function classifyFrameBatch(candidate, indexedFrames, totalFrameCount) {
  const content = [
    {
      type: 'text',
      text: JSON.stringify({
        task: 'Classify whether these candidate podcast frames show a product demo, screen recording, UI, slide, or other visual material worth using in a short clip.',
        candidate: {
          id: candidate.id,
          title: candidate.title,
          transcript: candidate.transcript,
          narrativeType: candidate.narrativeType,
        },
        frameCount: totalFrameCount,
        frameIndexesInThisRequest: indexedFrames.map(({ index }) => index),
        instructions: [
          'Return hasScreenRecording true if the frames show an app, browser, dashboard, slide, product screen, or shared screen.',
          'Return approximate normalized regions only for important UI/screen areas that should be highlighted.',
          'Return speakerRegions for visible faces, head-and-shoulders, or full speaker bodies. Use normalized boxes over the visible person, not the whole frame.',
          'Use compositionHint speaker_plus_screen when both a speaker and visual material matter. Use speaker_focus only for mostly talking-head content. Use screen_focus for screen-only demos. Use safe_contain when cropping would risk losing important context.',
          'Return editorialFrames for editor-added B-roll, title cards, large central text overlays, or full-frame explanatory animations that must remain visible in the final clip.',
          'Set fitFullFrame true for every B-roll shot, editorial animation, title card, or large source-edited text overlay. Flag oversized words even when they animate over an otherwise normal speaker shot, appear only briefly, touch a frame edge, or are already partially cropped in the sampled image. These visuals must remain visible and be scaled proportionally inside the 9:16 canvas rather than face-cropped. Do not flag ordinary studio signs, logos, or microphones.',
          `Every image below is preceded by its exact FRAME_INDEX. Only return frameIndex values from this request: ${indexedFrames.map(({ index }) => index).join(', ')}. Inspect every frame independently; do not stop after finding six editorial frames.`,
          'Set hasBurnedInCaptions true whenever any sampled frame contains pre-existing subtitle text near the bottom, even if it is small. Do not classify those subtitles as editorialFrames; return their normalized y and height as sourceCaptionBand.',
          'If frames are only talking heads or unclear, return hasScreenRecording false and no regions.',
        ],
      }),
    },
    ...indexedFrames.flatMap(({ frame, index }) => ([
      {
        type: 'text',
        text: `FRAME_INDEX=${index}; TIMESTAMP_SECONDS=${Number(frame.t).toFixed(2)}; SCENE_BOUNDARY=${Boolean(frame.sceneBoundary)}`,
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${fs.readFileSync(frame.path).toString('base64')}`,
        },
      },
    ])),
  ];

  return createJsonCompletion({
    model: getVisionModel(),
    schemaName: 'candidate_visual_verification',
    schema: visualSchema,
    maxTokens: 2500,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  }).then((classification) => sanitizeFrameClassification(classification, totalFrameCount));
}

function preferredValue(classifications, field, order) {
  return classifications
    .map((classification) => classification[field])
    .sort((left, right) => order.indexOf(right) - order.indexOf(left))[0];
}

function mergeFrameClassifications(classifications, frameCount) {
  const sourceCaptionClassification = classifications.find((item) => item.hasBurnedInCaptions);
  return sanitizeFrameClassification({
    hasScreenRecording: classifications.some((item) => item.hasScreenRecording),
    confidence: Math.max(0, ...classifications.map((item) => Number(item.confidence || 0))),
    summary: [...new Set(classifications.map((item) => item.summary).filter(Boolean))].join(' '),
    regions: classifications.flatMap((item) => item.regions || []),
    speakerRegions: classifications.flatMap((item) => item.speakerRegions || []),
    editorialFrames: classifications.flatMap((item) => item.editorialFrames || []),
    hasBurnedInCaptions: Boolean(sourceCaptionClassification),
    sourceCaptionBand: sourceCaptionClassification?.sourceCaptionBand || { y: 0.84, height: 0.14 },
    primarySubject: preferredValue(
      classifications,
      'primarySubject',
      ['unclear', 'object', 'speaker', 'screen', 'speaker_and_screen'],
    ) || 'unclear',
    compositionHint: preferredValue(
      classifications,
      'compositionHint',
      ['speaker_focus', 'screen_focus', 'speaker_plus_screen', 'safe_contain'],
    ) || 'safe_contain',
  }, frameCount);
}

async function classifyFrames(candidate, frames) {
  if (frames.length === 0) {
    return {
      hasScreenRecording: false,
      confidence: 0,
      summary: 'No video frames were available for this candidate.',
      regions: [],
      speakerRegions: [],
      editorialFrames: [],
      hasBurnedInCaptions: false,
      sourceCaptionBand: { y: 0.84, height: 0.14 },
      primarySubject: 'unclear',
      compositionHint: 'safe_contain',
    };
  }

  const indexedFrames = frames.map((frame, index) => ({ frame, index }));
  const classifications = [];
  const batchSize = Math.max(1, Math.min(6, Number(process.env.VISUAL_CLASSIFICATION_BATCH_SIZE || 6)));
  // Keep requests sequential inside one clip so the existing candidate-level
  // fan-out remains the only source of vision API concurrency.
  for (let offset = 0; offset < indexedFrames.length; offset += batchSize) {
    classifications.push(await classifyFrameBatch(
      candidate,
      indexedFrames.slice(offset, offset + batchSize),
      frames.length,
    ));
  }
  return mergeFrameClassifications(classifications, frames.length);
}

function sanitizeIndexedItems(items, frameCount, identity) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((item) => Number.isInteger(item?.frameIndex) && item.frameIndex >= 0 && item.frameIndex < frameCount)
    .filter((item) => {
      const key = identity(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sanitizeFrameClassification(classification, frameCount) {
  return {
    ...classification,
    regions: sanitizeIndexedItems(classification?.regions, frameCount, (item) => `${item.frameIndex}:${item.label}`),
    speakerRegions: sanitizeIndexedItems(classification?.speakerRegions, frameCount, (item) => `${item.frameIndex}:${item.label}`),
    editorialFrames: sanitizeIndexedItems(classification?.editorialFrames, frameCount, (item) => `${item.frameIndex}:${item.type}`),
  };
}

async function verifyCandidateVisuals(candidate, episode) {
  const extraction = await extractCandidateFrames(episode, candidate);
  const frames = extraction.frames;
  const frameDir = frames[0] ? path.dirname(frames[0].path) : null;

  try {
    if (extraction.skipped) {
      return {
        candidateId: candidate.id,
        method: 'ffmpeg-scene-change-openrouter-vision',
        skipped: true,
        skippedReason: extraction.reason,
        sampledFrames: [],
        sampledFrameCount: 0,
        hasScreenRecording: false,
        regions: [],
        speakerRegions: [],
        editorialFrames: [],
        hasBurnedInCaptions: false,
        sourceCaptionBand: { y: 0.84, height: 0.14 },
        primarySubject: 'unclear',
        compositionHint: 'safe_contain',
        confidence: 0,
      };
    }

    const classification = await classifyFrames(candidate, frames);
    return {
      candidateId: candidate.id,
      method: 'ffmpeg-scene-change-openrouter-vision',
      skipped: extraction.skipped,
      skippedReason: extraction.reason,
      sampledFrames: frames.map((frame, index) => ({
        index,
        t: frame.t,
        sceneBoundary: Boolean(frame.sceneBoundary),
        sceneEndT: frame.sceneEndT,
        description: classification.summary,
      })),
      sampledFrameCount: frames.length,
      hasScreenRecording: classification.hasScreenRecording,
      regions: classification.regions,
      speakerRegions: classification.speakerRegions,
      editorialFrames: classification.editorialFrames,
      hasBurnedInCaptions: classification.hasBurnedInCaptions,
      sourceCaptionBand: classification.sourceCaptionBand,
      primarySubject: classification.primarySubject,
      compositionHint: classification.compositionHint,
      confidence: classification.confidence,
    };
  } finally {
    if (frameDir) await fsp.rm(frameDir, { recursive: true, force: true });
  }
}

module.exports = {
  provider: 'openrouter-vision',
  verifyCandidateVisuals,
  _test: {
    mergeFrameClassifications,
    sanitizeFrameClassification,
  },
};
