import React from 'react';
import { BrandSkin, SceneScriptStep } from './sceneScriptSchema';

interface TimedProps {
  step: SceneScriptStep;
  progress: number;
  brand: BrandSkin;
}

export const CursorClick: React.FC<TimedProps> = ({ step, progress, brand }) => {
  const scale = progress < 0.5 ? 1 + progress * 0.35 : 1.35 - (progress - 0.5) * 0.35;
  return (
    <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
      <div
        className="h-20 w-20 rounded-full border-4"
        style={{ borderColor: brand.accentColor, transform: `scale(${scale})`, opacity: 1 - progress * 0.65 }}
      />
      <div className="absolute h-5 w-5 rounded-full" style={{ background: brand.accentColor }} />
      <div className="absolute top-10 text-sm font-semibold" style={{ color: brand.textColor }}>{step.target.label}</div>
    </div>
  );
};

export const TypingCaret: React.FC<TimedProps> = ({ step, progress, brand }) => {
  const typed = step.target.label.slice(0, Math.max(1, Math.ceil(step.target.label.length * progress)));
  return (
    <div className="mx-auto mt-8 w-72 rounded-2xl border p-4" style={{ borderColor: brand.primaryColor, color: brand.textColor }}>
      <div className="mb-2 text-xs uppercase opacity-60">{step.target.type}</div>
      <div className="text-xl font-semibold">
        {typed}
        <span style={{ color: brand.accentColor }}>▌</span>
      </div>
    </div>
  );
};

export const ToastSlideIn: React.FC<TimedProps> = ({ step, progress, brand }) => (
  <div
    className="absolute left-8 right-8 rounded-2xl p-4 text-center text-lg font-bold shadow-2xl"
    style={{
      bottom: 48,
      color: brand.textColor,
      background: brand.primaryColor,
      transform: `translateY(${(1 - progress) * 80}px)`,
      opacity: progress,
    }}
  >
    {step.target.label}
  </div>
);

export const SwipeGesture: React.FC<TimedProps> = ({ step, progress, brand }) => (
  <div className="absolute left-1/2 top-1/2 h-2 w-44 -translate-x-1/2 rounded-full bg-white/20">
    <div className="h-2 rounded-full" style={{ width: `${progress * 100}%`, background: brand.accentColor }} />
    <div className="mt-4 text-center text-sm" style={{ color: brand.textColor }}>{step.action} {step.target.label}</div>
  </div>
);

export const LoadingSpinner: React.FC<TimedProps> = ({ brand }) => (
  <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white/20 border-t-white" style={{ borderTopColor: brand.accentColor }} />
);

export const ErrorShake: React.FC<TimedProps> = ({ step, progress, brand }) => {
  const offset = Math.sin(progress * Math.PI * 8) * 8;
  return (
    <div className="mx-auto mt-8 w-72 rounded-2xl border border-red-400 p-4 text-center text-lg font-bold text-red-100" style={{ transform: `translateX(${offset}px)` }}>
      {step.target.label || 'Error'}
    </div>
  );
};

export const SpotlightBox: React.FC<TimedProps> = ({ step, brand }) => {
  const region = step.target.region || { x: 30, y: 30, width: 40, height: 18 };
  return (
    <div
      className="absolute rounded-2xl border-4"
      style={{
        left: `${region.x}%`,
        top: `${region.y}%`,
        width: `${region.width}%`,
        height: `${region.height}%`,
        borderColor: brand.accentColor,
        boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)`,
      }}
    />
  );
};

