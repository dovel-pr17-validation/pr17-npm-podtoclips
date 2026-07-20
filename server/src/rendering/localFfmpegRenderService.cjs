const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const cloudRunRenderer = require('../adapters/cloudRunRenderer.cjs');
const { getObjectStorage } = require('../objectStorage/index.cjs');
const { renderWithFfmpeg } = require('../renderWorker/runRenderJob.cjs');

function canRenderLocally(episode) {
  return episode.source?.mimeType?.startsWith('video/');
}

async function renderClipLocally({ episode, candidate, renderPlan, existingRender = {} }) {
  if (!canRenderLocally(episode)) {
    return {
      ...existingRender,
      status: existingRender.status || 'job_spec_ready',
      note: 'Local FFmpeg render skipped because this source is not a video file. Audio-only rendering needs the audiogram renderer.',
      renderPlan,
    };
  }

  const job = cloudRunRenderer.buildRenderJobPayload(episode, candidate, renderPlan);
  const jobSpecAsset = await getObjectStorage().putJson(`render_jobs/${episode.id}/${candidate.id}.json`, job);
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'easyed-auto-render-'));

  try {
    const output = await renderWithFfmpeg(job, workDir);
    return {
      ...existingRender,
      outputAssetKey: output.outputAssetKey,
      previewUrl: `/api/assets/${encodeURIComponent(output.outputAssetKey)}`,
      renderProvider: 'local-ffmpeg-worker',
      status: output.renderQc?.passed === false ? 'failed_qc' : 'rendered',
      note: output.renderQc?.passed === false
        ? 'Rendered locally, but the final output failed render QC and needs review.'
        : 'Rendered locally with FFmpeg and uploaded to R2.',
      outputBytes: output.outputBytes,
      renderQc: output.renderQc,
      qcFallbackApplied: output.qcFallbackApplied,
      renderedAt: new Date().toISOString(),
      jobSpecAssetKey: jobSpecAsset.key,
      jobSpecUrl: jobSpecAsset.url,
      renderPlan: output.renderPlan || renderPlan,
    };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

module.exports = {
  canRenderLocally,
  renderClipLocally,
};
