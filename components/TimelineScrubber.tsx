import React, { useRef } from 'react';

interface TimelineScrubberProps {
  value: number;
  duration: number;
  onScrubStart: () => void;
  onChange: (value: number) => void;
  onScrubEnd: () => void;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({ value, duration, onScrubStart, onChange, onScrubEnd }) => {
  const draggingRef = useRef(false);

  const timeAtPointer = (element: HTMLDivElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || duration <= 0) return 0;
    return Math.max(0, Math.min(duration, ((clientX - bounds.left) / bounds.width) * duration));
  };

  const start = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrubStart();
    onChange(timeAtPointer(event.currentTarget, event.clientX));
  };

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onChange(timeAtPointer(event.currentTarget, event.clientX));
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onChange(timeAtPointer(event.currentTarget, event.clientX));
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onScrubEnd();
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    onScrubStart();
    const step = event.shiftKey ? 5 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? duration : value + (event.key === 'ArrowLeft' ? -step : step);
    onChange(Math.max(0, Math.min(duration, next)));
    onScrubEnd();
  };

  const progress = duration > 0 ? Math.max(0, Math.min(100, (value / duration) * 100)) : 0;

  return (
    <div
      role="slider"
      aria-label="Timeline preview position"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.min(value, duration)}
      tabIndex={0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={keyDown}
      className="editor-preview-scrubber"
    >
      <div className="editor-preview-scrubber-track" />
      <div className="editor-preview-scrubber-progress" style={{ width: `${progress}%` }} />
      <div className="editor-preview-scrubber-thumb" style={{ left: `${progress}%` }} />
    </div>
  );
};
