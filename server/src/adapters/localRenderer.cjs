const { createId } = require('../utils/ids.cjs');
const { buildRemotionCaptionLines } = require('../captions/remotionCaptions.cjs');

function wordsForCandidate(episode, candidate) {
  const duration = Math.max(1, candidate.end - candidate.start);
  return (episode.transcript?.words || [])
    .filter((word) => word.end >= candidate.start && word.start <= candidate.end)
    .map((word) => ({
      word: word.word,
      start: Number(Math.max(0, word.start - candidate.start).toFixed(2)),
      end: Number(Math.min(duration, Math.max(0.05, word.end - candidate.start)).toFixed(2)),
      speaker: word.speaker,
    }));
}

function groupCaptionLines(words, wordsPerLine = 3) {
  const lines = [];
  for (let index = 0; index < words.length; index += wordsPerLine) {
    const lineWords = words.slice(index, index + wordsPerLine);
    if (lineWords.length === 0) continue;
    lines.push({
      text: lineWords.map((word) => word.word).join(' '),
      start: lineWords[0].start,
      end: lineWords[lineWords.length - 1].end,
      words: lineWords,
    });
  }
  return lines;
}

function buildActiveSpeakerTimeline(words, duration) {
  const timeline = [];
  for (const word of words) {
    if (!word.speaker) continue;
    const start = clamp(Number(word.start), 0, duration);
    const end = clamp(Number(word.end), start + 0.05, duration);
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

  return timeline.filter((segment) => segment.end > segment.start);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildSpeakerTrack(visualVerification, renderStart, duration) {
  const speakerRegions = visualVerification?.speakerRegions || [];
  const sampledFrames = visualVerification?.sampledFrames || [];
  if (!speakerRegions.length) return [];

  const points = speakerRegions
    .map((region, index) => {
      const frame = sampledFrames.find((sample) => sample.index === region.frameIndex);
      const fallbackT = duration * (index / Math.max(1, speakerRegions.length - 1));
      const t = frame?.t === undefined ? fallbackT : Number(frame.t) - renderStart;
      return {
        t: Number(clamp(t, 0, duration).toFixed(2)),
        x: Number(clamp((region.x || 0) + (region.width || 0) / 2, 0.18, 0.82).toFixed(4)),
        y: Number(clamp((region.y || 0) + (region.height || 0) / 2, 0.16, 0.86).toFixed(4)),
        width: Number(clamp(region.width || 0.25, 0.08, 0.8).toFixed(4)),
        height: Number(clamp(region.height || 0.35, 0.08, 0.95).toFixed(4)),
      };
    })
    .sort((a, b) => a.t - b.t);

  const deduped = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.t - point.t) < 0.1) {
      last.x = Number(((last.x + point.x) / 2).toFixed(4));
      last.y = Number(((last.y + point.y) / 2).toFixed(4));
      continue;
    }
    deduped.push(point);
  }

  if (!deduped.length) return [];
  const first = deduped[0];
  const last = deduped[deduped.length - 1];
  if (first.t > 0) deduped.unshift({ ...first, t: 0 });
  if (last.t < duration) deduped.push({ ...last, t: Number(duration.toFixed(2)) });
  return deduped.slice(0, 10);
}

function paddedRegion(region, padding, minWidth = 0.12, minHeight = 0.12) {
  if (!region) return null;
  const width = clamp((region.width || minWidth) + padding * 2, minWidth, 1);
  const height = clamp((region.height || minHeight) + padding * 2, minHeight, 1);
  const centerX = clamp((region.x || 0) + (region.width || width) / 2, 0, 1);
  const centerY = clamp((region.y || 0) + (region.height || height) / 2, 0, 1);
  return {
    x: Number(clamp(centerX - width / 2, 0, 1 - width).toFixed(4)),
    y: Number(clamp(centerY - height / 2, 0, 1 - height).toFixed(4)),
    width: Number(width.toFixed(4)),
    height: Number(height.toFixed(4)),
  };
}

function primaryVisualRegion(visualVerification) {
  const regions = visualVerification?.regions || [];
  if (!regions.length) return null;
  const sorted = [...regions].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  return sorted.find((region) => {
    const area = (region.width || 0) * (region.height || 0);
    return area >= 0.18 && area <= 0.88;
  }) || sorted[0];
}

function primarySpeakerRegion(visualVerification) {
  const regions = visualVerification?.speakerRegions || [];
  if (!regions.length) return null;
  return [...regions].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
}

function visualRegionFrameRatio(visualVerification) {
  const sampledFrames = visualVerification?.sampledFrames || [];
  const visualRegions = visualVerification?.regions || [];
  if (!sampledFrames.length || !visualRegions.length) return 0;
  const visualFrameIndexes = new Set(
    visualRegions
      .map((region) => Number(region.frameIndex))
      .filter(Number.isFinite),
  );
  return visualFrameIndexes.size / sampledFrames.length;
}

function overlapRatio(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(a.x || 0, b.x || 0);
  const right = Math.min((a.x || 0) + (a.width || 0), (b.x || 0) + (b.width || 0));
  const top = Math.max(a.y || 0, b.y || 0);
  const bottom = Math.min((a.y || 0) + (a.height || 0), (b.y || 0) + (b.height || 0));
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const speakerArea = Math.max(0.001, (b.width || 0) * (b.height || 0));
  return overlap / speakerArea;
}

async function createRenderPlan(episode, candidate, visualVerification, sceneScript) {
  const duration = Math.max(3, Math.min(58, candidate.end - candidate.start));
  const captionWords = wordsForCandidate(episode, candidate);
  let upgradedCaptions = null;
  try {
    upgradedCaptions = await buildRemotionCaptionLines(captionWords);
  } catch (error) {
    console.warn(`Remotion caption pagination unavailable; using legacy captions: ${error.message}`);
  }
  const captionStyle = {
    wordsPerLine: 3,
    primaryColor: 'white',
    highlightColor: '#ffd447',
    position: 'bottom',
    safeArea: {
      x: 80,
      y: 1340,
      width: 920,
      height: 360,
    },
    fontSize: 74,
    maxLines: 2,
    boxOpacity: upgradedCaptions ? 0 : 0.72,
    engine: upgradedCaptions?.engine || 'legacy_ass',
    wordHighlight: Boolean(upgradedCaptions),
  };
  const hasSpeakerRegion = Boolean(visualVerification?.speakerRegions?.length);
  const hasVisualRegion = Boolean(visualVerification?.regions?.length);
  const speakerTrack = buildSpeakerTrack(visualVerification, candidate.start, duration);
  const activeSpeakerTimeline = buildActiveSpeakerTimeline(captionWords, duration);
  const requestedCompositionHint = process.env.FORCE_RENDER_COMPOSITION_HINT || visualVerification?.compositionHint;
  const visualFocus = paddedRegion(primaryVisualRegion(visualVerification), 0.02);
  const speakerOverlay = paddedRegion(primarySpeakerRegion(visualVerification), 0.045, 0.16, 0.22);
  const speakerAlreadyInsideVisual = overlapRatio(visualFocus, speakerOverlay) > 0.25;
  const persistentVisualRegion = visualRegionFrameRatio(visualVerification) >= 0.45;
  let compositionMode = 'safe_contain_blur';
  if (requestedCompositionHint === 'speaker_focus' && hasSpeakerRegion) {
    compositionMode = 'speaker_focus_crop';
  } else if (
    requestedCompositionHint === 'speaker_plus_screen'
    && hasSpeakerRegion
    && hasVisualRegion
    && persistentVisualRegion
    && !speakerAlreadyInsideVisual
  ) {
    compositionMode = 'speaker_plus_screen';
  } else if (hasSpeakerRegion && !persistentVisualRegion) {
    // A podcast remains speaker-focused when graphics, articles, or B-roll only
    // appear briefly. The render worker preserves those exact intervals without
    // forcing the entire clip into a horizontal-on-blur composition.
    compositionMode = 'speaker_focus_crop';
  }
  const composition = {
    mode: compositionMode,
    reason: compositionMode === 'speaker_plus_screen'
      ? 'Compose detected screen/demo content as the main panel with the speaker preserved as an overlay.'
      : compositionMode === 'speaker_focus_crop' && requestedCompositionHint === 'speaker_plus_screen'
        ? 'Keep the podcast speaker full-frame; preserve transient graphics only during their detected intervals.'
      : visualVerification?.hasScreenRecording
        ? speakerAlreadyInsideVisual
          ? 'Preserve full source because the speaker is already inside the detected screen/demo region.'
          : 'Preserve screen/demo regions and avoid destructive vertical crop.'
        : requestedCompositionHint === 'speaker_focus'
        ? 'Speaker-focused clip detected; using low-cost static speaker crop from sampled frame metadata.'
        : 'Preserve speaker framing until face-aware crop tracking is available.',
    canvas: { width: 1080, height: 1920 },
    foreground: {
      fit: 'contain',
      maxWidth: 1040,
      maxHeight: visualVerification?.hasScreenRecording ? 1120 : 1240,
      y: visualVerification?.hasScreenRecording ? 170 : 130,
    },
    background: {
      type: 'blurred_source_fill',
      blurSigma: 34,
      dim: 0.18,
    },
    detectedRegions: {
      speaker: visualVerification?.speakerRegions || [],
      visual: visualVerification?.regions || [],
      primarySubject: visualVerification?.primarySubject || 'unclear',
      compositionHint: requestedCompositionHint || 'safe_contain',
      visualRegionFrameRatio: Number(visualRegionFrameRatio(visualVerification).toFixed(4)),
    },
    speakerPlusScreen: {
      visualFocus,
      speakerOverlay,
      visualPanel: { x: 40, y: 120, width: 1000, height: 760 },
      speakerPanel: { x: 660, y: 780, width: 360, height: 500 },
    },
    speakerTrack,
    activeSpeakerTimeline,
    captionSafeArea: captionStyle.safeArea,
  };

  return {
    id: createId('render_plan'),
    aspectRatio: '9:16',
    start: candidate.start,
    end: candidate.start + duration,
    duration,
    boundaryRefinement: candidate.boundaryRefinement || null,
    captionTrack: {
      style: captionStyle,
      words: captionWords,
      lines: upgradedCaptions?.lines || groupCaptionLines(captionWords, captionStyle.wordsPerLine),
      engine: upgradedCaptions?.engine || 'legacy_ass',
      version: upgradedCaptions?.version || 'legacy_v1',
    },
    captionStyle,
    footage: {
      sourceAssetKey: episode.source.assetKey,
      reframing: compositionMode,
    },
    composition,
    broll: candidate.category === 'show_and_tell' ? ['product mockup', 'app dashboard'] : [],
    animation: sceneScript && sceneScript.confidence >= 0.78 ? { type: 'ui_flow', sceneScript } : null,
    visualVerification,
  };
}

async function renderClip(episode, candidate, renderPlan) {
  return {
    outputAssetKey: `renders/${episode.id}/${candidate.id}.mp4`,
    previewUrl: null,
    renderProvider: 'local-dev-render-plan',
    status: 'planned',
    note: 'Production renderer submits this plan to the FFmpeg and Remotion Cloud Run render worker.',
    renderPlan,
  };
}

module.exports = {
  createRenderPlan,
  buildSpeakerTrack,
  buildActiveSpeakerTimeline,
  renderClip,
};
