import { isDone } from '../utils/status';

/**
 * Pure timeline model builder for the "Timeline" project tab.
 *
 * The module is deliberately free of Obsidian/Svelte/i18n dependencies so it can be
 * unit-tested in a plain Node environment. The component only renders the model and
 * localizes labels.
 *
 * Grouping rules:
 *  - startDate + endDate  → a bar (полоса), clamped to the visible range;
 *  - only endDate         → a milestone on that date;
 *  - only startDate       → a milestone on the start date (a task is never dropped);
 *  - no dates at all      → collected into the `noDates` group.
 *
 * "Today" is always passed in as a `YYYY-MM-DD` string so results stay deterministic.
 */

export const DAY_MS = 86_400_000;

/** Maximum visible range, so a single far-future date cannot stretch the track forever. */
export const MAX_RANGE_DAYS = 730;

export interface TimelineTaskInput {
    id: string;
    name: string;
    status: string;
    priority?: string;
    startDate?: string;
    endDate?: string;
    subtasks?: { checked: boolean }[];
}

export interface TimelineWeek {
    /** ISO-style week id = key of its first (Monday) day. */
    id: string;
    start: string;
    end: string;
    days: number;
    /** How much of the visible range this week occupies (0..100). */
    widthPct: number;
    offsetPct: number;
    clippedStart: boolean;
    clippedEnd: boolean;
}

export interface TimelineMonth {
    /** `YYYY-MM` */
    id: string;
    year: number;
    /** 0-based month index, so the component can localize the name. */
    month: number;
    start: string;
    end: string;
    days: number;
    widthPct: number;
    offsetPct: number;
    weeks: TimelineWeek[];
}

export interface TimelineItem {
    task: TimelineTaskInput;
    kind: 'bar' | 'milestone';
    /** Visible start/end after clamping to the range. */
    start: string;
    end: string;
    /** Original (unclamped) task dates for tooltips. */
    actualStart: string;
    actualEnd: string;
    clampedStart: boolean;
    clampedEnd: boolean;
    overdue: boolean;
    done: boolean;
    /** Subtask completion, 0..100 (0 when there are no subtasks). */
    progressPct: number;
    offsetPct: number;
    widthPct: number;
}

export interface TimelineModel {
    start: string;
    end: string;
    days: number;
    months: TimelineMonth[];
    /** Bars sorted by start date, then name. */
    bars: TimelineItem[];
    /** Milestones sorted by date, then name. */
    milestones: TimelineItem[];
    /** Tasks without any usable date — kept visible instead of being dropped. */
    noDates: TimelineTaskInput[];
    /** Position of "today" on the track, or null when it is outside the range. */
    todayPct: number | null;
    todayKey: string;
    overdueCount: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalizes `2026-09-21T10:00:00+03:00` → `2026-09-21`; rejects non-calendar junk like `2026-13-45`. */
export function normalizeDate(value?: string): string | undefined {
    if (!value) return undefined;
    const key = value.slice(0, 10);
    if (!DATE_RE.test(key)) return undefined;
    return toKey(parseKey(key)) === key ? key : undefined;
}

/** Parses a `YYYY-MM-DD` key as UTC noon — immune to local DST shifts. */
export function parseKey(key: string): Date {
    return new Date(`${key}T12:00:00Z`);
}

export function toKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(key: string, days: number): string {
    const date = parseKey(key);
    date.setUTCDate(date.getUTCDate() + days);
    return toKey(date);
}

/** Whole days from `from` to `to` (can be negative). */
export function daysBetween(from: string, to: string): number {
    return Math.round((parseKey(to).getTime() - parseKey(from).getTime()) / DAY_MS);
}

export function startOfMonth(key: string): string {
    const date = parseKey(key);
    return toKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12)));
}

export function endOfMonth(key: string): string {
    const date = parseKey(key);
    return toKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)));
}

export function monthKey(key: string): string {
    return key.slice(0, 7);
}

/** Monday-based day offset used for week grouping. */
function mondayOffset(date: Date): number {
    return (date.getUTCDay() + 6) % 7;
}

export function startOfWeek(key: string): string {
    return addDays(key, -mondayOffset(parseKey(key)));
}

function pct(value: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round(value / total * 10000) / 100;
}

function buildMonths(start: string, end: string, totalDays: number): TimelineMonth[] {
    const months: TimelineMonth[] = [];
    let cursor = startOfMonth(start);
    const limit = monthKey(end);
    let guard = 0;
    while (cursor <= end && guard < 240) {
        guard++;
        const id = monthKey(cursor);
        const monthEnd = endOfMonth(cursor);
        const visibleStart = cursor < start ? start : cursor;
        const visibleEnd = monthEnd > end ? end : monthEnd;
        months.push({
            id,
            year: Number(id.slice(0, 4)),
            month: Number(id.slice(5, 7)) - 1,
            start: cursor,
            end: monthEnd,
            days: daysBetween(cursor, monthEnd) + 1,
            widthPct: pct(daysBetween(visibleStart, visibleEnd) + 1, totalDays),
            offsetPct: pct(daysBetween(start, visibleStart), totalDays),
            weeks: buildWeeks(visibleStart, visibleEnd, start, totalDays)
        });
        cursor = addDays(monthEnd, 1);
        if (id === limit) break;
    }
    return months;
}

function buildWeeks(start: string, end: string, rangeStart: string, totalDays: number): TimelineWeek[] {
    const weeks: TimelineWeek[] = [];
    let cursor = startOfWeek(start) < start ? start : startOfWeek(start);
    let guard = 0;
    while (cursor <= end && guard < 60) {
        guard++;
        const weekEnd = addDays(startOfWeek(cursor), 6);
        const visibleEnd = weekEnd > end ? end : weekEnd;
        weeks.push({
            id: startOfWeek(cursor),
            start: cursor,
            end: visibleEnd,
            days: daysBetween(cursor, visibleEnd) + 1,
            widthPct: pct(daysBetween(cursor, visibleEnd) + 1, totalDays),
            offsetPct: pct(daysBetween(rangeStart, cursor), totalDays),
            clippedStart: cursor === start && startOfWeek(cursor) !== start,
            clippedEnd: visibleEnd !== weekEnd
        });
        cursor = addDays(visibleEnd, 1);
    }
    return weeks;
}

function subtaskProgress(task: TimelineTaskInput): number {
    if (!task.subtasks?.length) return 0;
    return Math.round(task.subtasks.filter(item => item.checked).length / task.subtasks.length * 100);
}

/**
 * Builds the timeline model.
 *
 * @param tasks  tasks of the active scope (structural subset of ProjectTask)
 * @param columns configured board columns — the last one counts as "done"
 * @param today  `YYYY-MM-DD` reference day (injected for testability)
 */
export function buildTimeline(tasks: TimelineTaskInput[], columns: string[], today: string): TimelineModel {
    const todayKey = normalizeDate(today) ?? toKey(new Date());
    const doneStatus = columns[columns.length - 1] || 'Done';
    const isTaskDone = (task: TimelineTaskInput): boolean => isDone(task.status) || task.status === doneStatus;

    let min: string | undefined;
    let max: string | undefined;
    for (const task of tasks) {
        const start = normalizeDate(task.startDate);
        const end = normalizeDate(task.endDate);
        for (const key of [start, end]) {
            if (!key) continue;
            if (!min || key < min) min = key;
            if (!max || key > max) max = key;
        }
    }

    // The visible range always covers the desired span (all task dates plus the whole
    // current month). When that span exceeds MAX_RANGE_DAYS it is trimmed from both
    // sides proportionally, so the current month is never cut away.
    const desiredStart = startOfMonth(min && min < todayKey ? min : todayKey);
    const desiredEnd = endOfMonth(max && max > todayKey ? max : todayKey);
    let rangeStart = desiredStart;
    let rangeEnd = desiredEnd;
    const desiredSpan = daysBetween(desiredStart, desiredEnd) + 1;
    if (desiredSpan > MAX_RANGE_DAYS) {
        const overflow = desiredSpan - MAX_RANGE_DAYS;
        const todayMonthStart = startOfMonth(todayKey);
        const todayMonthEnd = endOfMonth(todayKey);
        const pastOverflow = Math.max(0, daysBetween(desiredStart, todayMonthStart));
        const futureOverflow = Math.max(0, daysBetween(todayMonthEnd, desiredEnd));
        const denominator = pastOverflow + futureOverflow || 1;
        const cutPast = Math.min(pastOverflow, Math.floor(overflow * pastOverflow / denominator));
        const cutFuture = overflow - cutPast;
        if (cutPast > 0) rangeStart = addDays(desiredStart, cutPast);
        if (cutFuture > 0) rangeEnd = addDays(desiredEnd, -cutFuture);
    }

    const totalDays = daysBetween(rangeStart, rangeEnd) + 1;
    const months = buildMonths(rangeStart, rangeEnd, totalDays);

    const collected: TimelineItem[] = [];
    const noDates: TimelineTaskInput[] = [];
    let overdueCount = 0;

    for (const task of tasks) {
        const start = normalizeDate(task.startDate);
        const end = normalizeDate(task.endDate);
        if (!start && !end) {
            noDates.push(task);
            continue;
        }
        const done = isTaskDone(task);
        const kind: TimelineItem['kind'] = start && end ? 'bar' : 'milestone';
        // Tolerate reversed dates in note properties: always render start ≤ end.
        let actualStart = start ?? end!;
        let actualEnd = end ?? start!;
        if (actualStart > actualEnd) [actualStart, actualEnd] = [actualEnd, actualStart];
        const overdue = Boolean(end && end < todayKey && !done);
        if (overdue) overdueCount++;

        const visibleStartKey = actualStart < rangeStart ? rangeStart : actualStart > rangeEnd ? rangeEnd : actualStart;
        const visibleEndKey = actualEnd > rangeEnd ? rangeEnd : actualEnd < rangeStart ? rangeStart : actualEnd;

        collected.push({
            task,
            kind,
            start: visibleStartKey,
            end: visibleEndKey,
            actualStart,
            actualEnd,
            clampedStart: visibleStartKey !== actualStart,
            clampedEnd: visibleEndKey !== actualEnd,
            overdue,
            done,
            progressPct: subtaskProgress(task),
            offsetPct: pct(daysBetween(rangeStart, visibleStartKey), totalDays),
            widthPct: pct(daysBetween(visibleStartKey, visibleEndKey) + 1, totalDays)
        });
    }

    const barItems = collected.filter(item => item.kind === 'bar').sort(compareItems);
    const milestoneItems = collected.filter(item => item.kind === 'milestone').sort(compareItems);

    return {
        start: rangeStart,
        end: rangeEnd,
        days: totalDays,
        months,
        bars: barItems,
        milestones: milestoneItems,
        noDates: noDates.sort((a, b) => a.name.localeCompare(b.name)),
        todayPct: todayKey >= rangeStart && todayKey <= rangeEnd ? pct(daysBetween(rangeStart, todayKey), totalDays) : null,
        todayKey,
        overdueCount
    };
}

function compareItems(a: TimelineItem, b: TimelineItem): number {
    if (a.actualEnd !== b.actualEnd) return a.actualEnd.localeCompare(b.actualEnd);
    if (a.actualStart !== b.actualStart) return a.actualStart.localeCompare(b.actualStart);
    return a.task.name.localeCompare(b.task.name);
}
