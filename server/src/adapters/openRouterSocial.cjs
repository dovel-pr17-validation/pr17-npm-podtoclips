const { createId } = require('../utils/ids.cjs');
const { createJsonCompletion } = require('./openRouterClient.cjs');

function getTextModel() {
  return process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-3-flash-preview';
}

const socialPostSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    linkedin: { type: 'string' },
    xThread: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: { type: 'string', maxLength: 280 },
    },
    shortCaption: { type: 'string', maxLength: 180 },
  },
  required: ['linkedin', 'xThread', 'shortCaption'],
};

async function generateSocialPosts(clip) {
  const result = await createJsonCompletion({
    model: getTextModel(),
    schemaName: 'clip_social_posts',
    schema: socialPostSchema,
    maxTokens: 2500,
    temperature: 0.55,
    messages: [
      {
        role: 'system',
        content: [
          'You write high-signal social posts from podcast clips.',
          'Use the clip transcript and reasoning only. Do not invent facts.',
          'LinkedIn should sound like a concise founder/operator insight.',
          'X thread should be punchy and each item must fit within 280 characters.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          title: clip.title,
          category: clip.category,
          narrativeType: clip.narrativeType,
          transcript: clip.transcript,
          reasoning: clip.reasoning,
        }),
      },
    ],
  });

  return {
    id: createId('post'),
    clipId: clip.id,
    createdAt: new Date().toISOString(),
    linkedin: result.linkedin,
    xThread: result.xThread,
    shortCaption: result.shortCaption,
  };
}

module.exports = {
  provider: 'openrouter',
  generateSocialPosts,
};
