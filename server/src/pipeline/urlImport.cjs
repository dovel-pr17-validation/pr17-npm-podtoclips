const path = require('path');
const store = require('../storage/index.cjs');
const { getObjectStorage } = require('../objectStorage/index.cjs');
const { importVideoUrl } = require('../adapters/videoUrlIngest.cjs');
const { EpisodeStatus, StageStatus } = require('../domain/pipeline.cjs');
const { cacheKeyForImport, cacheKeyForVideoUrl } = require('../utils/videoCacheKey.cjs');
const { getAccountEntitlement } = require('../billing/entitlements.cjs');
const { requireEpisodeBillingAccountId } = require('../billing/generationIdentity.cjs');
const {
  assertDurationAllowed,
  assertUploadSizeAllowed,
  durationLimitFor,
  isSourceLimitError,
  sourceDurationSeconds,
} = require('../billing/freeTierLimits.cjs');
const durable = require('./durableOrchestrator.cjs');

const importLocks = new Map();

function cacheEnabled() {
  return process.env.EASYED_UPGRADES_ENABLED !== '0'
    && process.env.URL_IMPORT_CACHE_ENABLED !== '0';
}

function requiredDownloadProfile() {
  return process.env.YT_DLP_FAST_MODE_ENABLED !== '0' ? 'quality_1080p_concurrent_v2' : null;
}

async function reusableSource(episodeId, videoUrl, cacheKey) {
  if (!cacheEnabled()) return null;
  const source = await store.findReusableSource({
    excludeEpisodeId: episodeId,
    cacheKey,
    sourceUrl: videoUrl,
    downloadProfile: requiredDownloadProfile(),
  });
  if (!source) return null;
  return await getObjectStorage().existsKey(source.assetKey) ? source : null;
}

async function withImportLock(cacheKey, operation) {
  const previous = importLocks.get(cacheKey) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  importLocks.set(cacheKey, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (importLocks.get(cacheKey) === tail) importLocks.delete(cacheKey);
  }
}

async function completeIngest(episode, source, title, cacheHit = false) {
  const completedSource = completedImportSource(episode, source);
  await store.updateEpisode(episode.id, {
    title: episode.source?.requestedTitle ? episode.title : (title || episode.title),
    source: completedSource,
    status: EpisodeStatus.UPLOADED,
    error: undefined,
  });
  await store.updateStage(
    episode.id,
    'ingest',
    StageStatus.COMPLETED,
    cacheHit ? 'Existing video source reused from storage.' : 'Link downloaded and stored.',
  );
  return store.getEpisode(episode.id);
}

function completedImportSource(episode, source) {
  const {
    billing: _cachedBilling,
    orchestration: _cachedOrchestration,
    directUploadPending: _cachedUploadState,
    ...mediaSource
  } = source || {};
  const accountId = String(episode?.source?.billing?.accountId || '').trim();
  return {
    ...mediaSource,
    ...(accountId ? { billing: { accountId } } : {}),
  };
}

async function processUrlImportEpisode(episodeId) {
  const queuedEpisode = await store.getEpisode(episodeId);
  if (!queuedEpisode) throw new Error(`Episode not found: ${episodeId}`);
  const videoUrl = queuedEpisode.source?.import?.sourceUrl;
  if (!videoUrl) throw new Error(`Episode ${episodeId} has no source URL.`);
  const cacheKey = cacheKeyForImport(queuedEpisode.source.import) || cacheKeyForVideoUrl(videoUrl) || videoUrl;

  const performImport = async () => {
    const episode = await store.getEpisode(episodeId);
    try {
      const entitlement = await getAccountEntitlement(requireEpisodeBillingAccountId(episode));
      const cached = await reusableSource(episodeId, videoUrl, cacheKey);
      if (cached) {
        assertUploadSizeAllowed(entitlement, cached.size);
        assertDurationAllowed(entitlement, sourceDurationSeconds(cached));
        return completeIngest(episode, {
          ...cached,
          inputType: 'url',
          requestedTitle: Boolean(episode.source?.requestedTitle),
          import: { ...cached.import, sourceUrl: videoUrl, cacheKey, cacheHit: true },
        }, cached.import?.title, true);
      }

      const durationLimit = durationLimitFor(entitlement);
      const imported = await importVideoUrl(videoUrl, {
        maxDurationSeconds: durationLimit.seconds,
        durationLimitCode: durationLimit.code,
        durationLimitMessage: durationLimit.message,
      });
      try {
        assertUploadSizeAllowed(entitlement, imported.file.size);
        assertDurationAllowed(entitlement, imported.metadata?.durationSeconds);
        const extension = path.extname(imported.file.originalname) || '.bin';
        const assetKey = `episodes/${episode.id}/source${extension}`;
        const asset = await getObjectStorage().putUploadedFile(imported.file, assetKey);
        return completeIngest(episode, {
          originalName: imported.file.originalname,
          mimeType: imported.file.mimetype,
          assetKey,
          assetUrl: asset.url,
          size: asset.size,
          inputType: 'url',
          requestedTitle: Boolean(episode.source?.requestedTitle),
          import: { ...imported.metadata, cacheKey },
        }, imported.metadata.title);
      } finally {
        await imported.cleanup();
      }
    } catch (error) {
      if (isSourceLimitError(error)) {
        const canceled = await durable.markEpisodeCanceled(
          episodeId,
          error.message,
          episode?.source?.orchestration || {},
        );
        return {
          id: canceled.id,
          status: canceled.status,
          error: canceled.error,
          sourceLimitCanceled: true,
        };
      }
      await store.updateEpisode(episodeId, { status: EpisodeStatus.FAILED, error: error.message });
      await store.updateStage(episodeId, 'ingest', StageStatus.FAILED, error.message);
      throw error;
    }
  };

  return cacheEnabled() ? withImportLock(cacheKey, performImport) : performImport();
}

module.exports = {
  processUrlImportEpisode,
  _test: { cacheEnabled, completedImportSource, requiredDownloadProfile, reusableSource, withImportLock },
};
