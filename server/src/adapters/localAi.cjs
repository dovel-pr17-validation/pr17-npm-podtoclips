const { createId } = require('../utils/ids.cjs');
const { refineCandidates } = require('../ai/contextBoundaryResolver.cjs');

function containsAny(text, terms) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function sliceText(words, startIndex, count) {
  return words.slice(startIndex, startIndex + count).map((word) => word.word).join(' ');
}

async function scoreTranscript(episode, transcript) {
  const words = transcript.words;
  const windowSize = Math.min(55, Math.max(20, Math.floor(words.length / 3)));
  const starts = [0, Math.floor(words.length * 0.25), Math.floor(words.length * 0.5), Math.max(0, words.length - windowSize)];

  return starts.map((startIndex, index) => {
    const windowWords = words.slice(startIndex, startIndex + windowSize);
    const text = sliceText(words, startIndex, windowSize);
    const lower = text.toLowerCase();
    const uiFlow = containsAny(lower, ['tap', 'click', 'type', 'dashboard', 'button', 'screen', 'signup', 'sign up']);
    const category = uiFlow
      ? 'show_and_tell'
      : containsAny(lower, ['contrarian', 'instead', 'but'])
        ? 'opinion'
        : containsAny(lower, ['relief', 'trust', 'emotional'])
          ? 'emotion'
          : 'insight';

    return {
      id: createId('moment'),
      episodeId: episode.id,
      title: uiFlow ? 'Narrated product flow' : `Strong ${category.replace('_', ' ')} moment`,
      start: windowWords[0]?.start || index * 12,
      end: windowWords[windowWords.length - 1]?.end || index * 12 + 30,
      transcript: text,
      category,
      confidence: uiFlow ? 0.88 : 0.74 - index * 0.03,
      likelyVisual: uiFlow || category === 'show_and_tell',
      narrativeType: uiFlow ? 'ui_flow' : 'talking_head',
      reasoning: uiFlow
        ? 'Sequential UI verbs and product nouns indicate a product-flow explanation.'
        : 'Transcript contains a concise, reusable idea suitable for a short-form clip.',
    };
  });
}

async function extractSceneScript(candidate, transcript) {
  if (candidate.narrativeType !== 'ui_flow') return null;

  const base = candidate.start;
  return {
    scene_type: 'ui_flow',
    confidence: 0.86,
    canvas: 'phone',
    brand_skin: 'default',
    candidate_id: candidate.id,
    steps: [
      {
        t_start: Number((base + 0.2).toFixed(2)),
        t_end: Number((base + 1.7).toFixed(2)),
        actor: 'user',
        action: 'tap',
        target: { label: 'Sign Up', type: 'button' },
        resulting_state: { screen: 'signup_form' },
        narration_span: 'the user taps sign up',
      },
      {
        t_start: Number((base + 1.7).toFixed(2)),
        t_end: Number((base + 4.4).toFixed(2)),
        actor: 'user',
        action: 'type',
        target: { label: 'Email', type: 'input' },
        resulting_state: { screen: 'signup_form', field_filled: 'email' },
        narration_span: 'types their email',
      },
      {
        t_start: Number((base + 4.4).toFixed(2)),
        t_end: Number((base + 6.4).toFixed(2)),
        actor: 'system',
        action: 'show_toast',
        target: { label: 'Welcome!', type: 'toast' },
        resulting_state: { screen: 'dashboard' },
        narration_span: 'opens the dashboard',
      },
    ],
  };
}

async function refineCandidateBoundaries(_episode, transcript, candidates) {
  if (process.env.EASYED_UPGRADES_ENABLED === '0'
    || process.env.CONTEXT_BOUNDARY_REFINEMENT_ENABLED === '0') return candidates;
  return refineCandidates(transcript.words || [], candidates);
}

module.exports = {
  scoreTranscript,
  refineCandidateBoundaries,
  extractSceneScript,
};
