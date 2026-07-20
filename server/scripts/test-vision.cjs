const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.VISUAL_PROVIDER = 'openrouter';

const store = require('../src/storage/index.cjs');
const visual = require('../src/adapters/ffmpegOpenRouterVisual.cjs');

function pickCandidate(episode, requestedCandidateId) {
  const candidates = episode.candidates || [];
  if (requestedCandidateId) {
    return candidates.find((candidate) => candidate.id === requestedCandidateId);
  }

  return candidates.find((candidate) => candidate.narrativeType === 'ui_flow')
    || candidates.find((candidate) => candidate.likelyVisual)
    || candidates[0];
}

async function pickEpisode(requestedEpisodeId) {
  if (requestedEpisodeId) return store.getEpisode(requestedEpisodeId);

  const episodes = await store.listEpisodes();
  return episodes.find((episode) => episode.source?.mimeType?.startsWith('video/') && episode.candidates?.length)
    || episodes.find((episode) => episode.candidates?.length);
}

async function main() {
  const [episodeId, candidateId] = process.argv.slice(2);
  const episode = await pickEpisode(episodeId);
  if (!episode) {
    throw new Error('No processed episode with candidates was found. Upload or import a video first.');
  }

  const candidate = pickCandidate(episode, candidateId);
  if (!candidate) {
    throw new Error(`Episode ${episode.id} has no candidate moments to verify.`);
  }

  const result = await visual.verifyCandidateVisuals(candidate, episode);

  console.log(JSON.stringify({
    episodeId: episode.id,
    episodeTitle: episode.title,
    sourceMimeType: episode.source?.mimeType,
    candidateId: candidate.id,
    candidateTitle: candidate.title,
    candidateStart: candidate.start,
    candidateEnd: candidate.end,
    narrativeType: candidate.narrativeType,
    result,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
