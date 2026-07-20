export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type EpisodeStatus = 'uploaded' | 'processing' | 'ready' | 'failed' | 'canceled' | 'cancelled';

export interface AccountEntitlement {
  plan: 'free' | 'creator' | 'growth' | 'studio' | 'enterprise';
  planLabel: string;
  subscriptionStatus: string;
  isPaid: boolean;
  clipsLimit: number | null;
  clipsUsed: number;
  clipsRemaining: number | null;
  freeClipsLimit: number;
  freeClipsUsed: number;
  freeClipsRemaining: number | null;
  canGenerateClips: boolean;
  /** Compatibility aliases during the clip-quota rollout. */
  conversionsLimit: number | null;
  conversionsUsed: number;
  conversionsRemaining: number | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canManageBilling: boolean;
  freeConversionsLimit: number;
  freeConversionsUsed: number;
  freeConversionsRemaining: number | null;
  canConvertPodcast: boolean;
  currentPeriodEnd: string | null;
}

export interface BillingPlanChangeStatus {
  state: 'ready' | 'processing' | 'action_required' | 'completed' | 'failed';
  currentPlan: 'creator' | 'growth' | 'studio';
  targetPlan: 'creator' | 'growth' | 'studio';
  targetPlanLabel: string;
  paymentStatus: string | null;
  paymentLink: string | null;
  paymentAmount: number | null;
  paymentCurrency: string | null;
  hasPendingChange: boolean;
  updatedAt: string | null;
}

export interface PipelineStage {
  name: string;
  order: number;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  message: string | null;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  speaker: string;
}

export interface Transcript {
  provider: string;
  language: string;
  text: string;
  words: TranscriptWord[];
  durationSeconds: number;
}

export interface SceneScriptStep {
  t_start: number;
  t_end: number;
  actor: 'user' | 'system';
  action: 'tap' | 'click' | 'type' | 'swipe' | 'drag' | 'show_toast' | 'loading' | 'error';
  target: {
    label: string;
    type: string;
  };
  resulting_state: Record<string, string>;
  narration_span: string;
}

export interface SceneScript {
  scene_type: 'ui_flow';
  confidence: number;
  canvas: 'phone' | 'browser' | 'generic' | 'video-overlay';
  brand_skin: string;
  candidate_id: string;
  steps: SceneScriptStep[];
}

export interface Episode {
  id: string;
  title: string;
  description: string;
  status: EpisodeStatus;
  source: {
    originalName: string;
    mimeType: string;
    assetKey: string;
    assetUrl: string;
    size: number;
    durationSeconds?: number | null;
    inputType?: 'file' | 'url';
    requestedTitle?: boolean;
    import?: {
      sourceUrl: string;
      canonicalUrl?: string;
      provider?: string;
      title?: string;
      author?: string;
      durationSeconds?: number | null;
      thumbnailUrl?: string | null;
      cacheHit?: boolean;
      downloadProfile?: 'legacy' | 'quality_1080p_concurrent_v2';
    };
    orchestration?: {
      provider: 'inngest';
      runId: string;
      functionId?: string;
      clipId?: string;
      status: 'running' | EpisodeStatus;
      startedAt?: string;
      completedAt?: string;
    };
  };
  stages: PipelineStage[];
  transcript: Transcript | null;
  candidates: unknown[];
  clips: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Clip {
  id: string;
  episodeId: string;
  title: string;
  category: 'insight' | 'opinion' | 'emotion' | 'funny' | 'show_and_tell';
  narrativeType: 'talking_head' | 'ui_flow';
  confidence: number;
  start: number;
  end: number;
  transcript: string;
  reasoning: string;
  sceneScript: SceneScript | null;
  render: {
    outputAssetKey: string;
    previewUrl: string | null;
    renderProvider: string;
    status: string;
    note: string;
    jobSpecAssetKey?: string;
    jobSpecUrl?: string;
    dispatchResult?: unknown;
    renderPlan: unknown;
  };
  createdAt: string;
}

export interface SocialPost {
  id: string;
  clipId: string;
  createdAt: string;
  linkedin: string;
  xThread: string[];
  shortCaption: string;
}
