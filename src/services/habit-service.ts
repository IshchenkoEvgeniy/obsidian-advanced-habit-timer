import { App, moment } from 'obsidian';
import { parseDuration, getDailyNotes } from '../utils';
import type { HabitProperty } from '../types';
import {
    evaluateHabitState, getHabitDeferredAmountKey, getHabitDeferredToKey,
    getHabitGoals, readHabitExplicitState, statePreservesStreak
} from '../habits/goals';

/**
 * Reads a habit's value for a given day from a frontmatter object.
 * Returns the canonical unit: seconds for 'timer', raw number for 'count',
 * 1/0 for 'binary', and 1/0 for 'negative' (1 = clean).
 */
export function getHabitValueFromFrontmatter(fm: Record<string, unknown>, prop: HabitProperty): number {
    const type = prop.type || 'timer';
    if (type === 'timer') {
        let sec = 0;
        for (const k in fm) {
            if (k === prop.name || k.startsWith(prop.name + ':')) {
                sec += parseDuration(fm[k]);
            }
        }
        return sec;
    }
    if (type === 'binary') {
        if (!Object.prototype.hasOwnProperty.call(fm, prop.name)) return 0;
        const v = fm[prop.name];
        return (v === true || v === 'true' || v === 1 || v === '1') ? 1 : 0;
    }
    if (type === 'count') {
        return Object.prototype.hasOwnProperty.call(fm, prop.name) ? (Number(fm[prop.name]) || 0) : 0;
    }
    if (type === 'negative') {
        // 1 = staying clean, 0 = relapsed
        return fm[`${prop.name}-Relapse`] ? 0 : 1;
    }
    return 0;
}

export function getHabitWeeklyValue(app: App, dailyNotesFolder: string, prop: HabitProperty, date: string): number {
    const start = moment(date).startOf('isoWeek').format('YYYY-MM-DD');
    const end = moment(date).endOf('isoWeek').format('YYYY-MM-DD');
    return getDailyNotes(app, dailyNotesFolder).reduce((sum, file) => {
        if (file.basename < start || file.basename > end) return sum;
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        return fm ? sum + getHabitValueFromFrontmatter(fm, prop) : sum;
    }, 0);
}

export function getHabitDeferredBonus(app: App, dailyNotesFolder: string, prop: HabitProperty, targetDate: string): number {
    return getDailyNotes(app, dailyNotesFolder).reduce((sum, file) => {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm || readHabitExplicitState(fm, prop.name) !== 'deferred') return sum;
        if (String(fm[getHabitDeferredToKey(prop.name)] || '') !== targetDate) return sum;
        const storedAmount = Number(fm[getHabitDeferredAmountKey(prop.name)]);
        return sum + (Number.isFinite(storedAmount) && storedAmount > 0
            ? storedAmount
            : getHabitGoals(prop, file.basename).desired);
    }, 0);
}

/**
 * Calculates the current consecutive streak for a given habit property.
 * Counts backwards from yesterday, then includes today if it is also met.
 */
export async function calculateHabitStreak(app: App, dailyNotesFolder: string, prop: HabitProperty): Promise<number> {
    const files = getDailyNotes(app, dailyNotesFolder);
    const valuesByDate = new Map<string, { value: number; fm: Record<string, unknown> }>();

    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm) continue;
        valuesByDate.set(file.basename, { value: getHabitValueFromFrontmatter(fm, prop), fm });
    }

    if ((prop.goalMode || 'daily') === 'weekly') {
        let streak = 0;
        const checkWeek = moment().subtract(1, 'week').startOf('isoWeek');
        for (let i = 0; i < 520; i++) {
            const start = checkWeek.format('YYYY-MM-DD');
            const end = moment(checkWeek).endOf('isoWeek').format('YYYY-MM-DD');
            const total = [...valuesByDate.entries()]
                .filter(([date]) => date >= start && date <= end)
                .reduce((sum, [, entry]) => sum + entry.value, 0);
            if (total >= getHabitGoals(prop, start).minimum) {
                streak++;
                checkWeek.subtract(1, 'week');
            } else break;
        }
        const currentStart = moment().startOf('isoWeek').format('YYYY-MM-DD');
        const currentEnd = moment().endOf('isoWeek').format('YYYY-MM-DD');
        const currentTotal = [...valuesByDate.entries()]
            .filter(([date]) => date >= currentStart && date <= currentEnd)
            .reduce((sum, [, entry]) => sum + entry.value, 0);
        if (currentTotal >= getHabitGoals(prop, currentStart).minimum) streak++;
        return streak;
    }

    let streak = 0;
    const checkDate = moment().subtract(1, 'days');
    for (let i = 0; i < 3650; i++) {
        const dStr = checkDate.format('YYYY-MM-DD');
        const entry = valuesByDate.get(dStr);
        if (!entry) break;
        const explicit = readHabitExplicitState(entry.fm, prop.name);
        const state = evaluateHabitState(prop, entry.value, dStr, explicit);
        if (!statePreservesStreak(state)) break;
        if (state === 'completed' || state === 'partial') streak++;
        checkDate.subtract(1, 'days');
    }

    const todayStr = moment().format('YYYY-MM-DD');
    const todayEntry = valuesByDate.get(todayStr);
    if (todayEntry) {
        const state = evaluateHabitState(prop, todayEntry.value, todayStr, readHabitExplicitState(todayEntry.fm, prop.name));
        if (state === 'completed' || state === 'partial') streak++;
    }

    return streak;
}
