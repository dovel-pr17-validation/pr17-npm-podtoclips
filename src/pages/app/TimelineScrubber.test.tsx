import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineScrubber } from '../../../components/TimelineScrubber';
import { timelineTimeFromClientX } from '../../../components/VideoEditorPage';

describe('video editor timeline scrubbing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses canvas-relative coordinates without counting horizontal scroll twice', () => {
    expect(timelineTimeFromClientX(120, -200, 30)).toBe(10);
    expect(timelineTimeFromClientX(-300, -200, 30)).toBe(0);
    expect(timelineTimeFromClientX(2_000, -200, 30)).toBe(30);
  });

  it('can drag backward after reaching the end and commits the released position', () => {
    const onScrubStart = vi.fn();
    const onChange = vi.fn();
    const onScrubEnd = vi.fn();
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    render(
      <TimelineScrubber
        value={30}
        duration={30}
        onScrubStart={onScrubStart}
        onChange={onChange}
        onScrubEnd={onScrubEnd}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Timeline preview position' });
    Object.defineProperty(slider, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, right: 400, top: 0, bottom: 24, width: 300, height: 24, x: 100, y: 0, toJSON: () => ({}) }),
    });
    Object.defineProperties(slider, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });

    fireEvent.pointerDown(slider, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 400 });
    fireEvent.pointerMove(slider, { pointerId: 1, pointerType: 'mouse', clientX: 250 });
    fireEvent.pointerUp(slider, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 250 });

    expect(onScrubStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(15);
    expect(onScrubEnd).toHaveBeenCalledWith(15);
    expect(slider.releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
