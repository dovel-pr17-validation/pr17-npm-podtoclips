const DEFAULTS = {
  windowSeconds: 40,
  strideSeconds: 25,
  maximumWindows: 240,
  minimumWords: 12,
};

function config() {
  return {
    windowSeconds: Number(process.env.MOMENT_DISCOVERY_WINDOW_SECONDS || DEFAULTS.windowSeconds),
    strideSeconds: Number(process.env.MOMENT_DISCOVERY_STRIDE_SECONDS || DEFAULTS.strideSeconds),
    maximumWindows: Number(process.env.MOMENT_DISCOVERY_MAX_WINDOWS || DEFAULTS.maximumWindows),
    minimumWords: Number(process.env.MOMENT_DISCOVERY_MIN_WORDS || DEFAULTS.minimumWords),
  };
}

function speakerTurns(words) {
  const turns = [];
  for (const word of words) {
    const speaker = word.speaker || 'Unknown speaker';
    const current = turns[turns.length - 1];
    if (current?.speaker === speaker) {
      current.text += ` ${word.word}`;
      current.end = Number(word.end);
    } else {
      turns.push({
        speaker,
        start: Number(word.start),
        end: Number(word.end),
        text: String(word.word || ''),
      });
    }
  }
  return turns;
}

function buildFullTranscriptWindows(words) {
  if (!Array.isArray(words) || !words.length) return [];
  const settings = config();
  const transcriptStart = Math.max(0, Number(words[0].start || 0));
  const transcriptEnd = Number(words[words.length - 1].end || 0);
  const transcriptDuration = Math.max(0, transcriptEnd - transcriptStart);
  // Keep request size bounded without ever truncating a long podcast. For
  // ordinary episodes the configured 40s/25s overlapping windows are used;
  // longer episodes widen both values just enough to retain full coverage.
  const effectiveStride = Math.max(
    settings.strideSeconds,
    transcriptDuration / Math.max(1, settings.maximumWindows),
  );
  const effectiveWindow = Math.max(settings.windowSeconds, effectiveStride + 15);
  const windows = [];
  let startWordIndex = 0;
  let endWordIndex = 0;

  for (
    let startTime = transcriptStart;
    startTime < transcriptEnd && windows.length < settings.maximumWindows;
    startTime += effectiveStride
  ) {
    const endTime = startTime + effectiveWindow;
    while (startWordIndex < words.length && Number(words[startWordIndex].end) < startTime) startWordIndex += 1;
    if (endWordIndex < startWordIndex) endWordIndex = startWordIndex;
    while (endWordIndex < words.length && Number(words[endWordIndex].start) <= endTime) endWordIndex += 1;
    const windowWords = words.slice(startWordIndex, endWordIndex);
    if (windowWords.length < settings.minimumWords) continue;
    windows.push({
      window_index: windows.length,
      startWordIndex,
      endWordIndex: endWordIndex - 1,
      start: Number(windowWords[0].start),
      end: Number(windowWords[windowWords.length - 1].end),
      text: windowWords.map((word) => word.word).join(' '),
      speaker_turns: speakerTurns(windowWords),
    });
  }
  return windows;
}

function finalMomentScore(selection) {
  return Number((
    Number(selection.engagement_score || 0) * 0.25
    + Number(selection.virality_score || 0) * 0.2
    + Number(selection.retention_score || 0) * 0.15
    + Number(selection.insight_score || 0) * 0.18
    + Number(selection.surprise_score || 0) * 0.12
    + Number(selection.clarity_score || 0) * 0.05
    + Number(selection.context_score || 0) * 0.05
  ).toFixed(4));
}

function meetsQualityFloor(selection) {
  return Number(selection.engagement_score || 0) >= Number(process.env.MOMENT_MIN_ENGAGEMENT || 0.7)
    && Number(selection.virality_score || 0) >= Number(process.env.MOMENT_MIN_VIRALITY || 0.62)
    && Number(selection.retention_score || 0) >= Number(process.env.MOMENT_MIN_RETENTION || 0.62)
    && Math.max(Number(selection.insight_score || 0), Number(selection.surprise_score || 0)) >= 0.65
    && Number(selection.clarity_score || 0) >= 0.55
    && Number(selection.context_score || 0) >= 0.55;
}

function rankSelections(candidates, selections, limit = 8) {
  const seen = new Set();
  return (selections || [])
    .map((selection) => {
      const index = Number(selection.candidate_index);
      const candidate = candidates[index];
      if (!candidate || seen.has(index) || !meetsQualityFloor(selection)) return null;
      seen.add(index);
      const score = finalMomentScore(selection);
      return {
        ...candidate,
        confidence: score,
        reasoning: selection.reasoning || candidate.reasoning,
        qualitySignals: {
          version: 'global_engagement_insight_v1',
          engagement: Number(selection.engagement_score),
          virality: Number(selection.virality_score),
          retention: Number(selection.retention_score),
          uniqueInsight: Number(selection.insight_score),
          surprise: Number(selection.surprise_score),
          clarity: Number(selection.clarity_score),
          context: Number(selection.context_score),
          finalScore: score,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

module.exports = {
  buildFullTranscriptWindows,
  config,
  finalMomentScore,
  meetsQualityFloor,
  rankSelections,
};
