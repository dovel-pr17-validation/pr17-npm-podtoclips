const { createRenderPlan } = require('./localRenderer.cjs');
const { getObjectStorage } = require('../objectStorage/index.cjs');
const cloudRunJobs = require('./cloudRunJobsClient.cjs');

function buildRenderJobPayload(episode, candidate, renderPlan) {
  const outputAssetKey = `renders/${episode.id}/${candidate.id}.mp4`;
  const animationOutputAssetKey = renderPlan.animation
    ? `renders/${episode.id}/${candidate.id}.animation.mp4`
    : null;

  return {
    schemaVersion: '2026-07-07',
    jobType: 'podcast_clip_render',
    episode: {
      id: episode.id,
      title: episode.title,
      source: {
        assetKey: episode.source.assetKey,
        mimeType: episode.source.mimeType,
        inputType: episode.source.inputType || 'file',
      },
    },
    clip: {
      candidateId: candidate.id,
      title: candidate.title,
      category: candidate.category,
      narrativeType: candidate.narrativeType,
      start: renderPlan.start,
      end: renderPlan.end,
      duration: renderPlan.duration,
      transcript: candidate.transcript,
      boundaryRefinement: candidate.boundaryRefinement || null,
    },
    output: {
      assetKey: outputAssetKey,
      animationAssetKey: animationOutputAssetKey,
      contentType: 'video/mp4',
    },
    result: {
      assetKey: `render_results/${episode.id}/${candidate.id}.json`,
      contentType: 'application/json',
    },
    renderPlan,
    ffmpeg: {
      targetAspectRatio: renderPlan.aspectRatio,
      outputCodec: 'libx264',
      audioCodec: 'aac',
      captionMode: renderPlan.captionTrack?.engine === 'remotion_captions'
        ? 'remotion_paginated_word_highlight_ass'
        : 'styled_ass',
      verticalPreset: renderPlan.composition?.mode || 'safe_contain_blur',
    },
    remotion: renderPlan.animation
      ? {
          enabled: true,
          composition: 'UiFlowStoryboard',
          inputProps: {
            sceneScript: renderPlan.animation.sceneScript,
          },
        }
      : {
          enabled: false,
        },
  };
}

async function dispatchToRenderService(payload) {
  if (!process.env.CLOUD_RUN_RENDER_DISPATCH_URL) return null;

  const response = await fetch(process.env.CLOUD_RUN_RENDER_DISPATCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CLOUD_RUN_RENDER_DISPATCH_TOKEN
        ? { Authorization: `Bearer ${process.env.CLOUD_RUN_RENDER_DISPATCH_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `Cloud Run render dispatch failed with ${response.status}`);
  }
  return data;
}

async function prepareRenderClip(episode, candidate, renderPlan) {
  const payload = buildRenderJobPayload(episode, candidate, renderPlan);
  const jobSpecKey = `render_jobs/${episode.id}/${candidate.id}.json`;
  const jobSpecAsset = await getObjectStorage().putJson(jobSpecKey, payload);

  return {
    outputAssetKey: payload.output.assetKey,
    previewUrl: null,
    renderProvider: 'cloud-run-jobs',
    status: 'queued',
    note: 'Render job spec created and ready for durable Cloud Run dispatch.',
    jobSpecAssetKey: jobSpecAsset.key,
    jobSpecUrl: jobSpecAsset.url,
    resultAssetKey: payload.result.assetKey,
    dispatchResult: null,
    renderPlan,
  };
}

async function renderClip(episode, candidate, renderPlan) {
  const prepared = await prepareRenderClip(episode, candidate, renderPlan);
  const payload = buildRenderJobPayload(episode, candidate, renderPlan);
  const dispatchResult = await dispatchToRenderService(payload);
  return dispatchResult
    ? {
        ...prepared,
        status: 'queued',
        note: 'Render job submitted to the legacy Cloud Run dispatcher.',
        dispatchResult,
      }
    : prepared;
}

async function dispatchPreparedRender(render) {
  if (!render?.jobSpecAssetKey) throw new Error('Prepared render is missing jobSpecAssetKey.');
  const operation = await cloudRunJobs.executeRenderJob({ jobSpecAssetKey: render.jobSpecAssetKey });
  return {
    ...render,
    status: 'running',
    operationName: operation.name,
    dispatchedAt: new Date().toISOString(),
  };
}

async function waitForPreparedRender(render) {
  if (!render?.operationName) throw new Error('Dispatched render is missing operationName.');
  return cloudRunJobs.waitForOperation(render.operationName);
}

module.exports = {
  provider: 'cloud-run-jobs',
  createRenderPlan,
  prepareRenderClip,
  renderClip,
  dispatchPreparedRender,
  waitForPreparedRender,
  buildRenderJobPayload,
};
