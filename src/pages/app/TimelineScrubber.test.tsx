import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineScrubber } from '../../../components/TimelineScrubber';
import { splitSegmentsAtTimelineTime, timelineTimeFromClientX, type Segment } from '../../../components/VideoEditorPage';

describe('video editor timeline scrubbing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses canvas-relative coordinates without counting horizontal scroll twice', () => {
    expect(timelineTimeFromClientX(120, -200, 30)).toBe(10);
    expect(timelineTimeFromClientX(-300, -200, 30)).toBe(0);
    expect(timelineTimeFromClientX(2_000, -200, 30)).toBe(30);
  });

  it('isolates the animated landing-page playhead from the real editor', () => {
    const marketingStyles = readFileSync('index.css', 'utf8');
    const editorStyles = readFileSync('src/styles/editor.css', 'utf8');

    expect(marketingStyles).not.toMatch(/^\s*\.timeline-playhead\s*\{\s*animation:/m);
    expect(marketingStyles).toContain('.marketing-page .editor-timeline .timeline-playhead { animation: landing-playhead');
    expect(editorStyles).toMatch(/\.editor-shell \.timeline-playhead \{[^}]*animation: none;/);
  });

  it('splits from the canonical timeline playhead in the first four seconds', () => {
    const segment: Segment = {
      id: 'segment-1',
      clipId: 'clip-1',
      title: 'Test clip',
      assetKey: 'renders/test.mp4',
      start: 0,
      end: 10,
      sourceDuration: 10,
    };

    const result = splitSegmentsAtTimelineTime([segment], 4, 'test');

    expect(result).not.toBeNull();
    expect(result?.segments.map((item) => item.end - item.start)).toEqual([4, 6]);
    expect(result?.segments.reduce((total, item) => total + item.end - item.start, 0)).toBe(10);
    expect(result?.second.id).toBe('segment-1-b-test');
  });

  it('maps timeline time to source time for already trimmed clips', () => {
    const segment: Segment = {
      id: 'trimmed',
      clipId: 'clip-1',
      title: 'Trimmed clip',
      assetKey: 'renders/test.mp4',
      start: 6,
      end: 16,
      sourceDuration: 20,
    };

    const result = splitSegmentsAtTimelineTime([segment], 4, 'trimmed-test');

    expect(result?.splitSourceTime).toBe(10);
    expect(result?.segments.map((item) => [item.start, item.end])).toEqual([[6, 10], [10, 16]]);
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
