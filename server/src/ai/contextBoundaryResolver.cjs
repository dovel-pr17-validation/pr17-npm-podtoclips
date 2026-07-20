const DEFAULTS = {
  contextBeforeSeconds: 12,
  contextAfterSeconds: 18,
  fallbackBeforeSeconds: 8,
  fallbackAfterSeconds: 12,
  minimumDurationSeconds: 20,
  maximumDurationSeconds: 58,
  pauseBoundarySeconds: 0.65,
  preRollSeconds: 0.2,
  postRollSeconds: 0.35,
};

function config() {
  return {
    contextBeforeSeconds: Number(process.env.CONTEXT_BOUNDARY_BEFORE_SECONDS || DEFAULTS.contextBeforeSeconds),
    contextAfterSeconds: Number(process.env.CONTEXT_BOUNDARY_AFTER_SECONDS || DEFAULTS.contextAfterSeconds),
    fallbackBeforeSeconds: Number(process.env.CONTEXT_BOUNDARY_FALLBACK_BEFORE_SECONDS || DEFAULTS.fallbackBeforeSeconds),
    fallbackAfterSeconds: Number(process.env.CONTEXT_BOUNDARY_FALLBACK_AFTER_SECONDS || DEFAULTS.fallbackAfterSeconds),
    minimumDurationSeconds: Number(process.env.CONTEXT_BOUNDARY_MIN_SECONDS || DEFAULTS.minimumDurationSeconds),
    maximumDurationSeconds: Number(process.env.CONTEXT_BOUNDARY_MAX_SECONDS || DEFAULTS.maximumDurationSeconds),
    pauseBoundarySeconds: Number(process.env.CONTEXT_BOUNDARY_PAUSE_SECONDS || DEFAULTS.pauseBoundarySeconds),
    preRollSeconds: Number(process.env.CONTEXT_BOUNDARY_PRE_ROLL_SECONDS || DEFAULTS.preRollSeconds),
    postRollSeconds: Number(process.env.CONTEXT_BOUNDARY_POST_ROLL_SECONDS || DEFAULTS.postRollSeconds),
  };
}

function cleanWord(word) {
  return String(word?.word || '').trim();
}

function sentenceEnds(word) {
  return /[.!?]["'’”)]?$/.test(cleanWord(word));
}

function incompleteEnding(word) {
  const token = cleanWord(word).toLowerCase().replace(/[^a-z']/g, '');
  return new Set([
    'and', 'but', 'because', 'so', 'if', 'when', 'while', 'which', 'that',
    'then', 'than', 'to', 'the', 'a', 'an', 'of', 'for', 'with', 'or', 'as',
  ]).has(token);
}

function normalizedWord(word) {
  return cleanWord(word).toLowerCase().replace(/[^a-z']/g, '');
}

function dependentOpening(words, startIndex) {
  const first = normalizedWord(words[startIndex]);
  const second = normalizedWord(words[startIndex + 1]);
  return ['yes', 'yeah', 'yep', 'no', 'nope'].includes(first)
    || (first === 'and' && second === 'then');
}

function boundaryAfter(words, index, pauseSeconds) {
  if (index < 0 || index >= words.length) return false;
  if (sentenceEnds(words[index]) && !incompleteEnding(words[index])) return true;
  const next = words[index + 1];
  if (!next) return true;
  const pause = Number(next.start) - Number(words[index].end);
  return pause >= pauseSeconds && !incompleteEnding(words[index]);
}

function firstWordIndex(words, time) {
  const index = words.findIndex((word) => Number(word.end) >= Number(time));
  return index === -1 ? Math.max(0, words.length - 1) : index;
}

function lastWordIndex(words, time) {
  let selected = 0;
  for (let index = 0; index < words.length; index += 1) {
    if (Number(words[index].start) <= Number(time)) selected = index;
    else break;
  }
  return selected;
}

function contextForCandidate(words, candidate, candidateIndex) {
  const settings = config();
  const contextStart = Math.max(0, Number(candidate.start) - settings.contextBeforeSeconds);
  const contextEnd = Number(candidate.end) + settings.contextAfterSeconds;
  const startIndex = firstWordIndex(words, contextStart);
  const endIndex = lastWordIndex(words, contextEnd);
  return {
    candidateIndex,
    coreStartIndex: firstWordIndex(words, candidate.start),
    coreEndIndex: lastWordIndex(words, candidate.end),
    contextStartIndex: startIndex,
    contextEndIndex: endIndex,
    words: words.slice(startIndex, endIndex + 1).map((word, offset) => ({
      index: startIndex + offset,
      word: cleanWord(word),
      start: Number(word.start),
      end: Number(word.end),
      speaker: word.speaker || null,
    })),
  };
}

function fallbackIndexes(words, candidate) {
  const settings = config();
  const coreStart = firstWordIndex(words, candidate.start);
  const coreEnd = lastWordIndex(words, candidate.end);
  const earliest = Number(candidate.start) - settings.fallbackBeforeSeconds;
  const latest = Number(candidate.end) + settings.fallbackAfterSeconds;
  let startIndex = coreStart;
  let endIndex = coreEnd;

  for (let index = coreStart - 1; index >= 0 && Number(words[index].end) >= earliest; index -= 1) {
    if (boundaryAfter(words, index, settings.pauseBoundarySeconds)) {
      startIndex = index + 1;
      break;
    }
    if (words[index + 1]?.speaker && words[index]?.speaker !== words[index + 1]?.speaker) {
      startIndex = index + 1;
      break;
    }
    startIndex = index;
  }

  for (let index = coreEnd; index < words.length && Number(words[index].end) <= latest; index += 1) {
    endIndex = index;
    if (boundaryAfter(words, index, settings.pauseBoundarySeconds)) break;
  }
  return { startIndex, endIndex };
}

function clampIndexesToDuration(words, startIndex, endIndex) {
  const settings = config();
  let start = Math.max(0, Math.min(startIndex, words.length - 1));
  let end = Math.max(start, Math.min(endIndex, words.length - 1));
  const maximumWordDuration = Math.max(1, settings.maximumDurationSeconds - settings.preRollSeconds - settings.postRollSeconds);

  const duration = () => Number(words[end].end) - Number(words[start].start);
  if (duration() > maximumWordDuration) {
    const earliestAllowed = Number(words[end].end) - maximumWordDuration;
    let candidateStart = firstWordIndex(words, earliestAllowed);
    for (let index = candidateStart; index < end; index += 1) {
      if (index === 0 || boundaryAfter(words, index - 1, settings.pauseBoundarySeconds)) {
        candidateStart = index;
        break;
      }
    }
    start = candidateStart;
  }

  return { startIndex: start, endIndex: end };
}

function standaloneStartIndex(words, startIndex) {
  if (!dependentOpening(words, startIndex) || startIndex <= 0) return startIndex;
  const settings = config();
  const earliestTime = Number(words[startIndex].start) - settings.contextBeforeSeconds;
  const currentSpeaker = words[startIndex]?.speaker;
  const previousSpeaker = words[startIndex - 1]?.speaker;
  let expanded = startIndex - 1;

  if (previousSpeaker && previousSpeaker !== currentSpeaker) {
    while (
      expanded > 0
      && words[expanded - 1]?.speaker === previousSpeaker
      && Number(words[expanded - 1].start) >= earliestTime
    ) expanded -= 1;
    return expanded;
  }

  while (
    expanded > 0
    && !boundaryAfter(words, expanded - 1, settings.pauseBoundarySeconds)
    && Number(words[expanded - 1].start) >= earliestTime
  ) expanded -= 1;
  return expanded;
}

function validModelSelection(words, candidate, context, selection) {
  if (!selection) return false;
  const start = Number(selection.start_word_index);
  const end = Number(selection.end_word_index);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return false;
  if (start < context.contextStartIndex || end > context.contextEndIndex) return false;
  const selectionStart = Number(words[start]?.start);
  const selectionEnd = Number(words[end]?.end);
  if (!Number.isFinite(selectionStart) || !Number.isFinite(selectionEnd)) return false;
  const overlapsCore = Math.min(selectionEnd, Number(candidate.end)) - Math.max(selectionStart, Number(candidate.start));
  const includesRequiredQuestion = selection.requires_previous_question !== true
    || words.slice(start, end + 1).some((word) => /\?/.test(cleanWord(word)));
  const selectionDuration = selectionEnd - selectionStart + config().preRollSeconds + config().postRollSeconds;
  const coreDuration = Number(candidate.end) - Number(candidate.start);
  const longEnough = coreDuration < config().minimumDurationSeconds
    || selectionDuration >= config().minimumDurationSeconds;
  return overlapsCore > 0
    && selection.starts_cleanly !== false
    && selection.context_complete !== false
    && selection.ends_cleanly !== false
    && includesRequiredQuestion
    && longEnough
    && selectionDuration <= config().maximumDurationSeconds
    && boundaryAfter(words, end, config().pauseBoundarySeconds)
    && Number(selection.confidence ?? 1) >= 0.5;
}

function applyIndexes(words, candidate, indexes, metadata) {
  const settings = config();
  const expandedStartIndex = standaloneStartIndex(words, indexes.startIndex);
  const safe = clampIndexesToDuration(words, expandedStartIndex, indexes.endIndex);
  const selectedWords = words.slice(safe.startIndex, safe.endIndex + 1);
  const transcriptDuration = Number(words[words.length - 1]?.end || selectedWords[selectedWords.length - 1]?.end || 0);
  const selectedStart = Number(selectedWords[0].start);
  const selectedEnd = Number(selectedWords[selectedWords.length - 1].end);
  const previousEnd = Number(words[safe.startIndex - 1]?.end);
  const nextStart = Number(words[safe.endIndex + 1]?.start);
  const paddedStart = selectedStart - settings.preRollSeconds;
  const paddedEnd = selectedEnd + settings.postRollSeconds;
  const speechSafeStart = Number.isFinite(previousEnd)
    ? Math.max(paddedStart, Math.min(selectedStart, previousEnd + 0.03))
    : paddedStart;
  const speechSafeEnd = Number.isFinite(nextStart)
    ? Math.min(paddedEnd, Math.max(selectedEnd, nextStart - 0.03))
    : paddedEnd;
  const start = Math.max(0, speechSafeStart);
  const end = Math.min(transcriptDuration, speechSafeEnd);
  return {
    ...candidate,
    start: Number(start.toFixed(2)),
    end: Number(end.toFixed(2)),
    transcript: selectedWords.map((word) => cleanWord(word)).join(' '),
    boundaryRefinement: {
      version: 'context_safe_v1',
      originalStart: candidate.start,
      originalEnd: candidate.end,
      startWordIndex: safe.startIndex,
      endWordIndex: safe.endIndex,
      autoExpandedStart: expandedStartIndex < indexes.startIndex,
      originalSelectedStartWordIndex: indexes.startIndex,
      durationSeconds: Number((end - start).toFixed(2)),
      ...metadata,
    },
  };
}

function refineCandidates(words, candidates, selections = []) {
  if (!Array.isArray(words) || !words.length) return candidates;
  const selectionMap = new Map(selections.map((selection) => [Number(selection.candidate_index), selection]));
  return candidates.map((candidate, candidateIndex) => {
    const context = contextForCandidate(words, candidate, candidateIndex);
    const selection = selectionMap.get(candidateIndex);
    if (validModelSelection(words, candidate, context, selection)) {
      return applyIndexes(words, candidate, {
        startIndex: Number(selection.start_word_index),
        endIndex: Number(selection.end_word_index),
      }, {
        method: 'gemini_context_boundary',
        confidence: Number(selection.confidence),
        startsCleanly: selection.starts_cleanly,
        endsCleanly: selection.ends_cleanly,
        contextComplete: selection.context_complete,
        requiresPreviousQuestion: selection.requires_previous_question,
        containsConclusion: selection.contains_conclusion,
        reasoning: selection.reasoning,
      });
    }
    return applyIndexes(words, candidate, fallbackIndexes(words, candidate), {
      method: 'deterministic_sentence_pause_fallback',
      confidence: 0.45,
      contextComplete: null,
      reasoning: selection ? 'Model boundary failed local validation.' : 'Model boundary was unavailable.',
    });
  });
}

module.exports = {
  config,
  contextForCandidate,
  refineCandidates,
  _test: {
    boundaryAfter,
    clampIndexesToDuration,
    fallbackIndexes,
    incompleteEnding,
    dependentOpening,
    standaloneStartIndex,
    sentenceEnds,
    validModelSelection,
  },
};
