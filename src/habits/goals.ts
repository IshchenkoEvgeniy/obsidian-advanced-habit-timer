import type { HabitDayState, HabitExplicitState, HabitProperty, WeekdayKey } from '../types';

export interface HabitGoals {
    minimum: number;
    desired: number;
    mode: 'daily' | 'weekly';
    progressionLevel: number;
}

export const HABIT_STATE_SUFFIX = '-State';
export const HABIT_DEFERRED_TO_SUFFIX = '-DeferredTo';
export const HABIT_DEFERRED_AMOUNT_SUFFIX = '-DeferredAmount';

const WEEKDAYS: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function dateAtNoon(date: string): Date {
    const parsed = new Date(`${date}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function weeksBetween(start: string, end: string): number {
    const startTime = dateAtNoon(start).getTime();
    const endTime = dateAtNoon(end).getTime();
    return Math.max(0, Math.floor((endTime - startTime) / (7 * 24 * 60 * 60 * 1000)));
}

function toCanonical(prop: HabitProperty, value: number): number {
    return (prop.type || 'timer') === 'timer' ? value * 60 : value;
}

export function getWeekdayKey(date: string): WeekdayKey {
    return WEEKDAYS[dateAtNoon(date).getDay()] || 'mon';
}

export function getHabitGoals(prop: HabitProperty, date: string, deferredBonus = 0): HabitGoals {
    const type = prop.type || 'timer';
    if (type === 'binary' || type === 'negative') {
        return { minimum: 1, desired: 1 + Math.max(0, deferredBonus), mode: 'daily', progressionLevel: 0 };
    }

    const mode = prop.goalMode || 'daily';
    const baseDaily = type === 'count' ? (prop.goalCount || 10) : (prop.goalMinutes || 0);
    const dailyOverride = prop.dailyGoals?.[getWeekdayKey(date)];
    const baseDesired = mode === 'weekly'
        ? (type === 'count' ? (prop.weeklyGoalCount || baseDaily) : (prop.weeklyGoalMinutes || baseDaily))
        : (dailyOverride !== undefined ? dailyOverride : baseDaily);
    const baseMinimum = type === 'count'
        ? (prop.minimumGoalCount ?? baseDesired)
        : (prop.minimumGoalMinutes ?? baseDesired);

    const progressive = prop.progressiveGoal;
    let progressionLevel = 0;
    let desired = Math.max(0, baseDesired);
    if (progressive?.enabled && progressive.step > 0) {
        const everyWeeks = Math.max(1, progressive.everyWeeks || 1);
        const startDate = progressive.startDate || prop.createdAt || date;
        progressionLevel = Math.floor(weeksBetween(startDate, date) / everyWeeks);
        desired += progressionLevel * progressive.step;
        if (progressive.max !== undefined && progressive.max > 0) desired = Math.min(desired, progressive.max);
    }

    const desiredCanonical = toCanonical(prop, desired) + Math.max(0, deferredBonus);
    const minimumCanonical = Math.min(desiredCanonical, toCanonical(prop, Math.max(0, baseMinimum)));
    return {
        minimum: minimumCanonical,
        desired: desiredCanonical,
        mode,
        progressionLevel
    };
}

export function getHabitStateKey(name: string): string {
    return `${name}${HABIT_STATE_SUFFIX}`;
}

export function getHabitDeferredToKey(name: string): string {
    return `${name}${HABIT_DEFERRED_TO_SUFFIX}`;
}

export function getHabitDeferredAmountKey(name: string): string {
    return `${name}${HABIT_DEFERRED_AMOUNT_SUFFIX}`;
}

export function readHabitExplicitState(fm: Record<string, unknown>, habitName: string): HabitExplicitState | null {
    const value = fm[getHabitStateKey(habitName)];
    return value === 'completed' || value === 'partial' || value === 'skipped' || value === 'excused' || value === 'deferred'
        ? value
        : null;
}

export function evaluateHabitState(
    prop: HabitProperty,
    value: number,
    date: string,
    explicitState: HabitExplicitState | null = null,
    aggregateValue?: number,
    deferredBonus = 0,
    today = new Date().toISOString().slice(0, 10)
): HabitDayState {
    if (explicitState) return explicitState;
    const goals = getHabitGoals(prop, date, deferredBonus);
    const comparedValue = goals.mode === 'weekly' ? (aggregateValue ?? value) : value;
    if (comparedValue >= goals.desired) return 'completed';
    if (comparedValue >= goals.minimum && goals.minimum > 0) return 'partial';
    if (date < today) return 'missed';
    return 'pending';
}

export function statePreservesStreak(state: HabitDayState): boolean {
    return state === 'completed' || state === 'partial' || state === 'excused' || state === 'deferred';
}
