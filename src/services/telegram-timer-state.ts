export interface TelegramTimerStateInput {
    timerState?: 'running' | 'paused';
    elapsedSeconds?: number;
    lastStartedAt?: number;
    targetSeconds?: number;
}

export interface TelegramTimerProgress {
    elapsedSeconds: number;
    remainingSeconds?: number;
    targetReached: boolean;
}

export function getTelegramTimerProgress(active: TelegramTimerStateInput, now = Date.now()): TelegramTimerProgress {
    const base = Math.max(0, active.elapsedSeconds || 0);
    const runningDelta = (active.timerState || 'running') === 'running' && active.lastStartedAt
        ? Math.max(0, Math.floor((now - active.lastStartedAt) / 1000))
        : 0;
    const elapsedSeconds = base + runningDelta;
    const target = active.targetSeconds;
    return {
        elapsedSeconds,
        remainingSeconds: target === undefined ? undefined : Math.max(0, target - elapsedSeconds),
        targetReached: target !== undefined && target > 0 && elapsedSeconds >= target
    };
}
