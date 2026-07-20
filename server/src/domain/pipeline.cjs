const StageStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

const EpisodeStatus = {
  UPLOADED: 'uploaded',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

const PipelineStages = [
  'ingest',
  'transcribe',
  'score_transcript',
  'visual_verification',
  'ui_flow_extraction',
  'rank_and_plan',
  'render_clips',
  'delivery',
];

const MomentCategories = ['insight', 'opinion', 'emotion', 'funny', 'show_and_tell'];

module.exports = {
  StageStatus,
  EpisodeStatus,
  PipelineStages,
  MomentCategories,
};
