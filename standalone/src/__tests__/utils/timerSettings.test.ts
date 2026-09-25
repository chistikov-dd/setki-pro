import { describe, it, expect, beforeEach } from 'vitest';
import { saveTimerDuration, loadTimerDuration, clearTimerDuration } from '../../utils/timerSettings';

describe('timerSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the default duration (300s) when nothing is saved', () => {
    expect(loadTimerDuration()).toBe(300);
  });

  it('saves and reloads a custom duration', () => {
    saveTimerDuration(180);
    expect(loadTimerDuration()).toBe(180);
  });

  it('ignores invalid stored values and falls back to default', () => {
    localStorage.setItem('setki_timer_duration', '-5');
    expect(loadTimerDuration()).toBe(300);

    localStorage.setItem('setki_timer_duration', 'not-a-number');
    expect(loadTimerDuration()).toBe(300);

    localStorage.setItem('setki_timer_duration', '99999');
    expect(loadTimerDuration()).toBe(300);
  });

  it('clearTimerDuration removes the saved value', () => {
    saveTimerDuration(240);
    clearTimerDuration();
    expect(loadTimerDuration()).toBe(300);
  });
});
