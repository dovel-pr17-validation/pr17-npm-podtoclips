const { getSql } = require('./neonDb.cjs');
const { PipelineStages, StageStatus } = require('../domain/pipeline.cjs');
const { cacheKeyForImport } = require('../utils/videoCacheKey.cjs');

function mapEpisode(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description || '',
    status: row.status,
    source: row.source,
    stages: row.stages,
    transcript: row.transcript,
    candidates: row.candidates || [],
    clips: row.clip_ids || [],
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClip(row) {
  if (!row) return null;
  return {
    id: row.id,
    episodeId: row.episode_id,
    candidateId: row.candidate_id,
    title: row.title,
    category: row.category,
    narrativeType: row.narrative_type,
    confidence: Number(row.confidence),
    start: Number(row.start_seconds),
    end: Number(row.end_seconds),
    transcript: row.transcript,
    reasoning: row.reasoning,
    visualVerification: row.visual_verification,
    sceneScript: row.scene_script,
    render: row.render,
    createdAt: row.created_at,
  };
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

async function createEpisode(data) {
  const sql = getSql();
  const now = new Date().toISOString();
  const stages = createInitialStages(Boolean(data.ingestPending));
  const ownerUserId = String(data.ownerUserId || data.source?.billing?.accountId || '').trim();
  if (!ownerUserId) throw new Error('Episode ownership is required.');
  const [row] = await sql`
    insert into episodes (
      id, owner_user_id, title, description, status, source, stages, transcript, candidates, clip_ids, created_at, updated_at
    ) values (
      ${data.id},
      ${ownerUserId},
      ${data.title},
      ${data.description || ''},
      ${data.status || 'uploaded'},
      ${JSON.stringify(data.source)}::jsonb,
      ${JSON.stringify(stages)}::jsonb,
      null,
      '[]'::jsonb,
      '[]'::jsonb,
      ${now},
      ${now}
    )
    returning *
  `;
  return mapEpisode(row);
}

async function listEpisodes() {
  const sql = getSql();
  const rows = await sql`
    select id, owner_user_id, title, description, status, source, stages, null::jsonb as transcript,
      '[]'::jsonb as candidates, clip_ids, error, created_at, updated_at
    from episodes
    order by created_at desc
  `;
  return rows.map(mapEpisode);
}

async function listEpisodesForOwner(ownerUserId) {
  const sql = getSql();
  const rows = await sql`
    select id, owner_user_id, title, description, status, source, stages, null::jsonb as transcript,
      '[]'::jsonb as candidates, clip_ids, error, created_at, updated_at
    from episodes
    where owner_user_id = ${ownerUserId}
    order by created_at desc
  `;
  return rows.map(mapEpisode);
}

function compatibleReusableSource(rows, { cacheKey, sourceUrl, downloadProfile }) {
  return rows.find((row) => {
    const imported = row.source?.import || {};
    const matches = (cacheKey && cacheKeyForImport(imported) === cacheKey)
      || [imported.sourceUrl, imported.canonicalUrl].includes(sourceUrl);
    return matches && (!downloadProfile || imported.downloadProfile === downloadProfile);
  })?.source || null;
}

async function findReusableSource({ excludeEpisodeId, cacheKey, sourceUrl, downloadProfile }) {
  const sql = getSql();
  const exactRows = await sql`
    select id, source
    from episodes
    where id <> ${excludeEpisodeId}
      and coalesce(source->>'assetKey', '') <> ''
      and (
        source #>> '{import,cacheKey}' = ${cacheKey || ''}
        or source #>> '{import,sourceUrl}' = ${sourceUrl}
        or source #>> '{import,canonicalUrl}' = ${sourceUrl}
      )
    order by created_at desc
    limit 20
  `;
  const exact = compatibleReusableSource(exactRows, { cacheKey, sourceUrl, downloadProfile });
  if (exact || !cacheKey) return exact;

  // Legacy rows predate cacheKey. Read only compact source metadata, derive the
  // provider key once, and let the new cache-hit episode persist that key.
  const legacyRows = await sql`
    select id, source
    from episodes
    where id <> ${excludeEpisodeId}
      and coalesce(source->>'assetKey', '') <> ''
      and source #>> '{import,cacheKey}' is null
    order by created_at desc
  `;
  return compatibleReusableSource(legacyRows, { cacheKey, sourceUrl, downloadProfile });
}

async function getEpisode(id) {
  const sql = getSql();
  const [row] = await sql`select * from episodes where id = ${id}`;
  return mapEpisode(row);
}

async function getEpisodeForOwner(id, ownerUserId) {
  const sql = getSql();
  const [row] = await sql`select * from episodes where id = ${id} and owner_user_id = ${ownerUserId}`;
  return mapEpisode(row);
}

async function updateEpisode(id, updater) {
  const current = await getEpisode(id);
  if (!current) return null;

  const patch = typeof updater === 'function' ? updater(current) : updater;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const sql = getSql();
  const [row] = await sql`
    update episodes set
      title = ${next.title},
      description = ${next.description || ''},
      status = ${next.status},
      source = ${JSON.stringify(next.source)}::jsonb,
      stages = ${JSON.stringify(next.stages)}::jsonb,
      transcript = ${next.transcript ? JSON.stringify(next.transcript) : null}::jsonb,
      candidates = ${JSON.stringify(next.candidates || [])}::jsonb,
      clip_ids = ${JSON.stringify(next.clips || [])}::jsonb,
      error = ${next.error || null},
      updated_at = ${next.updatedAt}
    where id = ${id}
    returning *
  `;
  return mapEpisode(row);
}

async function updateStage(episodeId, stageName, status, message = null) {
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

async function replaceEpisodeClips(episodeId, clips) {
  const sql = getSql();
  await sql`delete from clips where episode_id = ${episodeId}`;

  for (const clip of clips) {
    await sql`
      insert into clips (
        id, episode_id, candidate_id, title, category, narrative_type, confidence,
        start_seconds, end_seconds, transcript, reasoning, visual_verification,
        scene_script, render, created_at
      ) values (
        ${clip.id},
        ${clip.episodeId},
        ${clip.candidateId},
        ${clip.title},
        ${clip.category},
        ${clip.narrativeType},
        ${clip.confidence},
        ${clip.start},
        ${clip.end},
        ${clip.transcript},
        ${clip.reasoning},
        ${JSON.stringify(clip.visualVerification)}::jsonb,
        ${clip.sceneScript ? JSON.stringify(clip.sceneScript) : null}::jsonb,
        ${JSON.stringify(clip.render)}::jsonb,
        ${clip.createdAt}
      )
    `;
  }

  await updateEpisode(episodeId, { clips: clips.map((clip) => clip.id) });
}

async function listClipsForEpisode(episodeId) {
  const sql = getSql();
  const rows = await sql`select * from clips where episode_id = ${episodeId} order by confidence desc, created_at asc`;
  return rows.map(mapClip);
}

async function listClipsForEpisodeForOwner(episodeId, ownerUserId) {
  const sql = getSql();
  const rows = await sql`
    select clips.*
    from clips
    join episodes on episodes.id = clips.episode_id
    where clips.episode_id = ${episodeId} and episodes.owner_user_id = ${ownerUserId}
    order by clips.confidence desc, clips.created_at asc
  `;
  return rows.map(mapClip);
}

async function getClip(clipId) {
  const sql = getSql();
  const [row] = await sql`select * from clips where id = ${clipId}`;
  return mapClip(row);
}

async function getClipForOwner(clipId, ownerUserId) {
  const sql = getSql();
  const [row] = await sql`
    select clips.*
    from clips
    join episodes on episodes.id = clips.episode_id
    where clips.id = ${clipId} and episodes.owner_user_id = ${ownerUserId}
  `;
  return mapClip(row);
}

async function recordUserAsset({ assetKey, userId, kind }) {
  const sql = getSql();
  const rows = await sql`
    insert into user_assets (asset_key, user_id, kind)
    values (${assetKey}, ${userId}, ${kind})
    on conflict (asset_key) do update set asset_key = excluded.asset_key
    where user_assets.user_id = excluded.user_id
    returning asset_key, user_id, kind, created_at
  `;
  if (!rows.length) throw new Error('Asset ownership cannot be reassigned.');
  return rows[0];
}

async function assetBelongsToOwner(assetKey, ownerUserId) {
  const sql = getSql();
  const [row] = await sql`
    select exists (
      select 1 from user_assets
      where asset_key = ${assetKey} and user_id = ${ownerUserId}
      union all
      select 1 from episodes
      where owner_user_id = ${ownerUserId} and source->>'assetKey' = ${assetKey}
      union all
      select 1 from clips
      join episodes on episodes.id = clips.episode_id
      where episodes.owner_user_id = ${ownerUserId} and clips.render->>'outputAssetKey' = ${assetKey}
    ) as owns
  `;
  return row?.owns === true;
}

async function updateClipRender(clipId, render) {
  const sql = getSql();
  const [row] = await sql`
    update clips set
      render = ${JSON.stringify(render)}::jsonb
    where id = ${clipId}
    returning *
  `;
  return mapClip(row);
}

async function savePost(post) {
  const sql = getSql();
  const [row] = await sql`
    insert into social_posts (
      id, clip_id, linkedin, x_thread, short_caption, created_at
    ) values (
      ${post.id},
      ${post.clipId},
      ${post.linkedin},
      ${JSON.stringify(post.xThread)}::jsonb,
      ${post.shortCaption},
      ${post.createdAt}
    )
    returning *
  `;
  return {
    id: row.id,
    clipId: row.clip_id,
    linkedin: row.linkedin,
    xThread: row.x_thread,
    shortCaption: row.short_caption,
    createdAt: row.created_at,
  };
}

async function listPostsForClip(clipId) {
  const sql = getSql();
  const rows = await sql`select * from social_posts where clip_id = ${clipId} order by created_at desc`;
  return rows.map((row) => ({
    id: row.id,
    clipId: row.clip_id,
    linkedin: row.linkedin,
    xThread: row.x_thread,
    shortCaption: row.short_caption,
    createdAt: row.created_at,
  }));
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
