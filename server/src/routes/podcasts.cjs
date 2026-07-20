const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createId } = require('../utils/ids.cjs');
const store = require('../storage/index.cjs');
const { getObjectStorageStatus, getObjectStorage } = require('../objectStorage/index.cjs');
const { getTranscriptionStatus } = require('../transcription/index.cjs');
const { getAiStatus } = require('../ai/index.cjs');
const { getVisualStatus } = require('../visual/index.cjs');
const { getSocialStatus, getSocialAdapter } = require('../social/index.cjs');
const { getRendererStatus } = require('../rendering/index.cjs');
const { enqueueEpisodePipeline, runEpisodePipeline } = require('../pipeline/orchestrator.cjs');
const { importVideoUrl, validateVideoUrl } = require('../adapters/videoUrlIngest.cjs');
const { processUrlImportEpisode } = require('../pipeline/urlImport.cjs');
const cloudRunRenderer = require('../adapters/cloudRunRenderer.cjs');
const { renderClipLocally } = require('../rendering/localFfmpegRenderService.cjs');
const { exportVideoProject } = require('../editing/videoEditorExport.cjs');
const { inngest } = require('../inngest/client.cjs');
const { Events } = require('../pipeline/events.cjs');
const { cacheKeyForVideoUrl } = require('../utils/videoCacheKey.cjs');
const { EpisodeStatus, StageStatus } = require('../domain/pipeline.cjs');
const { randomUUID } = require('node:crypto');
const { probeMediaDurationSeconds } = require('../media/mediaProbe.cjs');
const { requireEpisodeBillingAccountId } = require('../billing/generationIdentity.cjs');
const {
  MAX_DIRECT_UPLOAD_BYTES,
  assertDurationAllowed,
  assertUploadSizeAllowed,
  durationLimitFor,
  isSourceLimitError,
} = require('../billing/freeTierLimits.cjs');
const { sendSupportEmail, supportEmailConfig } = require('../support/supportEmail.cjs');
const {
  getAccountEntitlement,
  hasPaidPodcastAccess,
} = require('../billing/entitlements.cjs');
const { publicPlanCatalog } = require('../billing/plans.cjs');
const {
  billingConfiguration,
  changeSubscriptionPlan,
  createCheckoutSession,
  createCustomerPortalSession,
  getCurrentSubscriptionPlanChange,
  getSubscriptionPlanChangeStatus,
  previewSubscriptionPlanChange,
} = require('../billing/dodoBilling.cjs');

const UPLOAD_TMP_DIR = path.join(__dirname, '..', '..', 'tmp_uploads');
fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_TMP_DIR,
  limits: {
    fileSize: MAX_DIRECT_UPLOAD_BYTES,
  },
});

const router = express.Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const supportRateLimits = new Map();

function consumeSupportRateLimit(userId) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const recent = (supportRateLimits.get(userId) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= 5) return false;
  recent.push(now);
  supportRateLimits.set(userId, recent);
  return true;
}

function accountIdFor(req) {
  return req.authUserId || 'local-development';
}

function publicEpisode(episode) {
  if (!episode) return episode;
  const { ownerUserId: _ownerUserId, source = {}, ...publicRecord } = episode;
  const { billing: _billing, ...publicSource } = source;
  return { ...publicRecord, source: publicSource };
}

async function ownedEpisodeForRequest(req, episodeId) {
  return store.getEpisodeForOwner(String(episodeId || ''), accountIdFor(req));
}

async function ownedClipForRequest(req, clipId) {
  return store.getClipForOwner(String(clipId || ''), accountIdFor(req));
}

async function requirePaidAccessForRequest(req, res) {
  if (await hasPaidPodcastAccess(accountIdFor(req))) return true;
  const entitlement = await getAccountEntitlement(accountIdFor(req));
  sendUpgradeRequired(res, entitlement, 'Upgrade to rerun or manually render podcast clips.');
  return false;
}

function limitMessage(entitlement) {
  if (entitlement.plan === 'free') {
    return 'Your eight lifetime free clips have been used. Upgrade to generate more clips.';
  }
  if (!entitlement.isPaid) {
    return 'Your subscription is not active. Restore billing access to generate more clips.';
  }
  return `You have used all ${entitlement.clipsLimit} clips in this billing period.`;
}

function sendUpgradeRequired(res, entitlement, message = limitMessage(entitlement)) {
  return res.status(402).json({
    error: message,
    code: 'CLIP_QUOTA_REACHED',
    entitlement,
  });
}

const requireConversionAvailability = asyncHandler(async (req, res, next) => {
  const entitlement = await getAccountEntitlement(accountIdFor(req));
  if (!entitlement.canGenerateClips) return sendUpgradeRequired(res, entitlement);
  req.accountEntitlement = entitlement;
  return next();
});

async function triggerEpisodePipeline(episodeId) {
  if (process.env.USE_INNGEST === '1') {
    await inngest.send({
      name: Events.PODCAST_UPLOADED,
      data: { episodeId },
    });
  } else {
    enqueueEpisodePipeline(episodeId);
  }
}

async function createEpisodeFromSource({ file, title, description = '', accountId, entitlement, extraSource = {} }) {
  assertUploadSizeAllowed(entitlement, file.size);
  const durationSeconds = await probeMediaDurationSeconds(file.path);
  assertDurationAllowed(entitlement, durationSeconds);
  const episodeId = createId('episode');
  const originalName = file.originalname || 'podcast-source';
  const extension = path.extname(originalName) || '.bin';
  const assetKey = `episodes/${episodeId}/source${extension}`;
  const asset = await getObjectStorage().putUploadedFile(file, assetKey);

  const episode = await store.createEpisode({
    id: episodeId,
    ownerUserId: accountId,
    title: title || originalName.replace(extension, ''),
    description,
    source: {
      originalName,
      mimeType: file.mimetype,
      assetKey,
      assetUrl: asset.url,
      size: asset.size,
      durationSeconds,
      billing: { accountId },
      ...extraSource,
    },
  });

  await triggerEpisodePipeline(episode.id);
  return episode;
}

router.get('/architecture/status', (req, res) => {
  const objectStorage = getObjectStorageStatus();
  const transcription = getTranscriptionStatus();
  const ai = getAiStatus();
  const visual = getVisualStatus();
  const social = getSocialStatus();
  const renderer = getRendererStatus();

  res.json({
    app: 'podcast-repurposing-engine',
    architectureVersion: 'v4-parallel-cloud-run',
    orchestration: {
      local: process.env.USE_INNGEST === '1' ? 'Inngest Dev Server' : 'in-process event runner',
      productionTarget: 'Durable Inngest stages with per-clip Cloud Run fan-out/fan-in',
    },
    adapters: {
      storage: objectStorage.provider === 'r2' ? 'Cloudflare R2' : 'local filesystem; production target Cloudflare R2',
      urlImport: 'yt-dlp source import to R2',
      database: process.env.DATABASE_URL ? 'Neon Postgres' : 'local JSON catalog fallback',
      transcription: transcription === 'assemblyai' ? 'AssemblyAI' : 'local deterministic adapter; production target AssemblyAI or ElevenLabs Scribe',
      scoring: ai === 'openrouter' ? 'OpenRouter Gemini structured JSON' : 'local heuristic adapter; production target Gemini Flash-Lite/Flash',
      visualVerification: visual === 'openrouter-vision' ? 'FFmpeg scene frames + OpenRouter Gemini image input' : 'local placeholder; production target FFmpeg scene-change + Gemini image input',
      rendering: renderer === 'cloud-run-jobs' ? 'Cloud Run Jobs render specs/dispatch' : 'local render-plan adapter; production target FFmpeg Cloud Run Jobs',
      animation: 'Remotion scene-script rendering inside the Cloud Run render worker',
      social: social === 'openrouter' ? 'OpenRouter Gemini' : 'local deterministic adapter',
    },
  });
});

router.get('/support/config', (req, res) => {
  const config = supportEmailConfig();
  res.json({ receiver: config.receiver, configured: config.configured });
});

router.post('/support/messages', asyncHandler(async (req, res) => {
  const senderEmail = String(req.body.senderEmail || '').trim().toLowerCase();
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    return res.status(400).json({ error: 'Enter a valid sender email address.' });
  }
  if (subject.length < 3 || subject.length > 160) {
    return res.status(400).json({ error: 'Subject must be between 3 and 160 characters.' });
  }
  if (body.length < 10 || body.length > 10000) {
    return res.status(400).json({ error: 'Message must be between 10 and 10,000 characters.' });
  }
  if (!consumeSupportRateLimit(req.authUserId || req.ip)) {
    return res.status(429).json({ error: 'Too many support messages. Please wait a few minutes and try again.' });
  }

  const result = await sendSupportEmail({
    senderEmail,
    subject,
    body,
    requestId: randomUUID(),
  });
  return res.status(201).json({ sent: true, messageId: result.id });
}));

router.get('/billing/entitlement', asyncHandler(async (req, res) => {
  res.json(await getAccountEntitlement(accountIdFor(req)));
}));

router.get('/billing/plans', (req, res) => {
  res.json({ plans: publicPlanCatalog(), configuration: billingConfiguration() });
});

router.post('/billing/checkout', asyncHandler(async (req, res) => {
  const checkout = await createCheckoutSession({
    userId: accountIdFor(req),
    planId: req.body.plan,
    email: req.body.email,
    name: req.body.name,
  });
  res.status(201).json(checkout);
}));

router.post('/billing/portal', asyncHandler(async (req, res) => {
  res.status(201).json(await createCustomerPortalSession(accountIdFor(req)));
}));

router.post('/billing/plan-change/preview', asyncHandler(async (req, res) => {
  res.json(await previewSubscriptionPlanChange({
    userId: accountIdFor(req),
    planId: req.body.plan,
  }));
}));

router.post('/billing/plan-change', asyncHandler(async (req, res) => {
  res.status(202).json(await changeSubscriptionPlan({
    userId: accountIdFor(req),
    planId: req.body.plan,
    requestId: req.body.requestId,
  }));
}));

router.post('/billing/plan-change/status', asyncHandler(async (req, res) => {
  res.json(await getSubscriptionPlanChangeStatus({
    userId: accountIdFor(req),
    planId: req.body.plan,
  }));
}));

router.get('/billing/plan-change/current', asyncHandler(async (req, res) => {
  res.json(await getCurrentSubscriptionPlanChange(accountIdFor(req)));
}));

router.get('/podcasts', asyncHandler(async (req, res) => {
  const episodes = await store.listEpisodesForOwner(accountIdFor(req));
  res.json(episodes.map(publicEpisode));
}));

router.post('/podcasts/upload', requireConversionAvailability, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Upload a podcast audio or video file using the "file" field.' });
  }
  try {
    const episode = await createEpisodeFromSource({
      file: req.file,
      title: req.body.title,
      description: req.body.description || '',
      accountId: accountIdFor(req),
      entitlement: req.accountEntitlement,
      extraSource: {
        inputType: 'file',
      },
    });
    res.status(202).json(publicEpisode(episode));
  } catch (error) {
    fs.rm(req.file.path, { force: true }, () => {});
    throw error;
  }
}));

router.post('/podcasts/upload-direct/request', requireConversionAvailability, asyncHandler(async (req, res) => {
  const objectStorage = getObjectStorage();
  if (!objectStorage.getSignedUploadUrl) {
    return res.status(501).json({ error: 'Direct upload is only available with production object storage.' });
  }

  const originalName = path.basename(String(req.body.fileName || 'podcast-source'));
  const mimeType = String(req.body.mimeType || 'application/octet-stream');
  const size = Number(req.body.size || 0);
  assertUploadSizeAllowed(req.accountEntitlement, size);
  const reportedDuration = Number(req.body.durationSeconds || 0);
  if (reportedDuration > 0) assertDurationAllowed(req.accountEntitlement, reportedDuration);

  const episodeId = createId('episode');
  const extension = path.extname(originalName) || '.bin';
  const assetKey = `episodes/${episodeId}/source${extension}`;
  const episode = await store.createEpisode({
    id: episodeId,
    ownerUserId: accountIdFor(req),
    title: req.body.title || originalName.replace(extension, ''),
    description: req.body.description || '',
    ingestPending: true,
    source: {
      originalName,
      mimeType,
      assetKey,
      size,
      inputType: 'file',
      directUploadPending: true,
      billing: { accountId: accountIdFor(req) },
    },
  });

  res.status(201).json({
    episode: publicEpisode(episode),
    uploadUrl: await objectStorage.getSignedUploadUrl(assetKey, mimeType),
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
  });
}));

router.post('/podcasts/upload-direct/complete', asyncHandler(async (req, res) => {
  const episode = await ownedEpisodeForRequest(req, req.body.episodeId);
  if (!episode || !episode.source?.directUploadPending) {
    return res.status(404).json({ error: 'Pending direct upload not found.' });
  }
  if (!await getObjectStorage().existsKey(episode.source.assetKey)) {
    return res.status(409).json({ error: 'The uploaded object is not available yet.' });
  }
  const accountId = accountIdFor(req);
  if (requireEpisodeBillingAccountId(episode) !== accountId) return res.status(404).json({ error: 'Pending direct upload not found.' });
  const entitlement = await getAccountEntitlement(accountId);
  if (!entitlement.canGenerateClips) return sendUpgradeRequired(res, entitlement);

  const objectStorage = getObjectStorage();
  const probeSource = objectStorage.resolveKey?.(episode.source.assetKey)
    || await objectStorage.getSignedReadUrl?.(episode.source.assetKey);
  if (!probeSource) throw new Error('The uploaded podcast could not be inspected.');

  let durationSeconds;
  try {
    durationSeconds = await probeMediaDurationSeconds(probeSource);
    assertDurationAllowed(entitlement, durationSeconds);
  } catch (error) {
    try {
      await objectStorage.deleteKey?.(episode.source.assetKey);
    } catch {
      // Preserve the duration validation error even if rejected-object cleanup fails.
    }
    await store.updateEpisode(episode.id, {
      status: isSourceLimitError(error) ? EpisodeStatus.CANCELED : EpisodeStatus.FAILED,
      error: error.message,
      source: { ...episode.source, directUploadPending: false },
    });
    await store.updateStage(episode.id, 'ingest', StageStatus.FAILED, error.message);
    throw error;
  }

  await store.updateEpisode(episode.id, {
    source: { ...episode.source, durationSeconds, directUploadPending: false },
  });
  await store.updateStage(episode.id, 'ingest', StageStatus.COMPLETED, 'Direct upload stored in R2.');
  await triggerEpisodePipeline(episode.id);
  res.status(202).json(publicEpisode(await ownedEpisodeForRequest(req, episode.id)));
}));

router.post('/podcasts/import-url', requireConversionAvailability, asyncHandler(async (req, res) => {
  const videoUrl = req.body.videoUrl || req.body.url;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Send a podcast or video URL in the "videoUrl" field.' });
  }

  const asyncImportEnabled = process.env.EASYED_UPGRADES_ENABLED !== '0'
    && process.env.ASYNC_URL_INGEST_ENABLED !== '0';
  if (asyncImportEnabled) {
    const normalizedUrl = validateVideoUrl(videoUrl);
    const episodeId = createId('episode');
    const requestedTitle = Boolean(req.body.title?.trim());
    const episode = await store.createEpisode({
      id: episodeId,
      ownerUserId: accountIdFor(req),
      title: req.body.title?.trim() || 'Queued video import',
      description: req.body.description || '',
      status: 'processing',
      ingestPending: true,
      source: {
        originalName: 'Downloading from link…',
        mimeType: 'application/octet-stream',
        assetKey: '',
        assetUrl: '',
        size: 0,
        inputType: 'url',
        billing: { accountId: accountIdFor(req) },
        requestedTitle,
        import: { sourceUrl: normalizedUrl, cacheKey: cacheKeyForVideoUrl(normalizedUrl) },
      },
    });

    if (process.env.USE_INNGEST === '1') {
      await inngest.send({ name: Events.URL_IMPORT_REQUESTED, data: { episodeId } });
    } else {
      setImmediate(async () => {
        try {
          await processUrlImportEpisode(episodeId);
          enqueueEpisodePipeline(episodeId);
        } catch (error) {
          console.error(`Background URL import failed: ${error.message}`);
        }
      });
    }
    return res.status(202).json(publicEpisode(episode));
  }

  const durationLimit = durationLimitFor(req.accountEntitlement);
  const imported = await importVideoUrl(videoUrl, {
    maxDurationSeconds: durationLimit.seconds,
    durationLimitCode: durationLimit.code,
    durationLimitMessage: durationLimit.message,
  });
  try {
    const episode = await createEpisodeFromSource({
      file: imported.file,
      title: req.body.title || imported.metadata.title,
      description: req.body.description || '',
      accountId: accountIdFor(req),
      entitlement: req.accountEntitlement,
      extraSource: {
        inputType: 'url',
        import: imported.metadata,
      },
    });

    return res.status(202).json(publicEpisode(episode));
  } finally {
    await imported.cleanup();
  }
}));

router.get('/podcasts/:episodeId', asyncHandler(async (req, res) => {
  const episode = await ownedEpisodeForRequest(req, req.params.episodeId);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });
  res.json(publicEpisode(episode));
}));

router.post('/podcasts/:episodeId/reprocess', asyncHandler(async (req, res) => {
  const episode = await ownedEpisodeForRequest(req, req.params.episodeId);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });
  if (!await requirePaidAccessForRequest(req, res)) return undefined;

  if (process.env.USE_INNGEST === '1') {
    await triggerEpisodePipeline(episode.id);
  } else {
    await runEpisodePipeline(episode.id);
  }

  res.json(publicEpisode(await ownedEpisodeForRequest(req, episode.id)));
}));

router.get('/podcasts/:episodeId/clips', asyncHandler(async (req, res) => {
  const episode = await ownedEpisodeForRequest(req, req.params.episodeId);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });
  res.json(await store.listClipsForEpisodeForOwner(episode.id, accountIdFor(req)));
}));

router.get('/clips/:clipId', asyncHandler(async (req, res) => {
  const clip = await ownedClipForRequest(req, req.params.clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  res.json(clip);
}));

router.post('/clips/:clipId/render-local', asyncHandler(async (req, res) => {
  const clip = await ownedClipForRequest(req, req.params.clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (!await requirePaidAccessForRequest(req, res)) return undefined;

  const episode = await ownedEpisodeForRequest(req, clip.episodeId);
  if (!episode) return res.status(404).json({ error: 'Episode not found' });

  const candidate = {
    id: clip.candidateId,
    episodeId: clip.episodeId,
    title: clip.title,
    category: clip.category,
    narrativeType: clip.narrativeType,
    confidence: clip.confidence,
    start: clip.start,
    end: clip.end,
    transcript: clip.transcript,
    reasoning: clip.reasoning,
    visualVerification: clip.visualVerification,
    sceneScript: clip.sceneScript,
  };

  const existingComposition = clip.render?.renderPlan?.composition || {};
  const existingPlanIsFallback = Boolean(existingComposition.qcFallback)
    || ['safe_contain_blur', 'stacked_speaker_blur'].includes(existingComposition.mode);
  const renderPlan = clip.render?.renderPlan?.captionTrack
    && clip.render?.renderPlan?.composition?.detectedRegions
    && !existingPlanIsFallback
    ? clip.render.renderPlan
    : await cloudRunRenderer.createRenderPlan(episode, candidate, clip.visualVerification, clip.sceneScript);
  const nextRender = await renderClipLocally({
    episode,
    candidate,
    renderPlan,
    existingRender: clip.render,
  });
  const updated = await store.updateClipRender(clip.id, nextRender);
  return res.json(updated);
}));

// Editor media lives in object storage so a project can use uploaded music and
// generated clips with the same export worker, never browser-only blob URLs.
router.post('/editor/assets/upload', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an audio or video file.' });
  if (!req.file.mimetype.startsWith('audio/') && !req.file.mimetype.startsWith('video/')) {
    return res.status(400).json({ error: 'Only audio and video files can be used in the editor.' });
  }
  const extension = path.extname(req.file.originalname || '') || (req.file.mimetype.startsWith('audio/') ? '.mp3' : '.mp4');
  const asset = await getObjectStorage().putUploadedFile(req.file, `editor_uploads/${createId('media')}${extension}`);
  await store.recordUserAsset({ assetKey: asset.key, userId: accountIdFor(req), kind: 'editor_upload' });
  res.status(201).json({ assetKey: asset.key, url: asset.url, name: req.file.originalname, mimeType: req.file.mimetype, size: asset.size });
}));

router.post('/editor/exports', asyncHandler(async (req, res) => {
  const assetKeys = [
    ...(Array.isArray(req.body?.segments) ? req.body.segments.map((segment) => segment?.assetKey) : []),
    req.body?.music?.assetKey,
  ].filter(Boolean);
  const ownership = await Promise.all(assetKeys.map((assetKey) => store.assetBelongsToOwner(String(assetKey), accountIdFor(req))));
  if (!assetKeys.length || ownership.some((owns) => !owns)) return res.status(404).json({ error: 'One or more editor assets were not found.' });
  const result = await exportVideoProject(req.body);
  await store.recordUserAsset({ assetKey: result.outputAssetKey, userId: accountIdFor(req), kind: 'editor_export' });
  res.status(201).json(result);
}));

router.post('/clips/:clipId/social-posts', asyncHandler(async (req, res) => {
  const clip = await ownedClipForRequest(req, req.params.clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  const post = await getSocialAdapter().generateSocialPosts(clip);
  await store.savePost(post);
  res.status(201).json(post);
}));

router.post('/clips/:clipId/social-posts/request', asyncHandler(async (req, res) => {
  const clip = await ownedClipForRequest(req, req.params.clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  if (process.env.USE_INNGEST !== '1') {
    const post = await getSocialAdapter().generateSocialPosts(clip);
    await store.savePost(post);
    return res.status(201).json({ status: 'completed', post });
  }

  const result = await inngest.send({
    name: Events.POSTS_REQUESTED,
    data: {
      clipId: clip.id,
      episodeId: clip.episodeId,
      requestedAt: new Date().toISOString(),
    },
  });

  return res.status(202).json({
    status: 'queued',
    clipId: clip.id,
    eventIds: result.ids,
    pollUrl: `/api/clips/${clip.id}/social-posts`,
  });
}));

router.get('/clips/:clipId/social-posts', asyncHandler(async (req, res) => {
  const clip = await ownedClipForRequest(req, req.params.clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  res.json(await store.listPostsForClip(clip.id));
}));

module.exports = router;
module.exports._test = { accountIdFor, ownedClipForRequest, ownedEpisodeForRequest, publicEpisode };
