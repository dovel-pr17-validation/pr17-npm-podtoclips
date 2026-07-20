const fs = require('fs');
const path = require('path');
const { EpisodeStatus, PipelineStages, StageStatus } = require('../domain/pipeline.cjs');
const { cacheKeyForImport } = require('../utils/videoCacheKey.cjs');

function dataDir() {
  return process.env.EASYED_LOCAL_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}

function dbPath() {
  return path.join(dataDir(), 'catalog.json');
}

function ensureDb() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (!fs.existsSync(dbPath())) {
    fs.writeFileSync(dbPath(), JSON.stringify({ episodes: [], clips: [], posts: [], userAssets: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(dbPath(), 'utf8'));
  db.userAssets ||= [];
  return db;
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath(), JSON.stringify(db, null, 2));
}

function createInitialStages(ingestPending = false) {
  return PipelineStages.map((name, index) => ({
    name,
    order: index + 1,
    status: name === 'ingest' ? (ingestPending ? StageStatus.RUNNING : StageStatus.COMPLETED) : StageStatus.PENDING,
    startedAt: name === 'ingest' ? new Date().toISOString() : null,
    completedAt: name === 'ingest' && !ingestPending ? new Date().toISOString() : null,
    message: name === 'ingest' ? (ingestPending ? 'Link accepted. Download queued with Inngest.' : 'Upload accepted and stored.') : null,
  }));
}

function createEpisode(data) {
  const db = readDb();
  const now = new Date().toISOString();
  const ownerUserId = String(data.ownerUserId || data.source?.billing?.accountId || '').trim();
  if (!ownerUserId) throw new Error('Episode ownership is required.');
  const episode = {
    ...data,
    ownerUserId,
    status: data.status || EpisodeStatus.UPLOADED,
    stages: createInitialStages(Boolean(data.ingestPending)),
    transcript: null,
    candidates: [],
    clips: [],
    createdAt: now,
    updatedAt: now,
  };

  db.episodes.unshift(episode);
  writeDb(db);
  return episode;
}

function listEpisodes() {
  return readDb().episodes;
}

function listEpisodesForOwner(ownerUserId) {
  return readDb().episodes.filter((episode) => episode.ownerUserId === ownerUserId);
}

function findReusableSource({ excludeEpisodeId, cacheKey, sourceUrl, downloadProfile }) {
  return readDb().episodes
    .filter((episode) => episode.id !== excludeEpisodeId && episode.source?.assetKey)
    .find((episode) => {
      const imported = episode.source.import || {};
      const matches = (cacheKey && cacheKeyForImport(imported) === cacheKey)
        || [imported.sourceUrl, imported.canonicalUrl].includes(sourceUrl);
      return matches && (!downloadProfile || imported.downloadProfile === downloadProfile);
    })?.source || null;
}

function getEpisode(id) {
  return readDb().episodes.find((episode) => episode.id === id) || null;
}

function getEpisodeForOwner(id, ownerUserId) {
  return readDb().episodes.find((episode) => episode.id === id && episode.ownerUserId === ownerUserId) || null;
}

function updateEpisode(id, updater) {
  const db = readDb();
  const index = db.episodes.findIndex((episode) => episode.id === id);
  if (index === -1) return null;

  const current = db.episodes[index];
  const next = {
    ...current,
    ...(typeof updater === 'function' ? updater(current) : updater),
    updatedAt: new Date().toISOString(),
  };

  db.episodes[index] = next;
  writeDb(db);
  return next;
}

function updateStage(episodeId, stageName, status, message = null) {
  return updateEpisode(episodeId, (episode) => ({
    stages: episode.stages.map((stage) => {
      if (stage.name !== stageName) return stage;
      return {
        ...stage,
        status,
        message,
        startedAt: stage.startedAt || new Date().toISOString(),
        completedAt: [StageStatus.COMPLETED, StageStatus.FAILED, StageStatus.SKIPPED].includes(status)
          ? new Date().toISOString()
          : stage.completedAt,
      };
    }),
  }));
}

function replaceEpisodeClips(episodeId, clips) {
  const db = readDb();
  db.clips = db.clips.filter((clip) => clip.episodeId !== episodeId).concat(clips);
  const index = db.episodes.findIndex((episode) => episode.id === episodeId);
  if (index !== -1) {
    db.episodes[index].clips = clips.map((clip) => clip.id);
    db.episodes[index].updatedAt = new Date().toISOString();
  }
  writeDb(db);
}

function listClipsForEpisode(episodeId) {
  return readDb().clips.filter((clip) => clip.episodeId === episodeId);
}

function listClipsForEpisodeForOwner(episodeId, ownerUserId) {
  const db = readDb();
  if (!db.episodes.some((episode) => episode.id === episodeId && episode.ownerUserId === ownerUserId)) return [];
  return db.clips.filter((clip) => clip.episodeId === episodeId);
}

function getClip(clipId) {
  return readDb().clips.find((clip) => clip.id === clipId) || null;
}

function getClipForOwner(clipId, ownerUserId) {
  const db = readDb();
  const clip = db.clips.find((item) => item.id === clipId);
  if (!clip) return null;
  return db.episodes.some((episode) => episode.id === clip.episodeId && episode.ownerUserId === ownerUserId) ? clip : null;
}

function recordUserAsset({ assetKey, userId, kind }) {
  const db = readDb();
  const existing = db.userAssets.find((asset) => asset.assetKey === assetKey);
  if (existing && existing.userId !== userId) throw new Error('Asset ownership cannot be reassigned.');
  if (!existing) db.userAssets.push({ assetKey, userId, kind, createdAt: new Date().toISOString() });
  writeDb(db);
  return existing || db.userAssets[db.userAssets.length - 1];
}

function assetBelongsToOwner(assetKey, ownerUserId) {
  const db = readDb();
  if (db.userAssets.some((asset) => asset.assetKey === assetKey && asset.userId === ownerUserId)) return true;
  const ownedEpisodeIds = new Set(db.episodes
    .filter((episode) => episode.ownerUserId === ownerUserId)
    .map((episode) => episode.id));
  if (db.episodes.some((episode) => ownedEpisodeIds.has(episode.id) && episode.source?.assetKey === assetKey)) return true;
  return db.clips.some((clip) => ownedEpisodeIds.has(clip.episodeId) && clip.render?.outputAssetKey === assetKey);
}

function updateClipRender(clipId, render) {
  const db = readDb();
  const index = db.clips.findIndex((clip) => clip.id === clipId);
  if (index === -1) return null;
  db.clips[index] = {
    ...db.clips[index],
    render,
  };
  writeDb(db);
  return db.clips[index];
}

function savePost(post) {
  const db = readDb();
  db.posts.unshift(post);
  writeDb(db);
  return post;
}

function listPostsForClip(clipId) {
  return readDb().posts.filter((post) => post.clipId === clipId);
}

module.exports = {
  createEpisode,
  listEpisodes,
  listEpisodesForOwner,
  findReusableSource,
  getEpisode,
  getEpisodeForOwner,
  updateEpisode,
  updateStage,
  replaceEpisodeClips,
  listClipsForEpisode,
  listClipsForEpisodeForOwner,
  getClip,
  getClipForOwner,
  updateClipRender,
  savePost,
  listPostsForClip,
  recordUserAsset,
  assetBelongsToOwner,
};
