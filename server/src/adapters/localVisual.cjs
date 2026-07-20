async function verifyCandidateVisuals(candidate) {
  const frameCount = candidate.likelyVisual ? 4 : 2;
  return {
    candidateId: candidate.id,
    method: 'scene-change-gated-local-placeholder',
    sampledFrames: Array.from({ length: frameCount }, (_, index) => ({
      t: Number((candidate.start + index * 2.5).toFixed(2)),
      description: candidate.narrativeType === 'ui_flow' ? 'Possible product or screen narration.' : 'Talking-head podcast frame.',
    })),
    hasScreenRecording: false,
    regions: [],
    speakerRegions: [],
    editorialFrames: [],
    hasBurnedInCaptions: false,
    sourceCaptionBand: { y: 0.84, height: 0.14 },
    primarySubject: 'unclear',
    compositionHint: 'safe_contain',
    confidence: candidate.likelyVisual ? 0.72 : 0.54,
  };
}

module.exports = { verifyCandidateVisuals };
