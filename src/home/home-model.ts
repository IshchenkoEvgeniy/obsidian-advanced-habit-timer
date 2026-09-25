/**
 * Pure logic for the Today (home) screen: greeting, task grouping, day summary.
 * No Obsidian/Svelte imports - fully unit-testable. Dates are passed as strings
 * ('YYYY-MM-DD'); "today" is injectable for tests.
 */

export interface HomeTaskInput {
    name: string;
    date?: string;
    deadline?: string;
    done: boolean;
}

export interface HomeTaskGrouped extends HomeTaskInput {
    /** ISO date used for sorting: deadline if set, otherwise the task date. */
    sortKey: string;
    overdue: boolean;
    today: boolean;
}

export interface TaskGroups {
    overdue: HomeTaskGrouped[];
    today: HomeTaskGrouped[];
    upcoming: HomeTaskGrouped[];
    noDate: HomeTaskGrouped[];
}

export type GreetingKind = 'morning' | 'afternoon' | 'evening' | 'night';

/** Greeting bucket by hour. 5-11 morning, 12-16 afternoon, 17-22 evening, else night. */
export function greetingKind(hour: number): GreetingKind {
    if (hour >= 5 && hour <= 11) return 'morning';
    if (hour >= 12 && hour <= 16) return 'afternoon';
    if (hour >= 17 && hour <= 22) return 'evening';
    return 'night';
}

/** Sort key: deadline wins over the scheduled date; missing both sorts last. */
export function taskSortKey(task: HomeTaskInput): string {
    const raw = task.deadline && task.deadline.length >= 10
        ? task.deadline.slice(0, 10)
        : task.date && task.date.length >= 10 ? task.date.slice(0, 10) : '';
    return raw || '9999-12-31';
}

/** Group pending tasks into overdue / today / upcoming / no-date buckets. */
export function groupTasks(tasks: HomeTaskInput[], today: string): TaskGroups {
    const groups: TaskGroups = { overdue: [], today: [], upcoming: [], noDate: [] };
    for (const task of tasks) {
        if (task.done) continue;
        const sortKey = taskSortKey(task);
        const hasDate = sortKey !== '9999-12-31';
        const grouped: HomeTaskGrouped = { ...task, sortKey, overdue: hasDate && sortKey < today, today: hasDate && sortKey === today };
        if (!hasDate) groups.noDate.push(grouped);
        else if (grouped.overdue) groups.overdue.push(grouped);
        else if (grouped.today) groups.today.push(grouped);
        else groups.upcoming.push(grouped);
    }
    const byKey = (a: HomeTaskGrouped, b: HomeTaskGrouped) => a.sortKey.localeCompare(b.sortKey) || a.name.localeCompare(b.name);
    groups.overdue.sort(byKey);
    groups.today.sort(byKey);
    groups.upcoming.sort(byKey);
    groups.noDate.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
}

/** Five nearest pending tasks for the home card: overdue first, then today/upcoming. */
export function nearestTasks(tasks: HomeTaskInput[], today: string, limit = 5): HomeTaskGrouped[] {
    const g = groupTasks(tasks, today);
    return [...g.overdue, ...g.today, ...g.upcoming, ...g.noDate].slice(0, limit);
}

export interface DaySummaryInput {
    timerSecondsToday?: number;
    tasksDoneToday?: number;
    pagesReadToday?: number;
}

/** Returns null when there is nothing to show (all values missing/zero). */
export function buildDaySummary(input: DaySummaryInput, formatDuration: (sec: number) => string): string[] | null {
    const parts: string[] = [];
    if (input.timerSecondsToday && input.timerSecondsToday > 0) parts.push(formatDuration(input.timerSecondsToday));
    if (input.tasksDoneToday && input.tasksDoneToday > 0) parts.push(String(input.tasksDoneToday));
    if (input.pagesReadToday && input.pagesReadToday > 0) parts.push(String(input.pagesReadToday));
    return parts.length ? parts : null;
}

export interface HomeProjectCard {
    scopeId: string;
    name: string;
    color?: string;
    total: number;
    done: number;
    pct: number;
    nearestDeadline?: string;
}

export interface ProjectScopeTasks {
    scopeId: string;
    name: string;
    color?: string;
    tasks: (HomeTaskInput & { status: string; endDate?: string })[];
    /** Status considered "done": resolved by the caller (last column or isDone). */
    isTaskDone: (status: string) => boolean;
    statuses: string[];
}

export function buildProjectCards(scopes: ProjectScopeTasks[], today: string): HomeProjectCard[] {
    return scopes.map(scope => {
        const total = scope.tasks.length;
        const done = scope.tasks.filter(task => task.done || scope.isTaskDone(task.status)).length;
        const deadlines = scope.tasks
            .filter(task => !scope.isTaskDone(task.status) && task.endDate && task.endDate.length >= 10)
            .map(task => task.endDate!.slice(0, 10))
            .filter(date => date >= today)
            .sort();
        return {
            scopeId: scope.scopeId,
            name: scope.name,
            color: scope.color,
            total,
            done,
            pct: total ? Math.round(done / total * 100) : 0,
            nearestDeadline: deadlines[0]
        };
    });
}