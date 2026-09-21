import { describe, expect, it } from 'vitest';
import { getTelegramTimerProgress } from '../src/services/telegram-timer-state';

describe('Telegram timer progress', () => {
    it('adds wall-clock time while running', () => {
        expect(getTelegramTimerProgress({
            timerState: 'running', elapsedSeconds: 300, lastStartedAt: 1_000_000
        }, 1_120_000).elapsedSeconds).toBe(420);
    });

    it('does not add wall-clock time while paused', () => {
        expect(getTelegramTimerProgress({
            timerState: 'paused', elapsedSeconds: 300, lastStartedAt: 1_000_000
        }, 1_120_000).elapsedSeconds).toBe(300);
    });

    it('calculates remaining time and detects completion', () => {
        expect(getTelegramTimerProgress({
            timerState: 'running', elapsedSeconds: 1400, lastStartedAt: 1_000_000, targetSeconds: 1500
        }, 1_120_000)).toMatchObject({ elapsedSeconds: 1520, remainingSeconds: 0, targetReached: true });
    });

    it('supports an unlimited stopwatch', () => {
        expect(getTelegramTimerProgress({ elapsedSeconds: 60 }, 1_000_000)).toMatchObject({
            elapsedSeconds: 60, remainingSeconds: undefined, targetReached: false
        });
    });
});
