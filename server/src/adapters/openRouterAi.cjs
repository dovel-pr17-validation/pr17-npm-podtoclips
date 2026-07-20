const { createId } = require('../utils/ids.cjs');
const { createJsonCompletion } = require('./openRouterClient.cjs');
const { contextForCandidate, refineCandidates } = require('../ai/contextBoundaryResolver.cjs');
const { buildFullTranscriptWindows, rankSelections } = require('../ai/momentDiscovery.cjs');

const laneEnum = [
  'shocking_reveal', 'unique_insight', 'emotional_story', 'contrarian_take',
  'high_stakes_story', 'practical_breakthrough', 'funny_surprise',
];

function getStructuredModel() {
  return process.env.OPENROUTER_STRUCTURED_MODEL || process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-3-flash-preview';
}

function discoverySchema(maxWindowIndex) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      candidates: {
        type: 'array',
        maxItems: 16,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            window_index: {
              type: 'integer',
              minimum: 0,
              maximum: Math.max(0, maxWindowIndex),
            },
            title: { type: 'string' },
            lane: { type: 'string', enum: laneEnum },
            hook_quote: { type: 'string' },
            reasoning: { type: 'string' },
          },
          required: [
            'window_index', 'title', 'lane', 'hook_quote', 'reasoning',
          ],
        },
      },
    },
    required: ['candidates'],
  };
}

function rerankSchema(maxCandidateIndex) {
  const score = { type: 'number', minimum: 0, maximum: 1 };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      selections: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidate_index: { type: 'integer', minimum: 0, maximum: Math.max(0, maxCandidateIndex) },
            engagement_score: score,
            virality_score: score,
            retention_score: score,
            insight_score: score,
            surprise_score: score,
            clarity_score: score,
            context_score: score,
            reasoning: { type: 'string' },
          },
          required: [
            'candidate_index', 'engagement_score', 'virality_score', 'retention_score',
            'insight_score', 'surprise_score', 'clarity_score', 'context_score', 'reasoning',
          ],
        },
      },
    },
    required: ['selections'],
  };
}

async function discoverMoments(episode, windows) {
  return createJsonCompletion({
    model: getStructuredModel(),
    schemaName: 'podcast_global_moment_discovery',
    schema: discoverySchema(windows.length - 1),
    maxTokens: 5000,
    messages: [
      {
        role: 'system',
        content: [
          'You are the global discovery stage for a premium short-form podcast editor.',
          'Inspect every supplied window from the entire podcast. Do not favor the beginning merely because it appears first.',
          'Find up to 16 genuinely distinct core moments with exceptional audience potential.',
          'Prioritize guest-led moments containing a shocking or surprising reveal, a unique and defensible insight, an emotionally powerful story, a contrarian opinion, a high-stakes decision, a practical breakthrough, or an unexpectedly funny payoff.',
          'The best candidates create an immediate reason to keep watching and deliver a satisfying payoff: specific numbers, unusual behavior, meaningful stakes, conflict, transformation, counterintuitive reasoning, vivid examples, or a memorable quote.',
          'Unique speaker insight is critical. Prefer something only this speaker could credibly say over generic advice available anywhere.',
          'Include both highly engaging stories and high-value insights. Reject generic motivation, routine biography, repetitive setup, promotional filler, ordinary facts, and technical explanation without a human hook or surprising consequence.',
          'Choose the window containing the core moment. Exact context-complete boundaries will be determined later.',
          'hook_quote must be a short verbatim phrase found in that window; never invent or exaggerate it.',
          'Return non-overlapping, non-duplicative candidates with truthful but compelling titles.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          episode: { id: episode.id, title: episode.title },
          windows: windows.map(({ window_index, start, end, speaker_turns }) => ({
            window_index, start, end, speaker_turns,
          })),
        }),
      },
    ],
  });
}

function dedupeDiscoveredCandidates(candidates) {
  const selected = [];
  for (const candidate of candidates) {
    const duration = Math.max(0.1, candidate.end - candidate.start);
    const duplicate = selected.some((existing) => {
      const overlap = Math.max(0, Math.min(candidate.end, existing.end) - Math.max(candidate.start, existing.start));
      return overlap / Math.min(duration, Math.max(0.1, existing.end - existing.start)) >= 0.6;
    });
    if (!duplicate) selected.push(candidate);
  }
  return selected;
}

async function rerankMoments(episode, candidates) {
  return createJsonCompletion({
    model: getStructuredModel(),
    schemaName: 'podcast_global_moment_ranking',
    schema: rerankSchema(candidates.length - 1),
    maxTokens: 5000,
    messages: [
      {
        role: 'system',
        content: [
          'You are the final global ranking stage for premium short-form podcast clips.',
          'Compare every candidate against every other candidate and select at most eight. Returning fewer is better than selecting weak material.',
          'Engagement is the probability a viewer immediately stops scrolling and pays attention. Virality is the probability of sharing, commenting, replaying, or clicking the full podcast. Retention is the probability of watching the complete clip because its tension, curiosity, or story resolves with a payoff.',
          'Insight measures how unique, important, specific, and speaker-owned the idea is. Surprise measures shock, wow, amazement, novelty, excitement, or a strong perspective shift.',
          'Clarity measures whether a broad viewer can comfortably follow the clip without excessive jargon. Context measures whether the complete setup and payoff can fit naturally within 20 to 58 seconds.',
          'Give highest preference to candidates that combine exceptional engagement with a unique insight, revelation, emotional truth, or surprising payoff.',
          'Reject clickbait without substance, dry knowledge without an audience hook, generic advice, unresolved teases, repeated ideas, host-only setup without a guest payoff, and moments requiring more than 58 seconds to understand.',
          'Score strictly: 0.5 is ordinary, 0.7 is strong, 0.85 is exceptional, and 0.95 should be extremely rare.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          episode: { id: episode.id, title: episode.title },
          candidates: candidates.map((candidate, index) => ({
            candidate_index: index,
            title: candidate.title,
            lane: candidate.discoveryLane,
            category: candidate.category,
            start: candidate.start,
            end: candidate.end,
            hook_quote: candidate.hookQuote,
            transcript: candidate.transcript,
            discovery_reasoning: candidate.reasoning,
          })),
        }),
      },
    ],
  });
}

async function scoreTranscript(episode, transcript) {
  const windows = buildFullTranscriptWindows(transcript.words || []);
  if (!windows.length) return [];
  const discovery = await discoverMoments(episode, windows);
  const discovered = (discovery.candidates || [])
    .map((candidate) => {
      const transcriptWindow = windows[candidate.window_index];
      if (!transcriptWindow) return null;
      return {
        id: createId('moment'),
        episodeId: episode.id,
        title: candidate.title,
        start: transcriptWindow.start,
        end: transcriptWindow.end,
        transcript: transcriptWindow.text,
        category: candidate.lane === 'emotional_story'
          ? 'emotion'
          : candidate.lane === 'funny_surprise'
            ? 'funny'
            : candidate.lane === 'contrarian_take'
              ? 'opinion'
              : 'insight',
        confidence: 0,
        likelyVisual: false,
        narrativeType: 'talking_head',
        discoveryLane: candidate.lane,
        hookQuote: candidate.hook_quote,
        reasoning: candidate.reasoning,
      };
    })
    .filter(Boolean);
  const candidates = dedupeDiscoveredCandidates(discovered);
  if (!candidates.length) return [];
  const ranking = await rerankMoments(episode, candidates);
  return rankSelections(candidates, ranking.selections || [], 8);
}

function boundarySchema(maxCandidateIndex, maxWordIndex) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      boundaries: {
        type: 'array',
        maxItems: Math.max(1, maxCandidateIndex + 1),
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidate_index: { type: 'integer', minimum: 0, maximum: Math.max(0, maxCandidateIndex) },
            start_word_index: { type: 'integer', minimum: 0, maximum: Math.max(0, maxWordIndex) },
            end_word_index: { type: 'integer', minimum: 0, maximum: Math.max(0, maxWordIndex) },
            starts_cleanly: { type: 'boolean' },
            ends_cleanly: { type: 'boolean' },
            context_complete: { type: 'boolean' },
            requires_previous_question: { type: 'boolean' },
            contains_conclusion: { type: 'boolean' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reasoning: { type: 'string' },
          },
          required: [
            'candidate_index', 'start_word_index', 'end_word_index', 'starts_cleanly',
            'ends_cleanly', 'context_complete', 'requires_previous_question',
            'contains_conclusion', 'confidence', 'reasoning',
          ],
        },
      },
    },
    required: ['boundaries'],
  };
}

function contextBoundaryEnabled() {
  return process.env.EASYED_UPGRADES_ENABLED !== '0'
    && process.env.CONTEXT_BOUNDARY_REFINEMENT_ENABLED !== '0';
}

async function refineCandidateBoundaries(episode, transcript, candidates) {
  if (!contextBoundaryEnabled() || !candidates.length || !transcript.words?.length) return candidates;
  if (process.env.CONTEXT_BOUNDARY_MODEL_ENABLED === '0') {
    return refineCandidates(transcript.words, candidates);
  }

  const contexts = candidates.map((candidate, index) => contextForCandidate(transcript.words, candidate, index));
  try {
    const result = await createJsonCompletion({
      model: getStructuredModel(),
      schemaName: 'podcast_context_safe_boundaries',
      schema: boundarySchema(candidates.length - 1, transcript.words.length - 1),
      maxTokens: 6000,
      messages: [
        {
          role: 'system',
          content: [
            'You refine transcript boundaries for already-selected high-value podcast moments.',
            'Do not rediscover or replace the core idea. Select exact global word indexes from the supplied context.',
            'The clip must begin with enough setup to be understood without the full podcast and must finish the explanation, example, answer, conclusion, or punchline.',
            'Within that context requirement, start on the strongest clean spoken hook available: a striking claim, surprising detail, meaningful tension, clear stake, or concise question. Remove greetings, throat-clearing, repetition, and expendable lead-in.',
            'Never manufacture a hook by cutting a sentence, changing its meaning, or withholding the resolution.',
            'Include a preceding question when the answer is otherwise ambiguous.',
            'Never end on an unfinished clause, conjunction, setup, or promise of information that comes next.',
            'Prefer 28-50 seconds. Use at least 20 seconds when the source contains enough material, and never select more than 58 seconds.',
            'If duration must be reduced, remove expendable setup from the beginning rather than cutting the conclusion.',
            'Return one boundary result for every candidate_index.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            episode: { id: episode.id, title: episode.title },
            candidates: candidates.map((candidate, index) => ({
              candidate_index: index,
              title: candidate.title,
              category: candidate.category,
              reasoning: candidate.reasoning,
              original_start: candidate.start,
              original_end: candidate.end,
              original_transcript: candidate.transcript,
              core_start_word_index: contexts[index].coreStartIndex,
              core_end_word_index: contexts[index].coreEndIndex,
              context_words: contexts[index].words,
            })),
          }),
        },
      ],
    });
    return refineCandidates(transcript.words, candidates, result.boundaries || []);
  } catch (error) {
    console.warn(`Context boundary model unavailable; using deterministic transcript boundaries: ${error.message}`);
    return refineCandidates(transcript.words, candidates);
  }
}

const sceneScriptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scene_type: { type: 'string', enum: ['ui_flow'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    canvas: { type: 'string', enum: ['phone', 'browser', 'generic', 'video-overlay'] },
    brand_skin: { type: 'string' },
    steps: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          t_start: { type: 'number' },
          t_end: { type: 'number' },
          actor: { type: 'string', enum: ['user', 'system'] },
          action: { type: 'string', enum: ['tap', 'click', 'type', 'swipe', 'drag', 'show_toast', 'loading', 'error'] },
          target: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string' },
              type: { type: 'string' },
            },
            required: ['label', 'type'],
          },
          resulting_state: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
          },
          narration_span: { type: 'string' },
        },
        required: ['t_start', 't_end', 'actor', 'action', 'target', 'resulting_state', 'narration_span'],
      },
    },
  },
  required: ['scene_type', 'confidence', 'canvas', 'brand_skin', 'steps'],
};

async function extractSceneScript(candidate, transcript) {
  if (candidate.narrativeType !== 'ui_flow') return null;

  const words = (transcript.words || [])
    .filter((word) => word.start >= candidate.start && word.end <= candidate.end)
    .map((word) => ({
      word: word.word,
      start: word.start,
      end: word.end,
    }));

  const result = await createJsonCompletion({
    model: getStructuredModel(),
    schemaName: 'ui_flow_scene_script',
    schema: sceneScriptSchema,
    maxTokens: 3000,
    messages: [
      {
        role: 'system',
        content: [
          'Convert narrated product/UI flow transcript into a Remotion Scene Script.',
          'Use only actions supported by the schema.',
          'Bind every step to the real word timestamps when possible.',
          'If narration is ambiguous, return low confidence and fewer steps.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          candidate: {
            id: candidate.id,
            start: candidate.start,
            end: candidate.end,
            transcript: candidate.transcript,
          },
          words,
        }),
      },
    ],
  });

  return {
    ...result,
    candidate_id: candidate.id,
  };
}

module.exports = {
  provider: 'openrouter',
  scoreTranscript,
  refineCandidateBoundaries,
  extractSceneScript,
  _test: {
    boundarySchema,
    contextBoundaryEnabled,
    dedupeDiscoveredCandidates,
    discoverMoments,
    discoverySchema,
    rerankMoments,
    rerankSchema,
  },
};
