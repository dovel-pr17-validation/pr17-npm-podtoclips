const assert = require('node:assert/strict');
const test = require('node:test');
const { _test } = require('./remotionCaptions.cjs');

test('caption pages use one fixed font size to prevent vertical jumping', () => {
  assert.equal(_test.responsiveFontSize('Short caption'), 74);
  assert.equal(_test.responsiveFontSize('This is a substantially longer caption page'), 74);
});

test('caption tokens are constrained by word and character limits', () => {
  const oldWords = process.env.REMOTION_CAPTION_MAX_WORDS;
  process.env.REMOTION_CAPTION_MAX_WORDS = '3';
  const chunks = _test.chunkTokens([
    { text: ' one', fromMs: 0, toMs: 100 },
    { text: ' two', fromMs: 100, toMs: 200 },
    { text: ' three', fromMs: 200, toMs: 300 },
    { text: ' four', fromMs: 300, toMs: 400 },
  ]);
  if (oldWords === undefined) delete process.env.REMOTION_CAPTION_MAX_WORDS;
  else process.env.REMOTION_CAPTION_MAX_WORDS = oldWords;
  assert.deepEqual(chunks.map((chunk) => chunk.map((word) => word.word)), [['one', 'two', 'three'], ['four']]);
});

test('caption chunks end at natural phrase boundaries', () => {
  const chunks = _test.chunkTokens([
    { text: ' your', fromMs: 0, toMs: 100 },
    { text: ' hand', fromMs: 100, toMs: 200 },
    { text: ' out,', fromMs: 200, toMs: 300 },
    { text: ' please.', fromMs: 300, toMs: 400 },
    { text: ' Now,', fromMs: 400, toMs: 500 },
    { text: ' look', fromMs: 500, toMs: 600 },
  ]);
  assert.deepEqual(chunks.map((chunk) => chunk.map((word) => word.word)), [
    ['your', 'hand', 'out,', 'please.'],
    ['Now,', 'look'],
  ]);
});

test('caption line breaks prefer nearby punctuation', () => {
  assert.equal(_test.preferredBreakIndex([
    { word: 'Make' },
    { word: 'it' },
    { word: 'clear,' },
    { word: 'then' },
    { word: 'continue' },
  ]), 3);
});
