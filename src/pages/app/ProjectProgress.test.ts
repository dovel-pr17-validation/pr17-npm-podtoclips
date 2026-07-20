import { describe, expect, it } from 'vitest';
import { areEpisodeClipsReady, calculateProjectEtaSeconds, calculateProjectProgressPercent, getProjectMilestoneStates, isFreeSourceLimitMessage, projectEtaLabel, projectProgressStatusLabel } from '../../../components/PodcastPage';
import type { Clip, Episode, PipelineStage } from '../../../types';

const stageNames = [
  'ingest',
  'transcribe',
  'score_transcript',
  'visual_verification',
  'ui_flow_extraction',
  'rank_and_plan',
  'render_clips',
  'delivery',
];

const makeEpisode = (overrides: Partial<Record<string, PipelineStage['status']>> = {}): Episode => {
  const baseTime = Date.parse('2026-07-17T12:00:00.000Z');
  return {
    id: 'episode-test',
    title: 'Test episode',
    description: '',
    status: 'processing',
    source: { originalName: 'test.mp4', mimeType: 'video/mp4', assetKey: 'source', assetUrl: '', size: 1, inputType: 'file' },
    stages: stageNames.map((name, index) => {
      const status = overrides[name] || 'pending';
      return {
        name,
        order: index + 1,
        status,
        startedAt: status === 'running' ? new Date(baseTime - 30_000).toISOString() : status === 'completed' ? new Date(baseTime - 12_000).toISOString() : null,
        completedAt: status === 'completed' ? new Date(baseTime).toISOString() : null,
        message: null,
      };
    }),
    transcript: null,
    candidates: [],
    clips: [],
    createdAt: new Date(baseTime - 60_000).toISOString(),
    updatedAt: new Date(baseTime).toISOString(),
  };
};

describe('project progress', () => {
  it('shows only the current milestone as active and keeps completed milestones green', () => {
    const transcriptEpisode = makeEpisode({ ingest: 'completed', transcribe: 'running' });
    expect(getProjectMilestoneStates(transcriptEpisode).map(({ complete, active }) => ({ complete, active }))).toEqual([
      { complete: true, active: false },
      { complete: false, active: true },
      { complete: false, active: false },
      { complete: false, active: false },
    ]);

    const renderingEpisode = makeEpisode({ ingest: 'completed', transcribe: 'completed', rank_and_plan: 'completed', render_clips: 'running' });
    expect(getProjectMilestoneStates(renderingEpisode).map(({ complete, active }) => ({ complete, active }))).toEqual([
      { complete: true, active: false },
      { complete: true, active: false },
      { complete: true, active: false },
      { complete: false, active: true },
    ]);
  });

  it('reduces the ETA as the active stage runs and returns zero when ready', () => {
    const now = Date.parse('2026-07-17T12:00:00.000Z');
    const episode = makeEpisode({ ingest: 'completed', transcribe: 'running' });
    const firstEstimate = calculateProjectEtaSeconds(episode, [], now);
    const laterEstimate = calculateProjectEtaSeconds(episode, [], now + 15_000);
    expect(firstEstimate).toBeGreaterThan(laterEstimate);
    expect(firstEstimate - laterEstimate).toBe(15);
    expect(calculateProjectEtaSeconds({ ...episode, status: 'ready' }, [], now)).toBe(0);
  });

  it('only opens a project after every planned clip has a rendered output', () => {
    const episode = { ...makeEpisode(), clips: ['clip-one', 'clip-two'] };
    const renderedClip = (id: string, status = 'rendered', outputAssetKey = `${id}.mp4`) => ({
      id,
      episodeId: episode.id,
      render: { status, outputAssetKey },
    }) as Clip;

    expect(areEpisodeClipsReady(episode, [renderedClip('clip-one')])).toBe(false);
    expect(areEpisodeClipsReady(episode, [renderedClip('clip-one'), renderedClip('clip-two', 'running', '')])).toBe(false);
    expect(areEpisodeClipsReady(episode, [renderedClip('clip-one'), renderedClip('clip-two')])).toBe(true);
  });

  it('shows Done after clip outputs are ready or the project is terminally ready', () => {
    const processing = makeEpisode({ render_clips: 'running' });
    expect(projectEtaLabel(processing, true, 42)).toBe('Done');
    expect(projectEtaLabel({ ...processing, status: 'ready' }, false, 0)).toBe('Done');
    expect(projectEtaLabel(processing, false, 42)).toBe('Finalizing');
  });

  it('advances active-stage progress continuously without claiming completion', () => {
    const now = Date.parse('2026-07-17T12:00:00.000Z');
    const episode = makeEpisode({ ingest: 'completed', transcribe: 'running' });
    const first = calculateProjectProgressPercent(episode, [], [], now);
    const later = calculateProjectProgressPercent(episode, [], [], now + 15_000);
    expect(later).toBeGreaterThan(first);
    expect(later).toBeLessThan(100);
  });

  it('reports exact rendered clip counts during the estimated render phase', () => {
    const episode = { ...makeEpisode({ ingest: 'completed', transcribe: 'completed', rank_and_plan: 'completed', render_clips: 'running' }), clips: ['one', 'two'] };
    const clips = [
      { id: 'one', episodeId: episode.id, render: { status: 'rendered', outputAssetKey: 'one.mp4' } },
      { id: 'two', episodeId: episode.id, render: { status: 'running', outputAssetKey: '' } },
    ] as Clip[];
    expect(projectProgressStatusLabel(episode, clips, false, 125)).toBe('1 of 2 clips ready · ≈ 3 min remaining');
  });
});

describe('Free source limit errors', () => {
  it('recognizes upload, processing, and coded limit failures without swallowing unrelated errors', () => {
    expect(isFreeSourceLimitMessage('Free workspaces can upload files up to 5 GiB and 2 hours long.')).toBe(true);
    expect(isFreeSourceLimitMessage('Free workspaces can process podcasts up to 2 hours long.')).toBe(true);
    expect(isFreeSourceLimitMessage('FREE_SOURCE_LIMIT_EXCEEDED')).toBe(true);
    expect(isFreeSourceLimitMessage('The upload service is unavailable.')).toBe(false);
  });
});
