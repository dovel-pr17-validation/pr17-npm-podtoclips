import React from 'react';
import {
  CursorClick,
  ErrorShake,
  LoadingSpinner,
  SpotlightBox,
  SwipeGesture,
  ToastSlideIn,
  TypingCaret,
} from './UiFlowComponents';
import { defaultBrandSkin, SceneScript } from './sceneScriptSchema';

interface UiFlowStoryboardProps {
  sceneScript: SceneScript;
  currentTime: number;
}

function getProgress(currentTime: number, start: number, end: number) {
  if (currentTime <= start) return 0;
  if (currentTime >= end) return 1;
  return (currentTime - start) / Math.max(0.01, end - start);
}

export const UiFlowStoryboard: React.FC<UiFlowStoryboardProps> = ({ sceneScript, currentTime }) => {
  const brand = defaultBrandSkin;
  const activeStep = sceneScript.steps.find((step) => currentTime >= step.t_start && currentTime <= step.t_end)
    || sceneScript.steps[sceneScript.steps.length - 1];

  if (!activeStep) return null;

  const progress = getProgress(currentTime, activeStep.t_start, activeStep.t_end);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[32px] p-8" style={{ background: brand.backgroundColor, color: brand.textColor }}>
      <div className="mx-auto h-full max-w-sm rounded-[36px] border border-white/15 bg-black/25 p-5 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="h-3 w-20 rounded-full bg-white/20" />
          <div className="h-3 w-3 rounded-full" style={{ background: brand.accentColor }} />
        </div>
        <div className="rounded-3xl bg-white/10 p-4">
          <div className="mb-3 h-4 w-28 rounded-full bg-white/20" />
          <div className="grid gap-3">
            <div className="h-12 rounded-2xl bg-white/10" />
            <div className="h-12 rounded-2xl bg-white/10" />
            <div className="h-12 rounded-2xl" style={{ background: brand.primaryColor }} />
          </div>
        </div>
        {activeStep.action === 'tap' || activeStep.action === 'click' ? <CursorClick step={activeStep} progress={progress} brand={brand} /> : null}
        {activeStep.action === 'type' ? <TypingCaret step={activeStep} progress={progress} brand={brand} /> : null}
        {activeStep.action === 'swipe' || activeStep.action === 'drag' ? <SwipeGesture step={activeStep} progress={progress} brand={brand} /> : null}
        {activeStep.action === 'show_toast' ? <ToastSlideIn step={activeStep} progress={progress} brand={brand} /> : null}
        {activeStep.action === 'loading' ? <LoadingSpinner step={activeStep} progress={progress} brand={brand} /> : null}
        {activeStep.action === 'error' ? <ErrorShake step={activeStep} progress={progress} brand={brand} /> : null}
        {sceneScript.canvas === 'video-overlay' ? <SpotlightBox step={activeStep} progress={progress} brand={brand} /> : null}
      </div>
    </div>
  );
};

