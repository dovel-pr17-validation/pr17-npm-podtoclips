const { inngest } = require('./client.cjs');
const { Events } = require('../pipeline/events.cjs');
const store = require('../storage/index.cjs');
const { StageStatus } = require('../domain/pipeline.cjs');
const { getSocialAdapter } = require('../social/index.cjs');
const { processUrlImportEpisode } = require('../pipeline/urlImport.cjs');
const durable = require('../pipeline/durableOrchestrator.cjs');
const { isSourceLimitError } = require('../billing/freeTierLimits.cjs');

function sourceLimitCanceled(result) {
  return result?.sourceLimitCanceled === true || result?.status === 'canceled';
}

async function runUrlImportWorkflow({ event, step, runId }, dependencies = {}) {
  const processImport = dependencies.processImport || processUrlImportEpisode;
  const bindRun = dependencies.bindRun || durable.bindEpisodeInngestRun;
  const { episodeId } = event.data;
  await step.run('bind-inngest-run', () => bindRun(episodeId, runId, 'import-podcast-url'));
  const imported = await step.run('download-and-store-video-url', () => processImport(episodeId));
  if (sourceLimitCanceled(imported)) {
    return { episodeId, status: 'canceled', reason: imported.error };
  }
  await step.sendEvent('start-podcast-pipeline', {
    name: Events.PODCAST_UPLOADED,
    data: { episodeId },
  });
  return { episodeId };
}

async function runCandidateStepsInBatches({ step, candidateIds, size, idPrefix, handler }) {
  const results = [];
  for (let offset = 0; offset < candidateIds.length; offset += size) {
    const batch = candidateIds.slice(offset, offset + size);
    const completed = await Promise.all(batch.map((candidateId, batchIndex) => (
      step.run(`${idPrefix}-${offset + batchIndex}`, () => handler(candidateId))
    )));
    results.push(...completed);
  }
  return results;
}

async function persistPodcastFunctionFailure({ event, step }) {
  const originalData = event.data?.event?.data || {};
  const episodeId = originalData.episodeId;
  if (!episodeId) return { matched: false };
  return step.run('persist-project-workflow-failure', async () => {
    if (originalData.clipId) {
      await durable.markClipRenderFailed(originalData.clipId, event.data?.error || new Error('The Inngest render workflow failed.'));
    }
    const episode = await durable.markEpisodeFailedFromInngest(
      episodeId,
      event.data?.error || new Error('The Inngest workflow failed.'),
      { runId: event.data?.run_id, functionId: event.data?.function_id },
    );
    return { episodeId: episode.id, status: episode.status };
  });
}

const importPodcastUrl = inngest.createFunction(
  {
    id: 'import-podcast-url',
    name: 'Import Podcast URL',
    triggers: [{ event: Events.URL_IMPORT_REQUESTED }],
    onFailure: persistPodcastFunctionFailure,
  },
  runUrlImportWorkflow,
);

const processPodcastUpload = inngest.createFunction(
  {
    id: 'process-podcast-upload',
    name: 'Process Podcast Upload',
    triggers: [{ event: Events.PODCAST_UPLOADED }],
    onFailure: persistPodcastFunctionFailure,
  },
  async ({ event, step, runId }) => {
    const { episodeId } = event.data;
    await step.run('bind-inngest-run', () => durable.bindEpisodeInngestRun(episodeId, runId, 'process-podcast-upload'));
    const initialized = await step.run('initialize-episode', async () => {
      try {
        return await durable.beginEpisode(episodeId);
      } catch (error) {
        if (!isSourceLimitError(error)) throw error;
        const canceled = await durable.markEpisodeCanceled(episodeId, error.message, {
          runId,
          functionId: 'process-podcast-upload',
        });
        return { episodeId, status: canceled.status, sourceLimitCanceled: true, error: canceled.error };
      }
    });
    if (sourceLimitCanceled(initialized)) {
      return { episodeId, status: 'canceled', reason: initialized.error };
    }
    await step.run('transcribe-and-diarize', () => durable.transcribeEpisode(episodeId));
    const selection = await step.run('discover-rank-and-complete-moments', () => durable.selectMoments(episodeId));

    await step.run('start-parallel-visual-verification', async () => {
      await store.updateStage(episodeId, 'visual_verification', StageStatus.RUNNING, `Verifying ${selection.candidateIds.length} candidate windows in parallel.`);
      return { status: StageStatus.RUNNING };
    });
    const visualResults = await runCandidateStepsInBatches({
      step,
      candidateIds: selection.candidateIds,
      size: Math.max(1, Number(process.env.VISUAL_FAN_OUT_LIMIT || 4)),
      idPrefix: 'verify-candidate-visuals',
      handler: (candidateId) => durable.verifyCandidateVisuals(episodeId, candidateId),
    });
    await step.run('persist-visual-verification', () => durable.persistVisualVerifications(episodeId, visualResults));

    await step.run('start-parallel-scene-extraction', async () => {
      await store.updateStage(episodeId, 'ui_flow_extraction', StageStatus.RUNNING, 'Extracting candidate scene scripts in parallel.');
      return { status: StageStatus.RUNNING };
    });
    const sceneResults = await runCandidateStepsInBatches({
      step,
      candidateIds: selection.candidateIds,
      size: Math.max(1, Number(process.env.SCENE_SCRIPT_FAN_OUT_LIMIT || 4)),
      idPrefix: 'extract-candidate-scene',
      handler: (candidateId) => durable.extractCandidateSceneScript(episodeId, candidateId),
    });
    await step.run('persist-scene-scripts', () => durable.persistSceneScripts(episodeId, sceneResults));

    const planned = await step.run('rank-plan-and-persist-clips', () => durable.planEpisodeRenders(episodeId));
    if (planned.clipIds.length) {
      await step.sendEvent('fan-out-independent-clip-renders', planned.clipIds.map((clipId) => ({
        name: Events.CLIP_RENDER_REQUESTED,
        data: { episodeId, clipId },
      })));
    }
    return { episodeId, clipIds: planned.clipIds, status: planned.clipIds.length ? 'rendering' : 'ready' };
  }
);

const renderPodcastClip = inngest.createFunction(
  {
    id: 'render-podcast-clip',
    name: 'Render Podcast Clip',
    concurrency: {
      limit: Number(process.env.RENDER_FAN_OUT_LIMIT || 8),
      key: 'event.data.episodeId',
    },
    triggers: [{ event: Events.CLIP_RENDER_REQUESTED }],
    onFailure: persistPodcastFunctionFailure,
  },
  async ({ event, step, runId }) => {
    const { episodeId, clipId } = event.data;
    await step.run('bind-render-inngest-run', () => durable.bindClipInngestRun(clipId, runId, 'render-podcast-clip'));
    try {
      const dispatched = await step.run('dispatch-cloud-run-render', () => durable.dispatchClipRender(clipId));
      if (!dispatched.local) {
        await step.run('wait-for-cloud-run-render', () => durable.waitForClipRender(clipId));
      }
      const render = await step.run('collect-render-result', () => durable.completeClipRender(clipId));
      await step.run('finalize-episode-if-complete', () => durable.finalizeEpisodeIfReady(episodeId));
      return { episodeId, clipId, status: render.status };
    } catch (error) {
      await step.run('persist-render-failure', () => durable.markClipRenderFailed(clipId, error));
      await step.run('finalize-episode-after-failure', () => durable.finalizeEpisodeIfReady(episodeId));
      return { episodeId, clipId, status: 'failed', error: error.message };
    }
  },
);

const reconcileCancelledPodcastRun = inngest.createFunction(
  {
    id: 'reconcile-cancelled-podcast-run',
    name: 'Reconcile Cancelled Podcast Run',
    triggers: [{ event: 'inngest/function.cancelled' }],
  },
  async ({ event, step }) => step.run('persist-cancelled-project', () => durable.reconcileCancelledInngestRun({
    runId: event.data?.run_id,
    functionId: event.data?.function_id,
  })),
);

const generatePosts = inngest.createFunction(
  {
    id: 'generate-social-posts',
    name: 'Generate Social Posts',
    triggers: [{ event: Events.POSTS_REQUESTED }],
  },
  async ({ event, step }) => {
    const { clipId } = event.data;
    return step.run('generate-and-save-posts', async () => {
      const clip = await store.getClip(clipId);
      if (!clip) throw new Error(`Clip not found: ${clipId}`);
      const post = await getSocialAdapter().generateSocialPosts(clip);
      await store.savePost(post);
      return post;
    });
  }
);

module.exports = {
  functions: [importPodcastUrl, processPodcastUpload, renderPodcastClip, reconcileCancelledPodcastRun, generatePosts],
  _test: { runUrlImportWorkflow, sourceLimitCanceled },
};
