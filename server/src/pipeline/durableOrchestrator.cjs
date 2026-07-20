const store = require('../storage/index.cjs');
const { StageStatus, EpisodeStatus } = require('../domain/pipeline.cjs');
const { createId } = require('../utils/ids.cjs');
const { getTranscriptionAdapter } = require('../transcription/index.cjs');
const { getAiAdapter } = require('../ai/index.cjs');
const { getVisualAdapter } = require('../visual/index.cjs');
const { getRenderer } = require('../rendering/index.cjs');
const { getObjectStorage } = require('../objectStorage/index.cjs');
const { renderClipLocally } = require('../rendering/localFfmpegRenderService.cjs');
const cloudRunJobs = require('../adapters/cloudRunJobsClient.cjs');
const { reserveClipQuota, settleEpisodeClipQuota } = require('../billing/entitlements.cjs');
const { requireEpisodeBillingAccountId } = require('../billing/generationIdentity.cjs');
const { getAccountEntitlement } = require('../billing/entitlements.cjs');
const { assertDurationAllowed, sourceDurationSeconds } = require('../billing/freeTierLimits.cjs');

function requireEpisode(episode) {
  if (!episode) throw new Error('Episode not found.');
  return episode;
}

function episodeForInngestRun(episodes, runId) {
  return episodes.find((episode) => episode.source?.orchestration?.runId === runId) || null;
}

function terminalStages(stages, message, now = new Date().toISOString()) {
  let marked = false;
  const next = (stages || []).map((stage) => {
    if (stage.status !== StageStatus.RUNNING) return stage;
    marked = true;
    return { ...stage, status: StageStatus.FAILED, message, completedAt: now };
  });
  if (marked) return next;
  const pendingIndex = next.findIndex((stage) => stage.status === StageStatus.PENDING);
  if (pendingIndex < 0) return next;
  next[pendingIndex] = {
    ...next[pendingIndex],
    status: StageStatus.FAILED,
    message,
    startedAt: next[pendingIndex].startedAt || now,
    completedAt: now,
  };
  return next;
}

function terminalEpisodeStatus(status) {
  return [EpisodeStatus.READY, EpisodeStatus.FAILED, EpisodeStatus.CANCELED].includes(status);
}

function billingContextForEpisode(episode) {
  const userId = requireEpisodeBillingAccountId(episode);
  const generationId = episode.source?.orchestration?.runId
    || episode.source?.billing?.generationId
    || null;
  if (!generationId) {
    throw new Error('This clip generation run is missing its durable billing identity.');
  }
  return { userId, generationId };
}

async function settleCurrentEpisodeQuota(episode, clips = null) {
  const currentClips = clips || await store.listClipsForEpisode(episode.id);
  const successfulClips = currentClips.filter((clip) => clip.render?.status === 'rendered').length;
  let generationId = null;
  try {
    generationId = billingContextForEpisode(episode).generationId;
  } catch {
    // Older episodes may predate per-generation quota identity. They cannot
    // have a clip reservation, so there is nothing to settle.
  }
  return settleEpisodeClipQuota({ episodeId: episode.id, generationId, successfulClips });
}

async function bindEpisodeInngestRun(episodeId, runId, functionId) {
  if (!runId) return null;
  return store.updateEpisode(episodeId, (episode) => ({
    source: {
      ...episode.source,
      orchestration: {
        ...(episode.source?.orchestration || {}),
        provider: 'inngest',
        runId,
        functionId,
        status: 'running',
        startedAt: new Date().toISOString(),
      },
    },
  }));
}

async function bindClipInngestRun(clipId, runId, functionId) {
  if (!runId) return null;
  const clip = await store.getClip(clipId);
  if (!clip) return null;
  return store.updateClipRender(clipId, {
    ...clip.render,
    inngest: {
      runId,
      functionId,
      status: 'running',
      startedAt: new Date().toISOString(),
    },
  });
}

async function markEpisodeTerminal(episodeId, status, message, run = {}) {
  const episode = requireEpisode(await store.getEpisode(episodeId));
  if (terminalEpisodeStatus(episode.status)) {
    await settleCurrentEpisodeQuota(episode);
    return episode;
  }
  const now = new Date().toISOString();
  const updated = await store.updateEpisode(episodeId, {
    status,
    error: message,
    stages: terminalStages(episode.stages, message, now),
    source: {
      ...episode.source,
      orchestration: {
        ...(episode.source?.orchestration || {}),
        ...run,
        provider: 'inngest',
        status,
        completedAt: now,
      },
    },
  });
  await settleCurrentEpisodeQuota(updated);
  return updated;
}

async function markEpisodeFailedFromInngest(episodeId, error, run = {}) {
  const message = error?.message || String(error || 'The Inngest workflow failed.');
  return markEpisodeTerminal(episodeId, EpisodeStatus.FAILED, message, run);
}

async function markEpisodeCanceled(episodeId, message = 'Clip generation was canceled in Inngest.', run = {}) {
  return markEpisodeTerminal(episodeId, EpisodeStatus.CANCELED, message, run);
}

async function reconcileCancelledInngestRun({ runId, functionId }) {
  if (!runId) return { matched: false };
  const episodes = await store.listEpisodes();
  const boundEpisode = episodeForInngestRun(episodes, runId);
  const message = 'Clip generation was canceled in Inngest.';
  if (boundEpisode) {
    const episode = await markEpisodeCanceled(boundEpisode.id, message, {
      runId,
      functionId,
    });
    return { matched: true, episodeId: episode.id, status: EpisodeStatus.CANCELED };
  }

  for (const episode of episodes) {
    const clips = await store.listClipsForEpisode(episode.id);
    const clip = clips.find((item) => item.render?.inngest?.runId === runId);
    if (!clip) continue;
    await markClipRenderFailed(clip.id, new Error(message));
    const updated = await markEpisodeCanceled(episode.id, message, {
      runId,
      functionId,
      clipId: clip.id,
    });
    return { matched: true, episodeId: updated.id, clipId: clip.id, status: EpisodeStatus.CANCELED };
  }

  return { matched: false, runId, functionId };
}

function candidateById(episode, candidateId) {
  const candidate = (episode.candidates || []).find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  return candidate;
}

async function beginEpisode(episodeId) {
  const episode = requireEpisode(await store.getEpisode(episodeId));
  const accountId = requireEpisodeBillingAccountId(episode);
  const entitlement = await getAccountEntitlement(accountId);
  assertDurationAllowed(entitlement, sourceDurationSeconds(episode.source));
  const generationId = episode.source?.orchestration?.runId || createId('generation');
  await store.updateEpisode(episode.id, {
    status: EpisodeStatus.PROCESSING,
    error: null,
    source: {
      ...episode.source,
      billing: {
        ...(episode.source?.billing || {}),
        generationId,
      },
    },
  });
  return { episodeId, status: EpisodeStatus.PROCESSING };
}

async function transcribeEpisode(episodeId) {
  let episode = requireEpisode(await store.getEpisode(episodeId));
  const adapter = getTranscriptionAdapter();
  await store.updateStage(episodeId, 'transcribe', StageStatus.RUNNING, `Transcribing and diarizing with ${adapter.provider}.`);
  try {
    const transcript = await adapter.transcribeEpisode(episode);
    episode = await store.updateEpisode(episodeId, { transcript });
    await store.updateStage(episodeId, 'transcribe', StageStatus.COMPLETED, `Transcript ready with ${transcript.words.length} words.`);
    return { episodeId, wordCount: transcript.words.length };
  } catch (error) {
    await store.updateStage(episodeId, 'transcribe', StageStatus.FAILED, error.message);
    throw error;
  }
}

async function selectMoments(episodeId) {
  let episode = requireEpisode(await store.getEpisode(episodeId));
  if (!episode.transcript?.words?.length) throw new Error('Transcript is required before moment selection.');
  const adapter = getAiAdapter();
  await store.updateStage(episodeId, 'score_transcript', StageStatus.RUNNING, `Discovering and globally ranking moments with ${adapter.provider}.`);
  try {
    const scored = await adapter.scoreTranscript(episode, episode.transcript);
    const candidates = adapter.refineCandidateBoundaries
      ? await adapter.refineCandidateBoundaries(episode, episode.transcript, scored)
      : scored;
    episode = await store.updateEpisode(episodeId, { candidates });
    await store.updateStage(episodeId, 'score_transcript', StageStatus.COMPLETED, `Selected and context-completed ${candidates.length} moments.`);
    return { episodeId, candidateIds: candidates.map((candidate) => candidate.id) };
  } catch (error) {
    await store.updateStage(episodeId, 'score_transcript', StageStatus.FAILED, error.message);
    throw error;
  }
}

async function verifyCandidateVisuals(episodeId, candidateId) {
  const episode = requireEpisode(await store.getEpisode(episodeId));
  const candidate = candidateById(episode, candidateId);
  const visualVerification = await getVisualAdapter().verifyCandidateVisuals(candidate, episode);
  return { candidateId, visualVerification };
}

async function persistVisualVerifications(episodeId, results) {
  const episode = requireEpisode(await store.getEpisode(episodeId));
  const byId = new Map(results.map((result) => [result.candidateId, result.visualVerification]));
  const candidates = episode.candidates.map((candidate) => ({
    ...candidate,
    visualVerification: byId.get(candidate.id) || candidate.visualVerification || null,
  }));
  await store.updateEpisode(episodeId, { candidates });
  await store.updateStage(episodeId, 'visual_verification', StageStatus.COMPLETED, `Verified ${results.length} candidate windows in parallel.`);
  return { episodeId, candidateIds: candidates.map((candidate) => candidate.id) };
}

async function extractCandidateSceneScript(episodeId, candidateId) {
  const episode = requireEpisode(await store.getEpisode(episodeId));
  const candidate = candidateById(episode, candidateId);
  const sceneScript = await getAiAdapter().extractSceneScript(candidate, episode.transcript);
  return { candidateId, sceneScript };
}

async function persistSceneScripts(episodeId, results) {
  const episode = requireEpisode(await store.getEpisode(episodeId));
  const byId = new Map(results.map((result) => [result.candidateId, result.sceneScript]));
  const candidates = episode.candidates.map((candidate) => ({
    ...candidate,
    sceneScript: byId.has(candidate.id) ? byId.get(candidate.id) : candidate.sceneScript || null,
  }));
  await store.updateEpisode(episodeId, { candidates });
  await store.updateStage(episodeId, 'ui_flow_extraction', StageStatus.COMPLETED, 'Scene-script extraction complete.');
  return { episodeId, candidateIds: candidates.map((candidate) => candidate.id) };
}

async function planEpisodeRenders(episodeId) {
  const episode = requireEpisode(await store.getEpisode(episodeId));
  const renderer = getRenderer();
  const rankedCandidates = [...(episode.candidates || [])]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
  const { userId, generationId } = billingContextForEpisode(episode);
  const quota = await reserveClipQuota({
    userId,
    episodeId,
    generationId,
    requestedClips: rankedCandidates.length,
  });
  const ranked = rankedCandidates.slice(0, quota.reservedClips);

  await store.updateStage(episodeId, 'rank_and_plan', StageStatus.RUNNING, `Building ${ranked.length} quota-approved render plans.`);
  const planned = [];
  const clips = [];
  for (const candidate of ranked) {
    const renderPlan = await renderer.createRenderPlan(
      episode,
      candidate,
      candidate.visualVerification,
      candidate.sceneScript,
    );
    const render = renderer.prepareRenderClip
      ? await renderer.prepareRenderClip(episode, candidate, renderPlan)
      : await renderer.renderClip(episode, candidate, renderPlan);
    planned.push({ ...candidate, renderPlan });
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
      render,
      createdAt: new Date().toISOString(),
    });
  }

  await store.updateEpisode(episodeId, { candidates: planned });
  await store.replaceEpisodeClips(episodeId, clips);
  await store.updateStage(episodeId, 'rank_and_plan', StageStatus.COMPLETED, `Prepared ${clips.length} independent clip jobs.`);
  if (clips.length) {
    await store.updateStage(episodeId, 'render_clips', StageStatus.RUNNING, `Rendering ${clips.length} clips in parallel.`);
  } else {
    const message = rankedCandidates.length && quota.reservedClips === 0
      ? 'No clip allowance remains for this billing period.'
      : 'No clips met the quality threshold.';
    await store.updateStage(episodeId, 'render_clips', StageStatus.COMPLETED, message);
    await store.updateStage(episodeId, 'delivery', StageStatus.COMPLETED, message);
    await store.updateEpisode(episodeId, { status: EpisodeStatus.READY, error: null });
  }
  return { episodeId, clipIds: clips.map((clip) => clip.id) };
}

function cloudRenderingEnabled() {
  return process.env.RENDER_PROVIDER === 'cloud_run'
    && process.env.AUTO_RENDER_LOCAL !== '1'
    && cloudRunJobs.configured();
}

function localRenderingEnabled() {
  return process.env.AUTO_RENDER_LOCAL === '1' || process.env.RENDER_PROVIDER !== 'cloud_run';
}

function assertRenderModeConfigured() {
  if (!localRenderingEnabled() && !cloudRenderingEnabled()) {
    throw new Error('Cloud rendering is selected but GOOGLE_CLOUD_PROJECT, CLOUD_RUN_LOCATION, or CLOUD_RUN_RENDER_JOB is missing.');
  }
}

async function dispatchClipRender(clipId) {
  const clip = await store.getClip(clipId);
  if (!clip) throw new Error(`Clip not found: ${clipId}`);
  if (clip.render?.status === 'rendered') return clip.render;
  if (clip.render?.status === 'running' && clip.render?.operationName) return clip.render;
  assertRenderModeConfigured();
  if (localRenderingEnabled()) return { ...clip.render, local: true };

  const renderer = getRenderer();
  const render = await renderer.dispatchPreparedRender(clip.render);
  await store.updateClipRender(clipId, render);
  return render;
}

async function waitForClipRender(clipId) {
  const clip = await store.getClip(clipId);
  if (!clip) throw new Error(`Clip not found: ${clipId}`);
  assertRenderModeConfigured();
  if (localRenderingEnabled()) return { local: true };
  const operation = await getRenderer().waitForPreparedRender(clip.render);
  return { operationName: operation.name, done: operation.done === true };
}

async function completeClipRender(clipId) {
  const clip = await store.getClip(clipId);
  if (!clip) throw new Error(`Clip not found: ${clipId}`);
  const episode = requireEpisode(await store.getEpisode(clip.episodeId));

  assertRenderModeConfigured();
  if (localRenderingEnabled()) {
    const candidate = candidateById(episode, clip.candidateId);
    const render = await renderClipLocally({
      episode,
      candidate,
      renderPlan: clip.render.renderPlan,
      existingRender: clip.render,
    });
    await store.updateClipRender(clipId, render);
    return render;
  }

  const result = await getObjectStorage().getJson(clip.render.resultAssetKey);
  const render = {
    ...clip.render,
    ...result,
    previewUrl: result.status === 'rendered'
      ? `/api/assets/${encodeURIComponent(result.outputAssetKey)}`
      : null,
    renderProvider: 'cloud-run-jobs-parallel',
    renderedAt: result.completedAt || new Date().toISOString(),
  };
  await store.updateClipRender(clipId, render);
  return render;
}

async function markClipRenderFailed(clipId, error) {
  const clip = await store.getClip(clipId);
  if (!clip) return null;
  const render = {
    ...clip.render,
    status: 'failed',
    error: error?.message || String(error),
    renderedAt: new Date().toISOString(),
  };
  return store.updateClipRender(clipId, render);
}

async function finalizeEpisodeIfReady(episodeId) {
  const clips = await store.listClipsForEpisode(episodeId);
  if (!clips.length) return false;
  const terminal = new Set(['rendered', 'failed', 'failed_qc']);
  if (!clips.every((clip) => terminal.has(clip.render?.status))) return false;

  const failed = clips.filter((clip) => clip.render?.status !== 'rendered');
  await settleCurrentEpisodeQuota(requireEpisode(await store.getEpisode(episodeId)), clips);
  if (failed.length) {
    const message = `${clips.length - failed.length}/${clips.length} clips rendered; ${failed.length} failed.`;
    await store.updateStage(episodeId, 'render_clips', StageStatus.FAILED, message);
    await store.updateEpisode(episodeId, { status: EpisodeStatus.FAILED, error: message });
    return true;
  }

  await store.updateStage(episodeId, 'render_clips', StageStatus.COMPLETED, `${clips.length} clips rendered in parallel.`);
  await store.updateStage(episodeId, 'delivery', StageStatus.COMPLETED, 'Clips are ready for review.');
  await store.updateEpisode(episodeId, { status: EpisodeStatus.READY, error: null });
  return true;
}

module.exports = {
  bindEpisodeInngestRun,
  bindClipInngestRun,
  markEpisodeFailedFromInngest,
  markEpisodeCanceled,
  reconcileCancelledInngestRun,
  beginEpisode,
  transcribeEpisode,
  selectMoments,
  verifyCandidateVisuals,
  persistVisualVerifications,
  extractCandidateSceneScript,
  persistSceneScripts,
  planEpisodeRenders,
  dispatchClipRender,
  waitForClipRender,
  completeClipRender,
  markClipRenderFailed,
  finalizeEpisodeIfReady,
  cloudRenderingEnabled,
  localRenderingEnabled,
  _test: { candidateById, assertRenderModeConfigured, billingContextForEpisode, episodeForInngestRun, terminalStages },
};
