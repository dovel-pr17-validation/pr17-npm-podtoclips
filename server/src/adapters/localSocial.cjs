const { createId } = require('../utils/ids.cjs');

async function generateSocialPosts(clip) {
  const hook = clip.title || 'A strong podcast moment';
  const core = clip.transcript || 'This clip contains a useful insight from the episode.';

  return {
    id: createId('post'),
    clipId: clip.id,
    createdAt: new Date().toISOString(),
    linkedin: `${hook}\n\n${core}\n\nThe takeaway: make the idea easy to understand, then make it easy to share.`,
    xThread: [
      `${hook}:`,
      core.slice(0, 240),
      'The practical lesson: clips should amplify insight, not just volume.',
    ],
    shortCaption: `${hook} — ${core.slice(0, 120)}...`,
  };
}

module.exports = { generateSocialPosts };

