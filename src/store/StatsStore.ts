import { writable } from 'svelte/store';
import { App, moment } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { getDailyNotes, SESSION_ROW_REGEX, parseDuration } from '../utils';
import { getHabitValueFromFrontmatter } from '../services/habit-service';
import type { HabitDayState, HabitExplicitState } from '../types';
import {
    evaluateHabitState, getHabitDeferredAmountKey, getHabitDeferredToKey,
    getHabitGoals, readHabitExplicitState
} from '../habits/goals';

export interface SessionRecord { startHour: number; durationSec: number; subTask?: string; task?: string; }
export interface DailyRecord {
    date: string;
    habit: string;
    type: string;
    subTask?: string;
    durationSec: number;
    sessions?: SessionRecord[];
    explicitState?: HabitExplicitState | null;
    state?: HabitDayState;
    minimumGoal?: number;
    desiredGoal?: number;
    deferredBonus?: number;
}

export const allRecords = writable<DailyRecord[]>([]);
export const recordsIndex = writable<Map<string, Map<string, DailyRecord>>>(new Map());

export const currentStatsTab = writable<'analytics' | 'gamification'>('analytics');
export const currentPeriod = writable<'day' | 'week' | 'month' | 'all'>('month');
export const selectedStatsHabit = writable<string | null>(null);
export const viewMode = writable<'main' | 'detail'>('main');

export const isStatsLoading = writable<boolean>(false);

export async function reloadStatsData(app: App, plugin: HabitTimerPlugin) {
    isStatsLoading.set(true);
    
    const records: DailyRecord[] = [];
    const index = new Map<string, Map<string, DailyRecord>>();
    const files = getDailyNotes(app, plugin.settings.dailyNotesFolder);
    const deferredBonuses = new Map<string, number>();

    for (const file of files) {
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm) continue;
        for (const prop of plugin.settings.properties) {
            if (readHabitExplicitState(fm, prop.name) !== 'deferred') continue;
            const target = String(fm[getHabitDeferredToKey(prop.name)] || '');
            if (!target) continue;
            const stored = Number(fm[getHabitDeferredAmountKey(prop.name)]);
            const amount = Number.isFinite(stored) && stored > 0 ? stored : getHabitGoals(prop, file.basename).desired;
            const key = `${prop.name}|${target}`;
            deferredBonuses.set(key, (deferredBonuses.get(key) || 0) + amount);
        }
    }

    for (const file of files) {
        const dateStr = file.basename;
        const content = await app.vault.cachedRead(file);
        const lines = content.split('\n');
        const dailySessions: Record<string, SessionRecord[]> = {};

        for (const line of lines) {
            const m = line.match(SESSION_ROW_REGEX);
            if (m && m[1] && m[2] && m[3]) {
                const startHour = parseInt(m[1]);
                const rawHabit = m[2].trim();
                const parts = rawHabit.split(':');
                const habitName = (parts[0] || rawHabit).trim();
                const subTask = (parts[1] || "").trim();
                const task = m[4] ? m[4].trim() : "";

                const sec = parseDuration(m[3]);
                if (sec > 0) {
                    if (!dailySessions[habitName]) dailySessions[habitName] = [];
                    dailySessions[habitName].push({ startHour, durationSec: sec, subTask, task });
                }
            }
        }

        const cache = app.metadataCache.getFileCache(file);
        if (!cache?.frontmatter) continue;
        const fm = cache.frontmatter;

        for (const prop of plugin.settings.properties) {
            const type = prop.type || 'timer';
            const createdAt = prop.createdAt || "0000-00-00";
            if (dateStr < createdAt) continue;

            const valueForDay = getHabitValueFromFrontmatter(fm, prop);
            const propertyExists = type === 'negative'
                || Object.keys(fm).some(k => k === prop.name || k.startsWith(prop.name + ':'))
                || readHabitExplicitState(fm, prop.name) !== null;

            if (propertyExists || dateStr <= moment().format('YYYY-MM-DD')) {
                const deferredBonus = deferredBonuses.get(`${prop.name}|${dateStr}`) || 0;
                const goals = getHabitGoals(prop, dateStr, deferredBonus);
                const record: DailyRecord = {
                    date: dateStr,
                    habit: prop.name,
                    type,
                    durationSec: valueForDay,
                    sessions: dailySessions[prop.name] || [],
                    explicitState: readHabitExplicitState(fm, prop.name),
                    minimumGoal: goals.minimum,
                    desiredGoal: goals.desired,
                    deferredBonus
                };
                records.push(record);

                if (!index.has(prop.name)) index.set(prop.name, new Map());
                index.get(prop.name)!.set(dateStr, record);
            }
        }
    }

    records.forEach(record => {
        const prop = plugin.settings.properties.find(value => value.name === record.habit);
        if (!prop) return;
        const weeklyValue = (prop.goalMode || 'daily') === 'weekly'
            ? records
                .filter(other => other.habit === record.habit && moment(other.date).isSame(moment(record.date), 'isoWeek'))
                .reduce((sum, other) => sum + other.durationSec, 0)
            : undefined;
        record.state = evaluateHabitState(
            prop, record.durationSec, record.date, record.explicitState || null,
            weeklyValue, record.deferredBonus || 0, moment().format('YYYY-MM-DD')
        );
    });

    allRecords.set(records);
    recordsIndex.set(index);
    isStatsLoading.set(false);
}
