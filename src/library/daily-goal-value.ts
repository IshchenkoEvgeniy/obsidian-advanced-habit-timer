export function convertDailyProgress(value: number, sourceUnit: string, goalUnit: string): number {
    if (!Number.isFinite(value)) return 0;
    if (sourceUnit === goalUnit) return Math.max(0, value);
    if (sourceUnit === 'minutes' && goalUnit === 'hours') return Math.max(0, value) / 60;
    if (sourceUnit === 'hours' && goalUnit === 'minutes') return Math.max(0, value) * 60;
    return 0;
}
