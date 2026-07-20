export type UiFlowAction =
  | 'tap'
  | 'click'
  | 'type'
  | 'swipe'
  | 'drag'
  | 'show_toast'
  | 'loading'
  | 'error';

export interface SceneScriptTarget {
  label: string;
  type: 'button' | 'input' | 'toast' | 'menu' | 'screen' | 'toggle' | string;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface SceneScriptStep {
  t_start: number;
  t_end: number;
  actor: 'user' | 'system';
  action: UiFlowAction;
  target: SceneScriptTarget;
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

export interface BrandSkin {
  id: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  borderRadius: number;
  logoUrl?: string;
}

export const defaultBrandSkin: BrandSkin = {
  id: 'default',
  name: 'Default',
  primaryColor: '#7c3aed',
  accentColor: '#06b6d4',
  backgroundColor: '#0f172a',
  textColor: '#f8fafc',
  borderRadius: 18,
};

export function shouldRenderAnimation(sceneScript: SceneScript | null, threshold = 0.78) {
  return Boolean(sceneScript && sceneScript.confidence >= threshold && sceneScript.steps.length > 0);
}

