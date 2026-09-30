import type { DailyRecord } from '../store/StatsStore';
import type { HabitProperty } from '../types';

const GOAL_STATES = new Set(['completed', 'partial', 'excused', 'deferred']);

export interface MonthlySession {
    habit: string;
    date: string;
    durationSec: number;
    startTimeMinutes: number;
}

export interface MonthlyHabitStats {
    name: string;
    type: string;
    focusSec: number;
    previousFocusSec: number;
    focusDeltaPct: number | null;
    sessions: number;
    averageSessionSec: number;
    completedDays: number;
    trackedDays: number;
    goalPercent: number | null;
    bestSession: MonthlySession | null;
    averageStartMinutes: number | null;
}

export interface MonthlyStats {
    month: string;
    previousMonth: string;
    days: string[];
    elapsedDays: number;
    timerHabits: string[];
    dailyFocusByHabit: Record<string, number[]>;
    maxDailyFocusSec: number;
    totalFocusSec: number;
    previousFocusSec: number;
    focusDeltaPct: number | null;
    averagePerDaySec: number;
    averagePerDayDeltaSec: number | null;
    sessionCount: number;
    previousSessionCount: number;
    sessionDelta: number | null;
    completedDays: number;
    trackedDays: number;
    missedDays: number;
    goalPercent: number | null;
    bestSession: MonthlySession | null;
    averageStartMinutes: number | null;
    averageStartDeltaMinutes: number | null;
    habits: MonthlyHabitStats[];
}

function shiftMonth(month: string, amount: number): string {
    const [year = 0, monthNumber = 1] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysInMonth(month: string): number {
    const [year = 0, monthNumber = 1] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function monthDays(month: string): string[] {
    const count = daysInMonth(month);
    return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

function monthRecords(records: DailyRecord[], month: string): DailyRecord[] {
    return records.filter(record => record.date.startsWith(`${month}-`));
}

function isTimer(record: DailyRecord): boolean {
    return (record.type || 'timer') === 'timer';
}

function focusTotal(records: DailyRecord[], habit?: string): number {
    return records.reduce((sum, record) =>
        sum + (isTimer(record) && (!habit || record.habit === habit) ? record.durationSec : 0), 0);
}

function sessionRows(records: DailyRecord[], habit?: string): MonthlySession[] {
    return records.flatMap(record => {
        if (!isTimer(record) || (habit && record.habit !== habit)) return [];
        return (record.sessions || []).map(session => ({
            habit: record.habit,
            date: record.date,
            durationSec: session.durationSec,
            startTimeMinutes: session.startTimeMinutes ?? session.startHour * 60
        }));
    });
}

function meanStartTime(sessions: MonthlySession[]): number | null {
    if (sessions.length === 0) return null;
    let sin = 0;
    let cos = 0;
    for (const session of sessions) {
        const radians = (session.startTimeMinutes / 1440) * Math.PI * 2;
        sin += Math.sin(radians);
        cos += Math.cos(radians);
    }
    const angle = (Math.atan2(sin, cos) + Math.PI * 2) % (Math.PI * 2);
    return Math.round((angle / (Math.PI * 2)) * 1440) % 1440;
}

function goalCounts(records: DailyRecord[], properties: HabitProperty[], today: string): { completed: number; tracked: number } {
    const byDate = new Map<string, DailyRecord[]>();
    for (const record of records) {
        if (record.date > today) continue;
        const rows = byDate.get(record.date) || [];
        rows.push(record);
        byDate.set(record.date, rows);
    }

    let completed = 0;
    let tracked = 0;
    for (const [date, dayRecords] of byDate) {
        const active = properties.filter(prop => (prop.createdAt || '0000-00-00') <= date);
        if (active.length === 0) continue;
        const activeRows = active.map(prop => dayRecords.find(record => record.habit === prop.name));
        if (activeRows.some(record => !record)) continue;
        const states = activeRows.map(record => record!.state || 'pending');
        // An unfinished current day is still in progress, not a miss.
        if (states.includes('pending')) continue;
        tracked++;
        if (states.every(state => GOAL_STATES.has(state))) completed++;
    }
    return { completed, tracked };
}

function percentDelta(current: number, previous: number): number | null {
    if (previous > 0) return Math.round(((current - previous) / previous) * 100);
    return current > 0 ? null : 0;
}

function habitGoalStats(records: DailyRecord[], today: string): { completed: number; tracked: number; percent: number | null } {
    const eligible = records.filter(record => record.date <= today && record.state !== 'pending');
    const completed = eligible.filter(record => GOAL_STATES.has(record.state || '')).length;
    return {
        completed,
        tracked: eligible.length,
        percent: eligible.length ? Math.round((completed / eligible.length) * 100) : null
    };
}

function monthAverageDivisor(month: string, today: string): number {
    return month === today.slice(0, 7) ? Math.max(Number(today.slice(8, 10)), 1) : daysInMonth(month);
}

function bestSession(sessions: MonthlySession[]): MonthlySession | null {
    return sessions.reduce<MonthlySession | null>((best, session) =>
        !best || session.durationSec > best.durationSec ? session : best, null);
}

export function buildMonthlyStats(
    records: DailyRecord[],
    properties: HabitProperty[],
    month: string,
    today: string
): MonthlyStats {
    const previousMonth = shiftMonth(month, -1);
    const days = monthDays(month);
    const elapsedDays = monthAverageDivisor(month, today);
    const currentRecords = monthRecords(records, month);
    const previousRecords = monthRecords(records, previousMonth);
    const timerHabits = properties.filter(prop => (prop.type || 'timer') === 'timer').map(prop => prop.name);
    const dailyFocusByHabit: Record<string, number[]> = {};
    let maxDailyFocusSec = 0;

    for (const habit of timerHabits) {
        const values = days.map(date => currentRecords
            .filter(record => record.habit === habit && record.date === date && isTimer(record))
            .reduce((sum, record) => sum + record.durationSec, 0));
        dailyFocusByHabit[habit] = values;
        maxDailyFocusSec = Math.max(maxDailyFocusSec, ...values);
    }

    const sessions = sessionRows(currentRecords);
    const previousSessions = sessionRows(previousRecords);
    const totalFocusSec = focusTotal(currentRecords);
    const previousFocusSec = focusTotal(previousRecords);
    const dayGoals = goalCounts(currentRecords, properties, today);
    const averageStartMinutes = meanStartTime(sessions);
    const previousAverageStartMinutes = meanStartTime(previousSessions);
    let averageStartDeltaMinutes: number | null = null;
    if (averageStartMinutes !== null && previousAverageStartMinutes !== null) {
        averageStartDeltaMinutes = averageStartMinutes - previousAverageStartMinutes;
        if (averageStartDeltaMinutes > 720) averageStartDeltaMinutes -= 1440;
        if (averageStartDeltaMinutes < -720) averageStartDeltaMinutes += 1440;
    }

    const habits = properties.map(prop => {
        const current = currentRecords.filter(record => record.habit === prop.name);
        const previous = previousRecords.filter(record => record.habit === prop.name);
        const timerSessions = sessionRows(current, prop.name);
        const focusSec = focusTotal(current, prop.name);
        const goals = habitGoalStats(current, today);
        return {
            name: prop.name,
            type: prop.type || 'timer',
            focusSec,
            previousFocusSec: focusTotal(previous, prop.name),
            focusDeltaPct: previous.length ? percentDelta(focusSec, focusTotal(previous, prop.name)) : null,
            sessions: timerSessions.length,
            averageSessionSec: timerSessions.length ? focusSec / timerSessions.length : 0,
            completedDays: goals.completed,
            trackedDays: goals.tracked,
            goalPercent: goals.percent,
            bestSession: bestSession(timerSessions),
            averageStartMinutes: meanStartTime(timerSessions)
        };
    });

    const previousDivisor = monthAverageDivisor(previousMonth, today);
    const averagePerDaySec = totalFocusSec / elapsedDays;
    const previousAveragePerDaySec = previousFocusSec / previousDivisor;

    return {
        month,
        previousMonth,
        days,
        elapsedDays,
        timerHabits,
        dailyFocusByHabit,
        maxDailyFocusSec,
        totalFocusSec,
        previousFocusSec,
        focusDeltaPct: previousRecords.length ? percentDelta(totalFocusSec, previousFocusSec) : null,
        averagePerDaySec,
        averagePerDayDeltaSec: previousRecords.length ? averagePerDaySec - previousAveragePerDaySec : null,
        sessionCount: sessions.length,
        previousSessionCount: previousSessions.length,
        sessionDelta: previousRecords.length ? sessions.length - previousSessions.length : null,
        completedDays: dayGoals.completed,
        trackedDays: dayGoals.tracked,
        missedDays: dayGoals.tracked - dayGoals.completed,
        goalPercent: dayGoals.tracked ? Math.round((dayGoals.completed / dayGoals.tracked) * 100) : null,
        bestSession: bestSession(sessions),
        averageStartMinutes,
        averageStartDeltaMinutes,
        habits
    };
}
