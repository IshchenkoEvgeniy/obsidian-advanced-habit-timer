/**
 * Stats dashboard (concept "Классический дашборд", variant from 2026-09-26).
 * Pure logic: KPI with period-over-period deltas and weekday rhythm.
 * No Obsidian imports. All dates 'YYYY-MM-DD'.
 */

export interface StatDay { date: string; focusSec: number; tasksDone: number }

function sumRange(days: StatDay[], from: string, to: string): { focusSec: number; tasksDone: number } {
    let focusSec = 0, tasksDone = 0;
    for (const day of days) {
        if (day.date >= from && day.date <= to) { focusSec += day.focusSec; tasksDone += day.tasksDone; }
    }
    return { focusSec, tasksDone };
}

function shift(iso: string, days: number): string {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export interface Kpi { id: string; value: number; delta: number | null }

/** Week-over-week KPIs: focus hours and done tasks, with deltas vs previous week. */
export function weekKpis(days: StatDay[], today: string): Kpi[] {
    // current week: Monday..today
    const d = new Date(today + 'T12:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7; // 0=Mon
    const monday = shift(today, -dow);
    const prevMonday = shift(monday, -7);
    const prevSunday = shift(monday, -1);
    const cur = sumRange(days, monday, today);
    const prev = sumRange(days, prevMonday, prevSunday);
    const delta = (curV: number, prevV: number): number | null => prevV > 0 ? Math.round((curV - prevV) / prevV * 100) : (curV > 0 ? null : 0);
    return [
        { id: 'focus_week', value: cur.focusSec, delta: delta(cur.focusSec, prev.focusSec) },
        { id: 'tasks_week', value: cur.tasksDone, delta: delta(cur.tasksDone, prev.tasksDone) },
        { id: 'focus_prev', value: prev.focusSec, delta: null },
        { id: 'tasks_prev', value: prev.tasksDone, delta: null }
    ];
}

/** Mean focus seconds per weekday (0=Mon..6=Sun) over the trailing N days. */
export function weekdayRhythm(days: StatDay[], today: string, windowDays = 28): number[] {
    const sums = Array(7).fill(0);
    const counts = Array(7).fill(0);
    const from = shift(today, -(windowDays - 1));
    for (const day of days) {
        if (day.date < from || day.date > today) continue;
        const d = new Date(day.date + 'T12:00:00Z');
        const idx = (d.getUTCDay() + 6) % 7;
        sums[idx] += day.focusSec;
        counts[idx]++;
    }
    return sums.map((sum, i) => counts[i] ? Math.round(sum / counts[i]) : 0);
}

/** Best weekday index (0=Mon..6=Sun) by mean focus; null when no data. */
export function bestWeekday(rhythm: number[]): number | null {
    let best = -1, bestV = 0;
    rhythm.forEach((v, i) => { if (v > bestV) { bestV = v; best = i; } });
    return bestV > 0 ? best : null;
}
