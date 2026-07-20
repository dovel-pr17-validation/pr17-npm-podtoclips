const TRACKING_PARAMETERS = new Set([
  'fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'si', 'feature', 'pp',
]);

function youtubeVideoId(parsed) {
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
  if (![
    'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com',
  ].includes(hostname)) return null;

  if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
  const pathMatch = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/);
  return pathMatch?.[1] || null;
}

function cacheKeyForVideoUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_error) {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  const youtubeId = youtubeVideoId(parsed);
  if (youtubeId && /^[a-zA-Z0-9_-]{6,20}$/.test(youtubeId)) {
    return `youtube:${youtubeId}`;
  }

  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMETERS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();
  return `url:${parsed.toString()}`;
}

function cacheKeyForImport(imported = {}) {
  return imported.cacheKey
    || cacheKeyForVideoUrl(imported.canonicalUrl)
    || cacheKeyForVideoUrl(imported.sourceUrl);
}

module.exports = { cacheKeyForVideoUrl, cacheKeyForImport, _test: { youtubeVideoId } };
