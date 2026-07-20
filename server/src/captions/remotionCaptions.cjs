function upgradesEnabled() {
  return process.env.EASYED_UPGRADES_ENABLED !== '0'
    && process.env.REMOTION_CAPTIONS_ENABLED !== '0';
}

function preferredBreakIndex(words) {
  if (words.length < 4) return null;
  const total = words.reduce((sum, item) => sum + item.word.length + 1, 0);
  let consumed = 0;
  let best = 2;
  let distance = Infinity;
  const punctuationBreaks = [];
  for (let index = 1; index < words.length; index += 1) {
    consumed += words[index - 1].word.length + 1;
    const candidateDistance = Math.abs(total / 2 - consumed);
    if (/[,.!?;:]$/.test(words[index - 1].word)) {
      punctuationBreaks.push({ index, distance: candidateDistance });
    }
    if (candidateDistance < distance) {
      best = index;
      distance = candidateDistance;
    }
  }
  const preferredPunctuation = punctuationBreaks
    .sort((a, b) => a.distance - b.distance)
    .find((candidate) => candidate.distance <= distance + total * 0.15);
  if (preferredPunctuation) return preferredPunctuation.index;
  return best;
}

function responsiveFontSize(text) {
  return Number(process.env.REMOTION_CAPTION_FIXED_FONT_SIZE || 74);
}

function chunkTokens(tokens) {
  const maxWords = Number(process.env.REMOTION_CAPTION_MAX_WORDS || 5);
  const maxCharacters = Number(process.env.REMOTION_CAPTION_MAX_CHARACTERS || 36);
  const chunks = [];
  let current = [];

  for (const token of tokens) {
    const word = String(token.text || '').trim();
    if (!word) continue;
    const nextLength = [...current.map((item) => item.word), word].join(' ').length;
    if (current.length && (current.length >= maxWords || nextLength > maxCharacters)) {
      chunks.push(current);
      current = [];
    }
    current.push({
      word,
      start: Number((token.fromMs / 1000).toFixed(3)),
      end: Number((token.toMs / 1000).toFixed(3)),
    });
    const strongBoundary = /[.!?;:]$/.test(word) && current.length >= 2;
    const commaBoundary = /,$/.test(word) && current.length >= 4;
    if (strongBoundary || commaBoundary) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function buildRemotionCaptionLines(words) {
  if (!upgradesEnabled() || !words.length) return null;

  const { createTikTokStyleCaptions } = await import('@remotion/captions');
  const captions = words.map((word, index) => ({
    text: `${index === 0 ? '' : ' '}${String(word.word || '').trim()}`,
    startMs: Math.round(Number(word.start || 0) * 1000),
    endMs: Math.round(Number(word.end || word.start || 0) * 1000),
    timestampMs: Math.round(((Number(word.start || 0) + Number(word.end || word.start || 0)) / 2) * 1000),
    confidence: null,
  }));
  const { pages } = createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: Number(process.env.REMOTION_CAPTION_PAGE_MS || 900),
  });

  const lines = pages.flatMap((page) => chunkTokens(page.tokens)).map((lineWords) => {
    const text = lineWords.map((word) => word.word).join(' ').toUpperCase();
    return {
      text,
      start: lineWords[0].start,
      end: lineWords[lineWords.length - 1].end,
      words: lineWords.map((word) => ({ ...word, word: word.word.toUpperCase() })),
      breakBeforeIndex: preferredBreakIndex(lineWords),
      fontSize: responsiveFontSize(text),
      maxLines: 2,
      layoutEngine: 'remotion_captions',
    };
  });

  return {
    engine: 'remotion_captions',
    version: 'phrase_aware_word_highlight_uppercase_v3',
    lines,
  };
}

module.exports = {
  buildRemotionCaptionLines,
  _test: { chunkTokens, preferredBreakIndex, responsiveFontSize },
};
