const express = require('express');
const cors = require('cors');
const path = require('path');
const { serve } = require('inngest/express');
const podcastRoutes = require('./routes/podcasts.cjs');
const store = require('./storage/index.cjs');
const { getObjectStorage } = require('./objectStorage/index.cjs');
const { inngest } = require('./inngest/client.cjs');
const { functions } = require('./inngest/functions.cjs');
const { assertClerkConfiguration, clerkSessionMiddleware, requireAuthenticatedRequest } = require('./auth/clerkAuth.cjs');
const { handleDodoWebhook } = require('./billing/dodoBilling.cjs');
const { createLocalAssetToken, normalizeAssetKey, verifyLocalAssetToken } = require('./security/assetAccess.cjs');

function safeDownloadName(key) {
  const baseName = path.basename(key).replace(/[^a-zA-Z0-9._-]/g, '_');
  return baseName.toLowerCase().endsWith('.mp4') ? baseName : `${baseName || 'podtoclips-export'}.mp4`;
}

async function ownedAsset(req, res) {
  let key;
  try {
    key = normalizeAssetKey(req.params.key);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return null;
  }
  if (!await store.assetBelongsToOwner(key, req.authUserId)) {
    res.status(404).json({ error: 'Asset not found' });
    return null;
  }
  return key;
}

async function assetAccessResponse(req, res, next, { download = false } = {}) {
  const key = await ownedAsset(req, res);
  if (!key) return undefined;
  const objectStorage = getObjectStorage();
  const downloadName = download ? safeDownloadName(key) : null;

  if (objectStorage.getSignedReadUrl) {
    try {
      return res.json({ url: await objectStorage.getSignedReadUrl(key, { downloadName, expiresIn: 300 }), expiresIn: 300 });
    } catch (error) {
      return next(error);
    }
  }

  if (objectStorage.resolveKey?.(key)) {
    const token = createLocalAssetToken({ assetKey: key, downloadName });
    return res.json({
      url: `/api/assets/local/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`,
      expiresIn: 300,
    });
  }

  return res.status(404).json({ error: 'Asset not found' });
}

function createApp() {
  assertClerkConfiguration();
  const app = express();

  app.use(clerkSessionMiddleware());
  app.use(cors());
  app.post(
    '/api/billing/dodo/webhook',
    express.raw({ type: 'application/json', limit: '256kb' }),
    (req, res, next) => Promise.resolve(handleDodoWebhook(req, res)).catch(next),
  );
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/inngest', serve({ client: inngest, functions }));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      app: 'podcast-repurposing-engine',
      architectureVersion: 'v4-parallel-cloud-run',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/assets/local/:key', (req, res) => {
    const objectStorage = getObjectStorage();
    if (!objectStorage.resolveKey) return res.status(404).json({ error: 'Asset not found' });
    const access = verifyLocalAssetToken(req.query.token, req.params.key);
    if (!access) return res.status(401).json({ error: 'Asset access has expired.' });
    const filePath = objectStorage.resolveKey(access.key);
    if (!filePath) return res.status(404).json({ error: 'Asset not found' });
    return access.downloadName
      ? res.download(path.resolve(filePath), access.downloadName)
      : res.sendFile(path.resolve(filePath));
  });

  app.use('/api', requireAuthenticatedRequest, podcastRoutes);

  app.get('/api/assets/access/:key', requireAuthenticatedRequest, (req, res, next) => assetAccessResponse(req, res, next));
  app.get('/api/assets/download-access/:key', requireAuthenticatedRequest, (req, res, next) => assetAccessResponse(req, res, next, { download: true }));
  app.get('/api/assets/status/:key', requireAuthenticatedRequest, async (req, res, next) => {
    const key = await ownedAsset(req, res);
    if (!key) return undefined;
    const objectStorage = getObjectStorage();
    try {
      const exists = objectStorage.existsKey
        ? await objectStorage.existsKey(key)
        : Boolean(objectStorage.resolveKey?.(key));
      return res.json({ key, exists });
    } catch (error) {
      return next(error);
    }
  });

  // Legacy asset routes remain authenticated during the client transition.
  app.get('/api/assets/:key', requireAuthenticatedRequest, async (req, res, next) => {
    const key = await ownedAsset(req, res);
    if (!key) return undefined;
    const objectStorage = getObjectStorage();
    const filePath = objectStorage.resolveKey?.(key);
    if (filePath) return res.sendFile(path.resolve(filePath));
    try {
      return res.redirect(await objectStorage.getSignedReadUrl(key));
    } catch (error) {
      return next(error);
    }
  });
  app.get('/api/assets/download/:key', requireAuthenticatedRequest, async (req, res, next) => {
    const key = await ownedAsset(req, res);
    if (!key) return undefined;
    const objectStorage = getObjectStorage();
    const downloadName = safeDownloadName(key);
    const filePath = objectStorage.resolveKey?.(key);
    if (filePath) return res.download(path.resolve(filePath), downloadName);
    try {
      return res.redirect(await objectStorage.getSignedReadUrl(key, { downloadName }));
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    return res.status(error.statusCode || 500).json({
      error: error.message || 'Internal server error',
    });
  });

  return app;
}

module.exports = { createApp };
