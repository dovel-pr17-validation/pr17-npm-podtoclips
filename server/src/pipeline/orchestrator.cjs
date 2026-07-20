const store = require('../storage/index.cjs');
const { StageStatus, EpisodeStatus } = require('../domain/pipeline.cjs');
const { createId } = require('../utils/ids.cjs');
const { getTranscriptionAdapter } = require('../transcription/index.cjs');
const { getAiAdapter } = require('../ai/index.cjs');
const { getVisualAdapter } = require('../visual/index.cjs');
const { getRenderer } = require('../rendering/index.cjs');
const { renderClipLocally } = require('../rendering/localFfmpegRenderService.cjs');
const { reserveClipQuota, settleClipQuota } = require('../billing/entitlements.cjs');
const { requireEpisodeBillingAccountId } = require('../billing/generationIdentity.cjs');
const { getAccountEntitlement } = require('../billing/entitlements.cjs');
const { assertDurationAllowed, isSourceLimitError, sourceDurationSeconds } = require('../billing/freeTierLimits.cjs');

const activeRuns = new Set();

async function runEpisodePipeline(episodeId) {
  if (activeRuns.has(episodeId)) return;
  activeRuns.add(episodeId);
  let currentStage = null;
  let generationId = null;
  let completedClipCount = 0;

  try {
    let startingEpisode = await store.getEpisode(episodeId);
    const accountId = requireEpisodeBillingAccountId(startingEpisode);
    const entitlement = await getAccountEntitlement(accountId);
    assertDurationAllowed(entitlement, sourceDurationSeconds(startingEpisode.source));
    generationId = createId('generation');
    await store.updateEpisode(episodeId, {
      status: EpisodeStatus.PROCESSING,
      error: null,
      source: {
        ...startingEpisode.source,
        billing: {
          ...(startingEpisode.source?.billing || {}),
          generationId,
        },
      },
    });
    let episode = await store.getEpisode(episodeId);
    const transcription = getTranscriptionAdapter();
    const ai = getAiAdapter();
    const visual = getVisualAdapter();
    const renderer = getRenderer();

    currentStage = 'transcribe';
    await store.updateStage(episodeId, currentStage, StageStatus.RUNNING, `Transcribing and diarizing with ${transcription.provider}.`);
    const transcript = await transcription.transcribeEpisode(episode);
    episode = await store.updateEpisode(episodeId, { transcript });
    await store.updateStage(episodeId, 'transcribe', StageStatus.COMPLETED, `Transcript ready with ${transcript.words.length} words.`);

    currentStage = 'score_transcript';
    await store.updateStage(episodeId, currentStage, StageStatus.RUNNING, `Scoring transcript-only moments with ${ai.provider}.`);
    const scoredCandidates = await ai.scoreTranscript(episode, transcript);
    const candidates = ai.refineCandidateBoundaries
      ? await ai.refineCandidateBoundaries(episode, transcript, scoredCandidates)
      : scoredCandidates;
    episode = await store.updateEpisode(episodeId, { candidates });
    await store.updateStage(episodeId, 'score_transcript', StageStatus.COMPLETED, `Found and context-completed ${candidates.length} candidate moments.`);

    currentStage = 'visual_verification';
    await store.updateStage(episodeId, currentStage, StageStatus.RUNNING, `Verifying only candidate windows with ${visual.provider}.`);
    const verified = [];
    for (const candidate of candidates) {
      verified.push({ ...candidate, visualVerification: await visual.verifyCandidateVisuals(candidate, episode) });
    }
    episode = await store.updateEpisode(episodeId, { candidates: verified });
    await store.updateStage(episodeId, 'visual_verification', StageStatus.COMPLETED, 'Selective visual verification complete.');

    currentStage = 'ui_flow_extraction';
    await store.updateStage(episodeId, currentStage, StageStatus.RUNNING, 'Extracting scene scripts for UI-flow candidates.');
    const scripted = [];
    for (const candidate of verified) {
      scripted.push({ ...candidate, sceneScript: await ai.extractSceneScript(candidate, transcript) });
    }
    episode = await store.updateEpisode(episodeId, { candidates: scripted });
    await store.updateStage(episodeId, 'ui_flow_extraction', StageStatus.COMPLETED, 'UI-flow extraction complete.');

    currentStage = 'rank_and_plan';
    await store.updateStage(episodeId, currentStage, StageStatus.RUNNING, 'Ranking and creating assembly plans.');
    const rankedCandidates = scripted
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
    const quota = await reserveClipQuota({
      userId: accountId,
      episodeId,
      generationId,
      requestedClips: rankedCandidates.length,
    });
    const ranked = rankedCandidates.slice(0, quota.reservedClips);
    const planned = [];
    for (const candidate of ranked) {
      planned.push({
        ...candidate,
        renderPlan: await renderer.createRenderPlan(episode, candidate, candidate.visualVerification, candidate.sceneScript),
      });
    }
    await store.updateEpisode(episodeId, { candidates: planned });
    await store.updateStage(episodeId, 'rank_and_plan', StageStatus.COMPLETED, `Selected ${planned.length} clips.`);

    currentStage = 'render_clips';
    await store.updateStage(episodeId, currentStage, StageStatus.RUNNING, `Preparing render outputs with ${renderer.provider}.`);
    const clips = [];
    for (const candidate of planned) {
      let renderResult = await renderer.renderClip(episode, candidate, candidate.renderPlan);
      if (process.env.AUTO_RENDER_LOCAL === '1') {
        renderResult = await renderClipLocally({
          episode,
          candidate,
          renderPlan: candidate.renderPlan,
          existingRender: renderResult,
        });
      }
      clips.push({
        id: createId('clip'),
        episodeId,
        candidateId: candidate.id,
        title: candidate.title,
        category: candidate.category,
        narrativeType: candidate.narrativeType,
        confidence: candidate.confidence,
        start: candidate.start,
        end: candidate.end,
        transcript: candidate.transcript,
        reasoning: candidate.reasoning,
        visualVerification: candidate.visualVerification,
        sceneScript: candidate.sceneScript,
        render: renderResult,
        createdAt: new Date().toISOString(),
      });
    }
    await store.replaceEpisodeClips(episodeId, clips);
    completedClipCount = clips.length;
    await settleClipQuota({ generationId, successfulClips: completedClipCount });
    await store.updateStage(episodeId, 'render_clips', StageStatus.COMPLETED, 'Clip render plans ready.');

    currentStage = 'delivery';
    await store.updateStage(episodeId, currentStage, StageStatus.COMPLETED, 'Clips are ready for review.');
    await store.updateEpisode(episodeId, { status: EpisodeStatus.READY, error: null });
  } catch (error) {
    if (generationId) await settleClipQuota({ generationId, successfulClips: completedClipCount });
    if (currentStage) {
      await store.updateStage(episodeId, currentStage, StageStatus.FAILED, error.message);
    }
    await store.updateEpisode(episodeId, {
      status: isSourceLimitError(error) ? EpisodeStatus.CANCELED : EpisodeStatus.FAILED,
      error: error.message,
    });
  } finally {
    activeRuns.delete(episodeId);
  }
}

function enqueueEpisodePipeline(episodeId) {
  setTimeout(() => {
    runEpisodePipeline(episodeId).catch((error) => {
      store.updateEpisode(episodeId, { status: EpisodeStatus.FAILED, error: error.message });
    });
  }, 50);
}

module.exports = {
  enqueueEpisodePipeline,
  runEpisodePipeline,
};
