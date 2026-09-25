import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMatchTimer } from '../../hooks/useMatchTimer';

/**
 * useMatchTimer uses a self-rescheduling requestAnimationFrame loop, which does not
 * interact reliably with vitest's fake rAF/timer implementation (a cancelled frame's
 * already-queued successor can still fire under fake timers). We therefore drive this
 * hook with real timers and short real waits — slower, but exercises the actual
 * browser-timing code path faithfully instead of a timer-mock artifact.
 */
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('useMatchTimer', () => {
  it('starts paused with the given initial duration', () => {
    const { result } = renderHook(() => useMatchTimer(300));
    expect(result.current.remainingSeconds).toBe(300);
    expect(result.current.isRunning).toBe(false);
  });

  it('start() sets isRunning to true and counts down over time', async () => {
    const { result } = renderHook(() => useMatchTimer(10));

    act(() => {
      result.current.start();
    });
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      await wait(1200);
    });

    expect(result.current.remainingSeconds).toBeLessThan(10);
  });

  it('pause() stops the countdown', async () => {
    const { result } = renderHook(() => useMatchTimer(10));

    act(() => {
      result.current.start();
    });
    await act(async () => {
      await wait(1200);
    });

    act(() => {
      result.current.pause();
    });
    expect(result.current.isRunning).toBe(false);
    const afterPause = result.current.remainingSeconds;

    await act(async () => {
      await wait(1200);
    });

    // No further countdown should happen once paused.
    expect(result.current.remainingSeconds).toBe(afterPause);
  }, 10000);

  it('reset() restores the given duration and stops the timer', async () => {
    const { result } = renderHook(() => useMatchTimer(10));

    act(() => {
      result.current.start();
    });
    await act(async () => {
      await wait(1200);
    });

    act(() => {
      result.current.reset(60);
    });

    expect(result.current.remainingSeconds).toBe(60);
    expect(result.current.isRunning).toBe(false);
  });

  it('setDuration updates remaining seconds and pauses the timer', () => {
    const { result } = renderHook(() => useMatchTimer(10));

    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.setDuration(45);
    });

    expect(result.current.remainingSeconds).toBe(45);
    expect(result.current.isRunning).toBe(false);
  });
});
