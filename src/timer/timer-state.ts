export type TimerMode = 'timer' | 'pm';
export type TimerRunState = 'running' | 'paused';

export function recoverTimerSeconds(
    mode: TimerMode,
    state: TimerRunState,
    baseElapsed: number,
    baseRemaining: number,
    lastStartedAt: number,
    now: number
): number {
    const delta = state === 'running' && lastStartedAt > 0
        ? Math.max(0, Math.floor((now - lastStartedAt) / 1000))
        : 0;
    return mode === 'pm'
        ? Math.max(0, baseRemaining - delta)
        : Math.max(0, baseElapsed + delta);
}

export function applyManualMinutes(seconds: number, minutes: number, mode: TimerMode): number {
    const delta = Math.max(0, minutes) * 60;
    return mode === 'pm' ? Math.max(0, seconds - delta) : Math.max(0, seconds + delta);
}

export function clampProgress(current: number, added: number, total: number): number {
    const requested = Math.max(0, current) + Math.max(0, added);
    return total > 0 ? Math.min(total, requested) : requested;
}
