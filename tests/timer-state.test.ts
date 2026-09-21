import { describe, expect, it } from 'vitest';
import { applyManualMinutes, clampProgress, recoverTimerSeconds } from '../src/timer/timer-state';

describe('timer state recovery', () => {
    const now = 1_100_000;

    it('does not count paused time for a stopwatch', () => {
        expect(recoverTimerSeconds('timer', 'paused', 600, 0, 1_000_000, now)).toBe(600);
    });

    it('adds wall-clock time to a running stopwatch', () => {
        expect(recoverTimerSeconds('timer', 'running', 600, 0, 1_000_000, now)).toBe(700);
    });

    it('does not reduce a paused pomodoro', () => {
        expect(recoverTimerSeconds('pm', 'paused', 300, 1200, 1_000_000, now)).toBe(1200);
    });

    it('finishes a pomodoro that expired while the app was closed', () => {
        expect(recoverTimerSeconds('pm', 'running', 1400, 100, 1_000_000, now)).toBe(0);
    });
});

describe('manual timer adjustments', () => {
    it('adds elapsed time to a stopwatch', () => {
        expect(applyManualMinutes(300, 15, 'timer')).toBe(1200);
    });

    it('subtracts elapsed time from pomodoro remaining time', () => {
        expect(applyManualMinutes(1200, 15, 'pm')).toBe(300);
        expect(applyManualMinutes(300, 15, 'pm')).toBe(0);
    });
});

describe('media progress', () => {
    it('never exceeds the configured total', () => {
        expect(clampProgress(970, 10, 974)).toBe(974);
    });

    it('supports media without a configured total', () => {
        expect(clampProgress(10, 5, 0)).toBe(15);
    });
});
