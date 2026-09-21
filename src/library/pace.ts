export interface MediaPace {
    remaining: number;
    daysRemaining: number;
    perDay: number;
    overdue: boolean;
}

export function calculateMediaPace(
    progress: number,
    total: number,
    targetDate: string,
    today: string
): MediaPace | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today) || total <= 0) return null;
    const target = Date.parse(`${targetDate}T12:00:00Z`);
    const current = Date.parse(`${today}T12:00:00Z`);
    if (!Number.isFinite(target) || !Number.isFinite(current)) return null;
    const remaining = Math.max(0, total - Math.max(0, progress));
    const difference = Math.floor((target - current) / 86_400_000);
    const overdue = difference < 0;
    const daysRemaining = Math.max(1, difference + 1);
    return {
        remaining,
        daysRemaining,
        perDay: remaining > 0 ? Math.ceil(remaining / daysRemaining) : 0,
        overdue
    };
}
