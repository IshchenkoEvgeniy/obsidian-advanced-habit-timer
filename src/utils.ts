import { TFile, App } from 'obsidian';
import { getHabitGoals } from './habits/goals';
import type { HabitProperty } from './types';

export const SESSION_ROW_REGEX = /\|\s*(\d{2}):\d{2}\s*-.*?\|\s*.*?\s*\|\s*(.*?)\s*\|\s*(\d{2}:\d{2}:\d{2})\s*\|(?:.*?\|)?\s*(.*?)\s*\|/;

export interface SessionData { habit: string, subTask?: string, durationSec: number, task?: string, startHour: number }

export const HABIT_TYPE = {
    TIMER: 'timer',
    COUNT: 'count',
    BINARY: 'binary',
    NEGATIVE: 'negative',
} as const;

export const PROP_DEFAULTS = {
    TIMER: '00:00:00',
    COUNT: 0,
    BINARY: false,
    NEGATIVE: false,
};

/** Returns the goal value in canonical units (seconds for timer, numeric for count, 1 for binary/negative) */
export function getHabitGoal(prop: HabitProperty, date = new Date().toISOString().slice(0, 10), deferredBonus = 0): number {
    return getHabitGoals(prop, date, deferredBonus).desired;
}

/** Returns true if the recorded value meets or exceeds the habit goal */
export function isHabitMet(prop: HabitProperty, value: number, date = new Date().toISOString().slice(0, 10), aggregateValue?: number): boolean {
    const goals = getHabitGoals(prop, date);
    const comparedValue = goals.mode === 'weekly' ? (aggregateValue ?? value) : value;
    return comparedValue >= goals.minimum;
}

// --- Safe Type Getters for Frontmatter ---
export function getString(val: unknown, def = ''): string {
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return def;
}
export function getStringOpt(val: unknown): string | undefined {
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return undefined;
}

export function getNumber(val: unknown, def = 0): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const n = Number(val);
        return isNaN(n) ? def : n;
    }
    return def;
}

export function getBoolean(val: unknown, def = false): boolean {
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === 1) return true;
    if (val === 'false' || val === 0) return false;
    return def;
}

export function getArray<T = unknown>(val: unknown, def: T[] = []): T[] {
    if (Array.isArray(val)) return val as T[];
    return def;
}

export function getObject(val: unknown, def: Record<string, unknown> = {}): Record<string, unknown> {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
    return def;
}

export function parseDuration(val: unknown): number {
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'number') return val;
    if (typeof val !== 'string') return 0;
    const p = val.split(':').map(Number);
    return p.length === 3 ? (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0) : 0;
}

export function formatDuration(s: number): string {
    const h = Math.floor(s / 3600).toString().padStart(2, '0');
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
}

import { t } from './i18n';
import type { Language } from './i18n';

export function formatDurationShort(s: number, lang: Language = 'en'): string {
    if (s === 0) return `0${t(lang, 'unit_m')}`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const uh = t(lang, 'unit_h');
    const um = t(lang, 'unit_m');
    return h > 0 ? (m > 0 ? `${h}${uh} ${m}${um}` : `${h}${uh}`) : `${m}${um}`;
}

export function isDailyNote(file: TFile): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(file.basename);
}

export function getDailyNotes(app: App, folder: string): TFile[] {
    const allFiles = app.vault.getMarkdownFiles();
    return allFiles.filter((f: TFile) => {
        if (folder && !f.path.startsWith(folder)) return false;
        return isDailyNote(f);
    });
}

export async function fetchSessionsFromFile(app: App, file: TFile): Promise<SessionData[]> {
    const content = await app.vault.read(file);
    const lines = content.split('\n');
    const sessions: SessionData[] = [];

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
                sessions.push({ habit: habitName, subTask, durationSec: sec, task, startHour });
            }
        }
    }
    return sessions;
}
