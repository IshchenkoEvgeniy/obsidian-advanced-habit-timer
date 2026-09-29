/**
 * Period ranges for the Analytics dashboard (concept E "Аналитик").
 * Pure date logic, no Obsidian imports. Dates 'YYYY-MM-DD'.
 */

export type PeriodId = 'day' | 'week' | 'month' | 'd90' | 'half' | 'year' | 'all';

export interface PeriodDef { id: PeriodId; days: number | null }

/** Ordered period picker: 1 day, 7 days, 30 days, 90 days, half-year, year, all. */
export const PERIODS: PeriodDef[] = [
    { id: 'day', days: 1 },
    { id: 'week', days: 7 },
    { id: 'month', days: 30 },
    { id: 'd90', days: 90 },
    { id: 'half', days: 183 },
    { id: 'year', days: 365 },
    { id: 'all', days: null }
];

export interface TrendComparison { current: number; previous: number; deltaPct: number | null }

/**
 * Split records into current period and the equal-length previous window,
 * comparing the same span backwards from today. 'all' compares nothing (delta null).
 */
export function trendComparison(
    daily: Array<{ date: string; value: number }>,
    period: PeriodId
): TrendComparison {
    const def = PERIODS.find(p => p.id === period);
    if (!def || def.days === null) {
        const total = daily.reduce((s, d) => s + d.value, 0);
        return { current: total, previous: 0, deltaPct: null };
    }
    const n = def.days;
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
    const lastDate = sorted.length ? sorted[sorted.length - 1]!.date : todayIso();
    const curFrom = shiftIso(lastDate, -(n - 1));
    const prevTo = shiftIso(curFrom, -1);
    const prevFrom = shiftIso(prevTo, -(n - 1));
    let current = 0, previous = 0;
    for (const d of daily) {
        if (d.date >= curFrom && d.date <= lastDate) current += d.value;
        else if (d.date >= prevFrom && d.date <= prevTo) previous += d.value;
    }
    const deltaPct = previous > 0 ? Math.round((current - previous) / previous * 100) : (current > 0 ? null : 0);
    return { current, previous, deltaPct };
}

/** Filter helper: keep only records within the selected period (ending today). */
export function inPeriod(date: string, period: PeriodId, today = todayIso()): boolean {
    const def = PERIODS.find(p => p.id === period);
    if (!def || def.days === null) return true;
    return date >= shiftIso(today, -(def.days - 1)) && date <= today;
}

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function shiftIso(iso: string, days: number): string {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
