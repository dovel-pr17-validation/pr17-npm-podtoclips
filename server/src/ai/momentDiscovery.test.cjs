const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildFullTranscriptWindows,
  finalMomentScore,
  rankSelections,
} = require('./momentDiscovery.cjs');

function timedWords(count, secondsPerWord = 0.4) {
  return Array.from({ length: count }, (_, index) => ({
    word: `word${index}`,
    start: index * secondsPerWord,
    end: index * secondsPerWord + secondsPerWord - 0.04,
    speaker: index % 40 < 8 ? 'Host' : 'Guest',
  }));
}

test('full-transcript discovery covers the beginning, middle, and end', () => {
  const words = timedWords(3000);
  const windows = buildFullTranscriptWindows(words);
  assert.equal(windows[0].startWordIndex, 0);
  assert.ok(windows.some((window) => window.startWordIndex > words.length * 0.45));
  assert.ok(windows[windows.length - 1].endWordIndex >= words.length - 2);
  assert.ok(windows.every((window) => window.speaker_turns.length > 0));
});

test('very long podcasts retain full coverage within the request-size cap', () => {
  const words = timedWords(36000);
  const windows = buildFullTranscriptWindows(words);
  assert.ok(windows.length <= 240);
  assert.equal(windows[0].startWordIndex, 0);
  assert.ok(windows[windows.length - 1].endWordIndex >= words.length - 2);
});

test('final score gives sixty percent weight to attention and retention', () => {
  const score = finalMomentScore({
    engagement_score: 1,
    virality_score: 1,
    retention_score: 1,
    insight_score: 0,
    surprise_score: 0,
    clarity_score: 0,
    context_score: 0,
  });
  assert.equal(score, 0.6);
});

test('global ranking rejects shallow virality and preserves strong unique insight', () => {
  const candidates = [
    { id: 'shallow', title: 'Shallow' },
    { id: 'strong', title: 'Strong' },
  ];
  const selected = rankSelections(candidates, [
    {
      candidate_index: 0, engagement_score: 0.98, virality_score: 0.95,
      retention_score: 0.9, insight_score: 0.2, surprise_score: 0.4,
      clarity_score: 0.9, context_score: 0.9, reasoning: 'Loud but shallow.',
    },
    {
      candidate_index: 1, engagement_score: 0.88, virality_score: 0.84,
      retention_score: 0.86, insight_score: 0.9, surprise_score: 0.82,
      clarity_score: 0.84, context_score: 0.9, reasoning: 'Surprising complete insight.',
    },
  ]);
  assert.deepEqual(selected.map((candidate) => candidate.id), ['strong']);
  assert.equal(selected[0].qualitySignals.version, 'global_engagement_insight_v1');
});
