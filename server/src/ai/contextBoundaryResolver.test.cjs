const assert = require('node:assert/strict');
const test = require('node:test');
const { contextForCandidate, refineCandidates, _test } = require('./contextBoundaryResolver.cjs');

function timedWords(text, secondsPerWord = 0.5, speaker = 'Speaker A') {
  return text.split(' ').map((word, index) => ({
    word,
    start: index * secondsPerWord,
    end: index * secondsPerWord + secondsPerWord - 0.05,
    speaker,
  }));
}

test('deterministic fallback extends an arbitrary window to a completed sentence', () => {
  const words = timedWords('Setup matters. This is the important explanation because every detail supports the final conclusion. Unrelated topic starts here.');
  const candidate = {
    id: 'moment_1', start: 2, end: 6,
    transcript: 'is the important explanation because every detail',
  };
  const [refined] = refineCandidates(words, [candidate]);
  assert.match(refined.transcript, /final conclusion\./);
  assert.equal(refined.boundaryRefinement.method, 'deterministic_sentence_pause_fallback');
  assert.ok(refined.end > candidate.end);
});

test('valid model word indexes replace arbitrary scoring-window boundaries', () => {
  const words = timedWords('Old setup ends. Here is the complete valuable idea and this is its clear conclusion. A new topic begins now.');
  const candidate = { id: 'moment_2', start: 1, end: 7, transcript: 'scoring window' };
  const context = contextForCandidate(words, candidate, 0);
  const start = words.findIndex((word) => word.word === 'Here');
  const end = words.findIndex((word) => word.word === 'conclusion.');
  const [refined] = refineCandidates(words, [candidate], [{
    candidate_index: 0,
    start_word_index: start,
    end_word_index: end,
    starts_cleanly: true,
    ends_cleanly: true,
    context_complete: true,
    requires_previous_question: false,
    contains_conclusion: true,
    confidence: 0.92,
    reasoning: 'Complete standalone idea.',
  }]);
  assert.ok(start >= context.contextStartIndex && end <= context.contextEndIndex);
  assert.equal(refined.boundaryRefinement.method, 'gemini_context_boundary');
  assert.match(refined.transcript, /^Here is/);
  assert.match(refined.transcript, /conclusion\.$/);
});

test('model selection marked incomplete is rejected locally', () => {
  const words = timedWords('First sentence ends. The important answer reaches a complete conclusion. Another sentence follows.');
  const candidate = { id: 'moment_3', start: 2, end: 5, transcript: 'important answer' };
  const [refined] = refineCandidates(words, [candidate], [{
    candidate_index: 0,
    start_word_index: 2,
    end_word_index: 5,
    starts_cleanly: true,
    ends_cleanly: false,
    context_complete: false,
    requires_previous_question: false,
    contains_conclusion: false,
    confidence: 0.9,
    reasoning: 'Incomplete.',
  }]);
  assert.equal(refined.boundaryRefinement.method, 'deterministic_sentence_pause_fallback');
});

test('hard duration cap keeps the ending and moves the start forward', () => {
  const words = timedWords(Array.from({ length: 140 }, (_, index) => index === 139 ? 'conclusion.' : `word${index}`).join(' '), 0.5);
  const safe = _test.clampIndexesToDuration(words, 0, 139);
  assert.equal(safe.endIndex, 139);
  assert.ok(words[safe.endIndex].end - words[safe.startIndex].start <= 57.45);
});

test('incomplete conjunctions are not considered clean pause boundaries', () => {
  assert.equal(_test.incompleteEnding({ word: 'because' }), true);
  assert.equal(_test.boundaryAfter([
    { word: 'because', start: 0, end: 0.2 },
    { word: 'reason', start: 1.2, end: 1.5 },
  ], 0, 0.65), false);
});

test('dependent answer openings include the preceding speaker turn', () => {
  const words = [
    { word: 'Has', start: 0, end: 0.3, speaker: 'Host' },
    { word: 'success', start: 0.35, end: 0.7, speaker: 'Host' },
    { word: 'changed', start: 0.75, end: 1.1, speaker: 'Host' },
    { word: 'you?', start: 1.15, end: 1.5, speaker: 'Host' },
    { word: 'No,', start: 2, end: 2.25, speaker: 'Guest' },
    { word: 'because', start: 2.3, end: 2.7, speaker: 'Guest' },
    { word: 'everything', start: 2.75, end: 3.2, speaker: 'Guest' },
    { word: 'changes.', start: 3.25, end: 3.7, speaker: 'Guest' },
  ];
  assert.equal(_test.standaloneStartIndex(words, 4), 0);
  const [refined] = refineCandidates(words, [{ start: 2, end: 3.7, transcript: 'No, because everything changes.' }]);
  assert.match(refined.transcript, /^Has success changed you\?/);
  assert.equal(refined.boundaryRefinement.autoExpandedStart, true);
});

test('clip padding never overlaps neighboring speech', () => {
  const words = [
    { word: 'Previous.', start: 0, end: 0.5, speaker: 'A' },
    { word: 'Complete', start: 0.55, end: 1, speaker: 'B' },
    { word: 'thought.', start: 1.05, end: 1.5, speaker: 'B' },
    { word: 'Next', start: 1.55, end: 1.9, speaker: 'B' },
    { word: 'sentence.', start: 1.95, end: 2.4, speaker: 'B' },
  ];
  const [refined] = refineCandidates(words, [{ start: 0.55, end: 1.5, transcript: 'Complete thought.' }], [{
    candidate_index: 0,
    start_word_index: 1,
    end_word_index: 2,
    starts_cleanly: true,
    ends_cleanly: true,
    context_complete: true,
    requires_previous_question: false,
    contains_conclusion: true,
    confidence: 0.9,
    reasoning: 'Complete thought.',
  }]);
  assert.ok(refined.start >= 0.53);
  assert.ok(refined.end <= 1.52);
});

test('model boundaries requiring a question are rejected when no question is included', () => {
  const words = timedWords('The host introduces context. The answer reaches a conclusion.');
  const candidate = { start: 2, end: 4.5, transcript: 'answer reaches a conclusion.' };
  const context = contextForCandidate(words, candidate, 0);
  assert.equal(_test.validModelSelection(words, candidate, context, {
    start_word_index: 4,
    end_word_index: 8,
    starts_cleanly: true,
    ends_cleanly: true,
    context_complete: true,
    requires_previous_question: true,
    confidence: 0.9,
  }), false);
});
