import { moment } from 'obsidian';
import { get } from 'svelte/store';
import type HabitTimerPlugin from '../main';
import { getHabitGoals, evaluateHabitState, readHabitExplicitState } from '../habits/goals';
import { habitForCollection } from '../library/habit-links';
import {
    getHabitDeferredBonus,
    getHabitValueFromFrontmatter,
    getHabitWeeklyValue
} from '../services/habit-service';
import { isDone } from '../utils/status';
import { habitId } from './habit-id';
import { HabitSnapshotService } from '../services/habit-snapshot-service';
import {
    DASHBOARD_API_VERSION,
    type ActiveTimerDto,
    type DashboardDomain,
    type DashboardSnapshot,
    type DashboardSnapshotQuery,
    type HabitCapability,
    type HabitHistoryDto,
    type HabitDto,
    type MediaItemDto,
    type ProjectTaskDto
} from './dashboard-api-contract';

export const DASHBOARD_API_CAPABILITIES: readonly HabitCapability[] = [
    'timer.read',
    'timer.control',
    'habits.read',
    'habits.update',
    'projects.read',
    'projects.update',
    'library.read',
    'stats.read'
];

function wants(query: DashboardSnapshotQuery, domain: DashboardDomain): boolean {
    return !query.domains?.length || query.domains.includes(domain);
}

async function habitHistorySnapshots(
    plugin: HabitTimerPlugin,
    query: DashboardSnapshotQuery,
    date: string,
    requestedDays?: number
): Promise<HabitHistoryDto[]> {
    const days = Math.min(366, Math.max(1, requestedDays || query.habitHistoryDays || 28));
    const requestedIds = query.habitIds?.length ? new Set(query.habitIds) : null;
    const properties = plugin.settings.properties.filter(property => !requestedIds || requestedIds.has(habitId(property)));
    const service = new HabitSnapshotService(plugin);
    return Promise.all(properties.map(async property => {
        const snapshot = await service.getHabitSnapshot(property, days, date);
        return {
            habitId: habitId(property),
            habitName: property.name,
            days: snapshot.days.map(day => ({ ...day })),
            currentStreak: snapshot.currentStreak,
            bestStreak: snapshot.bestStreak,
            completionRate: snapshot.completionRate,
            average: snapshot.average,
            total: snapshot.total
        };
    }));
}

async function statsSnapshot(
    plugin: HabitTimerPlugin,
    query: DashboardSnapshotQuery,
    date: string
): Promise<NonNullable<DashboardSnapshot['stats']>> {
    const rangeDays = Math.min(366, Math.max(1, query.statsRangeDays || 30));
    const history = await habitHistorySnapshots(plugin, query, date, rangeDays);
    const scoredStates = new Set(['completed', 'partial', 'missed', 'skipped']);
    const completedStates = new Set(['completed', 'partial']);
    let scoredHabitDays = 0;
    let completedHabitDays = 0;
    for (const habit of history) {
        for (const day of habit.days) {
            if (scoredStates.has(day.state)) scoredHabitDays += 1;
            if (completedStates.has(day.state)) completedHabitDays += 1;
        }
    }

    let activeTasks = 0;
    let completedTasks = 0;
    for (const scope of plugin.settings.projectScopes) {
        for (const task of await plugin.projectEngine.loadTasks(scope)) {
            if (isDone(task.status || '')) completedTasks += 1;
            else activeTasks += 1;
        }
    }

    const media = get(plugin.stateManager.mediaItems);
    const completedMedia = media.filter(item => isDone(item.status || '') || (item.total > 0 && item.progress >= item.total)).length;
    const timerIds = new Set(plugin.settings.properties
        .filter(property => (property.type || 'timer') === 'timer')
        .map(property => habitId(property)));

    return {
        rangeDays,
        trackedHabits: history.length,
        completedHabitDays,
        scoredHabitDays,
        habitCompletionRate: scoredHabitDays > 0 ? Math.round(completedHabitDays / scoredHabitDays * 100) : 0,
        totalTimerSeconds: history.filter(item => timerIds.has(item.habitId)).reduce((sum, item) => sum + item.total, 0),
        activeTasks,
        completedTasks,
        activeMedia: Math.max(0, media.length - completedMedia),
        completedMedia
    };
}

function normalizedSet(values?: string[]): Set<string> | null {
    if (!values?.length) return null;
    return new Set(values.map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
}

function activeTimerSnapshot(plugin: HabitTimerPlugin): ActiveTimerDto | null {
    const active = plugin.settings.activeTimer;
    if (!active) return null;

    const property = plugin.settings.properties.find(value => value.name === active.habitName);
    const state = active.timerState || 'running';
    const delta = state === 'running' && active.lastStartedAt
        ? Math.max(0, Math.floor((Date.now() - active.lastStartedAt) / 1000))
        : 0;
    const elapsedSeconds = Math.max(0, active.elapsedSeconds || 0) + delta;
    const remainingSeconds = active.mode === 'pm'
        ? Math.max(0, (active.remainingSeconds ?? plugin.settings.pomodoroDuration * 60) - delta)
        : undefined;

    const media = active.bookPath
        ? get(plugin.stateManager.mediaItems).find(item => item.file.path === active.bookPath)
        : undefined;

    return {
        habitId: property ? habitId(property) : `legacy:${active.habitName}`,
        habitName: active.habitName,
        mode: active.mode,
        state,
        startedAt: active.startTime,
        elapsedSeconds,
        remainingSeconds,
        lastStartedAt: active.lastStartedAt,
        targetSeconds: active.targetSeconds,
        taskName: active.taskName,
        mediaPath: active.bookPath,
        mediaTitle: media?.title,
        subTask: active.subTask
    };
}

async function habitSnapshots(
    plugin: HabitTimerPlugin,
    query: DashboardSnapshotQuery,
    date: string
): Promise<HabitDto[]> {
    const note = plugin.getDailyNote(date);
    const frontmatter = note
        ? (plugin.app.metadataCache.getFileCache(note)?.frontmatter || {}) as Record<string, unknown>
        : {};

    return Promise.all(plugin.settings.properties
        .filter(property => (property.createdAt || '0000-00-00') <= date)
        .map(async property => {
            const value = getHabitValueFromFrontmatter(frontmatter, property);
            const deferred = getHabitDeferredBonus(
                plugin.app,
                plugin.settings.dailyNotesFolder,
                property,
                date
            );
            const goals = getHabitGoals(property, date, deferred);
            const aggregate = goals.mode === 'weekly'
                ? getHabitWeeklyValue(plugin.app, plugin.settings.dailyNotesFolder, property, date)
                : undefined;
            const item: HabitDto = {
                id: habitId(property),
                name: property.name,
                type: property.type || 'timer',
                value,
                minimum: goals.minimum,
                desired: goals.desired,
                goalMode: goals.mode,
                state: evaluateHabitState(
                    property,
                    value,
                    date,
                    readHabitExplicitState(frontmatter, property.name),
                    aggregate,
                    deferred,
                    date
                )
            };
            if (query.includeHabitStreaks) item.streak = await plugin.getHabitStreak(property.name);
            return item;
        }));
}

async function projectSnapshots(
    plugin: HabitTimerPlugin,
    query: DashboardSnapshotQuery
): Promise<{ projectScopes: DashboardSnapshot['projectScopes']; tasks: ProjectTaskDto[] }> {
    const requestedScopes = query.projectScopeIds?.length ? new Set(query.projectScopeIds) : null;
    const scopes = plugin.settings.projectScopes.filter(scope => !requestedScopes || requestedScopes.has(scope.id));
    const taskLimit = Math.max(1, query.taskLimit || 500);
    const tasks: ProjectTaskDto[] = [];

    for (const scope of scopes) {
        const loaded = await plugin.projectEngine.loadTasks(scope);
        for (const task of loaded) {
            if (!query.includeCompletedTasks && isDone(task.status || '')) continue;
            const linkedHabit = plugin.settings.properties.find(property => property.name === task.habitName);
            tasks.push({
                id: task.id,
                scopeId: scope.id,
                filePath: task.file.path,
                name: task.name,
                status: task.status,
                timeSpentSeconds: task.timeSpentSec,
                timeEstimatedSeconds: task.timeEstimatedSec,
                habitId: linkedHabit ? habitId(linkedHabit) : undefined,
                habitName: task.habitName,
                startDate: task.startDate,
                endDate: task.endDate,
                cover: task.cover,
                color: task.color,
                tags: task.tags,
                priority: task.priority,
                order: task.order,
                sourceLine: task.sourceLine,
                blockId: task.blockId,
                subtasks: task.subtasks?.map(subtask => ({ ...subtask })) || []
            });
            if (tasks.length >= taskLimit) break;
        }
        if (tasks.length >= taskLimit) break;
    }

    return {
        projectScopes: scopes.map(scope => ({
            id: scope.id,
            name: scope.name,
            color: scope.color,
            statuses: scope.statuses.split(',').map(status => status.trim()).filter(Boolean)
        })),
        tasks
    };
}

function mediaSnapshots(plugin: HabitTimerPlugin, query: DashboardSnapshotQuery): MediaItemDto[] {
    const collections = normalizedSet(query.mediaCollectionIds);
    const statuses = normalizedSet(query.mediaStatuses);
    const limit = Math.max(1, query.mediaLimit || 500);

    return get(plugin.stateManager.mediaItems)
        .filter(item => !collections || collections.has(item.collectionId.trim().toLocaleLowerCase()))
        .filter(item => !statuses || statuses.has(item.status.trim().toLocaleLowerCase()))
        .slice(0, limit)
        .map(item => {
            const linkedHabit = habitForCollection(plugin.settings, item.collectionId);
            return {
                path: item.file.path,
                title: item.title,
                collectionId: item.collectionId,
                status: item.status,
                cover: item.cover || undefined,
                progress: item.progress,
                total: item.total,
                rating: item.rating || undefined,
                author: item.authorOrDirector || undefined,
                series: item.series || undefined,
                genre: item.genre || undefined,
                unit: item.unit || undefined,
                startDate: item.startDate || undefined,
                endDate: item.endDate || undefined,
                queueOrder: item.queueOrder,
                targetDate: item.targetDate,
                linkedHabitId: linkedHabit ? habitId(linkedHabit) : undefined
            };
        });
}

export async function buildDashboardSnapshot(
    plugin: HabitTimerPlugin,
    query: DashboardSnapshotQuery = {},
    revision: number
): Promise<DashboardSnapshot> {
    const date = query.date || moment().format('YYYY-MM-DD');
    const snapshot: DashboardSnapshot = {
        apiVersion: DASHBOARD_API_VERSION,
        generatedAt: Date.now(),
        revision,
        locale: plugin.settings.language,
        capabilities: [...DASHBOARD_API_CAPABILITIES]
    };

    if (wants(query, 'timer')) snapshot.timer = activeTimerSnapshot(plugin);
    if (wants(query, 'habits')) {
        snapshot.habits = await habitSnapshots(plugin, query, date);
        if (query.habitHistoryDays) snapshot.habitHistory = await habitHistorySnapshots(plugin, query, date);
    }
    if (wants(query, 'projects')) {
        const projects = await projectSnapshots(plugin, query);
        snapshot.projectScopes = projects.projectScopes;
        snapshot.tasks = projects.tasks;
    }
    if (wants(query, 'library')) snapshot.media = mediaSnapshots(plugin, query);
    if (wants(query, 'stats')) snapshot.stats = await statsSnapshot(plugin, query, date);

    return snapshot;
}
