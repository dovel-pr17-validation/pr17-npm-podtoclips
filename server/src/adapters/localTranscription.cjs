function buildWords(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let cursor = 0;
  return tokens.map((word, index) => {
    const start = Number(cursor.toFixed(2));
    const duration = Math.max(0.25, Math.min(0.7, word.length * 0.055));
    cursor += duration + 0.08;
    return {
      word,
      start,
      end: Number(cursor.toFixed(2)),
      speaker: index % 7 === 0 ? 'Speaker 2' : 'Speaker 1',
    };
  });
}

async function transcribeEpisode(episode) {
  const fallbackText = [
    'The best moment in this podcast is when the founder explains the product flow.',
    'The user taps sign up, types their email, opens the dashboard, and immediately sees the value.',
    'That is the insight: reduce friction before asking people to trust the product.',
    'It is a contrarian take because most teams add onboarding steps instead of removing them.',
    'The emotional beat is the relief when the user finally understands what the product does.',
  ].join(' ');

  const words = buildWords(fallbackText);

  return {
    provider: 'local-dev-transcriber',
    language: 'en',
    text: fallbackText,
    words,
    speakers: [
      { id: 'Speaker 1', label: 'Host' },
      { id: 'Speaker 2', label: 'Guest' },
    ],
    durationSeconds: words.length ? words[words.length - 1].end : 0,
    sourceAssetKey: episode.source.assetKey,
  };
}

module.exports = { transcribeEpisode };

