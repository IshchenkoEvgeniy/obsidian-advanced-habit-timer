import { moment } from 'obsidian';
import type HabitTimerPlugin from '../main';
import type { HabitDayState, HabitProperty } from '../types';
import { getDailyNotes } from '../utils';
import {
    evaluateHabitState, getHabitDeferredAmountKey, getHabitDeferredToKey,
    getHabitGoals, readHabitExplicitState, statePreservesStreak
} from '../habits/goals';
import { getHabitValueFromFrontmatter } from './habit-service';
import { getString } from '../utils';

export interface HabitSnapshotDay {
    date: string;
    value: number;
    state: HabitDayState;
    minimum: number;
    desired: number;
}

export interface HabitSnapshot {
    property: HabitProperty;
    days: HabitSnapshotDay[];
    today: HabitSnapshotDay;
    currentStreak: number;
    bestStreak: number;
    completionRate: number;
    average: number;
    total: number;
}

export class HabitSnapshotService {
    constructor(private plugin: HabitTimerPlugin) {}

    async getHabitSnapshot(prop: HabitProperty, days = 84, endDate = moment().format('YYYY-MM-DD')): Promise<HabitSnapshot> {
        const files = getDailyNotes(this.plugin.app, this.plugin.settings.dailyNotesFolder);
        const frontmatterByDate = new Map<string, Record<string, unknown>>();
        for (const file of files) {
            const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
            if (fm) frontmatterByDate.set(file.basename, fm);
        }
        const deferredByDate = new Map<string, number>();
        for (const [sourceDate, fm] of frontmatterByDate) {
            if (readHabitExplicitState(fm, prop.name) !== 'deferred') continue;
            const target = getString(fm[getHabitDeferredToKey(prop.name)]);
            if (!target) continue;
            const stored = Number(fm[getHabitDeferredAmountKey(prop.name)]);
            const amount = Number.isFinite(stored) && stored > 0
                ? stored
                : getHabitGoals(prop, sourceDate).desired;
            deferredByDate.set(target, (deferredByDate.get(target) || 0) + amount);
        }

        const startDate = moment(endDate).subtract(Math.max(1, days) - 1, 'days');
        const dates = Array.from({ length: Math.max(1, days) }, (_, index) =>
            moment(startDate).add(index, 'days').format('YYYY-MM-DD')
        );
        const values = new Map<string, number>();
        for (const date of dates) {
            const fm = frontmatterByDate.get(date) || {};
            values.set(date, getHabitValueFromFrontmatter(fm, prop));
        }

        const weeklyTotals = new Map<string, number>();
        if ((prop.goalMode || 'daily') === 'weekly') {
            for (const [date, value] of values) {
                const week = moment(date).startOf('isoWeek').format('YYYY-MM-DD');
                weeklyTotals.set(week, (weeklyTotals.get(week) || 0) + value);
            }
        }

        const snapshots = dates.map(date => {
            const fm = frontmatterByDate.get(date) || {};
            const value = values.get(date) || 0;
            const deferredBonus = deferredByDate.get(date) || 0;
            const goals = getHabitGoals(prop, date, deferredBonus);
            const week = moment(date).startOf('isoWeek').format('YYYY-MM-DD');
            const aggregate = goals.mode === 'weekly' ? weeklyTotals.get(week) || 0 : undefined;
            const state = date < (prop.createdAt || '0000-00-00')
                ? 'pending'
                : evaluateHabitState(
                    prop, value, date, readHabitExplicitState(fm, prop.name),
                    aggregate, deferredBonus, endDate
                );
            return { date, value, state, minimum: goals.minimum, desired: goals.desired };
        });

        const scoredSnapshots = (prop.goalMode || 'daily') === 'weekly'
            ? [...new Map(snapshots.map(day => [moment(day.date).startOf('isoWeek').format('YYYY-MM-DD'), day])).values()]
            : snapshots;
        let bestStreak = 0;
        let streak = 0;
        for (const day of scoredSnapshots) {
            if (day.state === 'completed' || day.state === 'partial') streak++;
            else if (!statePreservesStreak(day.state)) streak = 0;
            bestStreak = Math.max(bestStreak, streak);
        }

        const scored = scoredSnapshots.filter(day =>
            day.state === 'completed' || day.state === 'partial' || day.state === 'missed' || day.state === 'skipped'
        );
        const successful = scored.filter(day => day.state === 'completed' || day.state === 'partial').length;
        const total = snapshots.reduce((sum, day) => sum + day.value, 0);
        const averageDays = snapshots.filter(day => day.date >= (prop.createdAt || '0000-00-00')).length;
        const today = snapshots[snapshots.length - 1]!;

        return {
            property: prop,
            days: snapshots,
            today,
            currentStreak: await this.plugin.getHabitStreak(prop.name),
            bestStreak,
            completionRate: scored.length > 0 ? Math.round(successful / scored.length * 100) : 0,
            average: averageDays > 0 ? total / averageDays : 0,
            total
        };
    }

    async getAllSnapshots(days = 84): Promise<HabitSnapshot[]> {
        return Promise.all(this.plugin.settings.properties.map(prop => this.getHabitSnapshot(prop, days)));
    }
}
