const crypto = require('node:crypto');

const DEFAULT_TTL_SECONDS = 300;

function tokenSecret() {
  const secret = process.env.ASSET_ACCESS_TOKEN_SECRET || process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error('ASSET_ACCESS_TOKEN_SECRET or CLERK_SECRET_KEY is required for local asset access.');
  return secret;
}

function normalizeAssetKey(value) {
  let key;
  try {
    key = decodeURIComponent(String(value || '')).trim();
  } catch {
    throw new Error('Invalid asset key.');
  }
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\') || key.includes('\0')) {
    throw new Error('Invalid asset key.');
  }
  return key;
}

function signature(encodedPayload) {
  return crypto.createHmac('sha256', tokenSecret()).update(encodedPayload).digest('base64url');
}

function createLocalAssetToken({ assetKey, downloadName = null, nowMs = Date.now() }) {
  const ttlSeconds = Math.max(30, Math.min(900, Number(process.env.ASSET_ACCESS_TOKEN_TTL_SECONDS || DEFAULT_TTL_SECONDS)));
  const payload = Buffer.from(JSON.stringify({
    key: normalizeAssetKey(assetKey),
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
    downloadName: downloadName ? String(downloadName).slice(0, 180) : null,
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function verifyLocalAssetToken(token, requestedKey, nowMs = Date.now()) {
  const [payload, suppliedSignature, ...extra] = String(token || '').split('.');
  if (!payload || !suppliedSignature || extra.length) return null;
  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed.key !== normalizeAssetKey(requestedKey) || !Number.isFinite(parsed.exp) || parsed.exp < Math.floor(nowMs / 1000)) return null;
  return parsed;
}

module.exports = { createLocalAssetToken, normalizeAssetKey, verifyLocalAssetToken };
