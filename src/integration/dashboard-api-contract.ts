/**
 * Stable, serializable contract exposed to dashboard-style companion plugins.
 *
 * Keep this module free of Obsidian, Svelte and implementation-class imports.
 * Consumers must be able to copy the contract without depending on this bundle.
 */

export const DASHBOARD_API_VERSION = 1 as const;
export const DASHBOARD_API_REQUEST_EVENT = 'advanced-habit-timer:api-request';
export const DASHBOARD_API_READY_EVENT = 'advanced-habit-timer:api-ready';
export const DASHBOARD_API_UNAVAILABLE_EVENT = 'advanced-habit-timer:api-unavailable';

export type DashboardDomain = 'timer' | 'habits' | 'projects' | 'library' | 'stats' | 'settings';

export type HabitCapability =
    | 'timer.read'
    | 'timer.control'
    | 'habits.read'
    | 'habits.update'
    | 'projects.read'
    | 'projects.update'
    | 'library.read'
    | 'library.update'
    | 'stats.read';

export type DashboardErrorCode =
    | 'NOT_READY'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'VALIDATION'
    | 'UNSUPPORTED'
    | 'INTERNAL';

export interface DashboardApiError {
    code: DashboardErrorCode;
    message: string;
    recoverable: boolean;
}

export type ApiResult<T> =
    | { ok: true; data: T; revision: number }
    | { ok: false; error: DashboardApiError; revision: number };

export interface DashboardSnapshotQuery {
    domains?: DashboardDomain[];
    date?: string;
    includeHabitStreaks?: boolean;
    projectScopeIds?: string[];
    includeCompletedTasks?: boolean;
    taskLimit?: number;
    mediaCollectionIds?: string[];
    mediaStatuses?: string[];
    mediaLimit?: number;
    habitIds?: string[];
    habitHistoryDays?: number;
    statsRangeDays?: number;
}

export interface ActiveTimerDto {
    habitId: string;
    habitName: string;
    mode: 'timer' | 'pm';
    state: 'running' | 'paused';
    startedAt: string;
    elapsedSeconds: number;
    remainingSeconds?: number;
    lastStartedAt?: number;
    targetSeconds?: number;
    taskName?: string;
    taskId?: string;
    mediaPath?: string;
    mediaTitle?: string;
    subTask?: string;
}

export interface HabitDto {
    id: string;
    name: string;
    type: 'timer' | 'binary' | 'negative' | 'count';
    value: number;
    minimum: number;
    desired: number;
    goalMode: 'daily' | 'weekly';
    state: 'completed' | 'partial' | 'skipped' | 'excused' | 'deferred' | 'pending' | 'missed';
    streak?: number;
}

export interface HabitHistoryDayDto {
    date: string;
    value: number;
    minimum: number;
    desired: number;
    state: HabitDto['state'];
}

export interface HabitHistoryDto {
    habitId: string;
    habitName: string;
    days: HabitHistoryDayDto[];
    currentStreak: number;
    bestStreak: number;
    completionRate: number;
    average: number;
    total: number;
}

export interface DashboardStatsDto {
    rangeDays: number;
    trackedHabits: number;
    completedHabitDays: number;
    scoredHabitDays: number;
    habitCompletionRate: number;
    totalTimerSeconds: number;
    activeTasks: number;
    completedTasks: number;
    activeMedia: number;
    completedMedia: number;
}

export interface ProjectScopeDto {
    id: string;
    name: string;
    color?: string;
    statuses: string[];
}

export interface ProjectTaskDto {
    id: string;
    scopeId: string;
    filePath: string;
    name: string;
    status: string;
    timeSpentSeconds: number;
    timeEstimatedSeconds?: number;
    habitId?: string;
    habitName?: string;
    startDate?: string;
    endDate?: string;
    cover?: string;
    color?: string;
    tags?: string;
    priority?: string;
    order?: number;
    sourceLine?: number;
    blockId?: string;
    subtasks: Array<{ line: number; text: string; checked: boolean }>;
}

export interface MediaItemDto {
    path: string;
    title: string;
    collectionId: string;
    status: string;
    cover?: string;
    progress: number;
    total: number;
    rating?: string;
    author?: string;
    series?: string;
    genre?: string;
    unit?: string;
    startDate?: string;
    endDate?: string;
    queueOrder?: number;
    targetDate?: string;
    linkedHabitId?: string;
}

export interface DashboardSnapshot {
    apiVersion: typeof DASHBOARD_API_VERSION;
    generatedAt: number;
    revision: number;
    locale: 'ru' | 'en';
    capabilities: HabitCapability[];
    timer?: ActiveTimerDto | null;
    habits?: HabitDto[];
    habitHistory?: HabitHistoryDto[];
    projectScopes?: ProjectScopeDto[];
    tasks?: ProjectTaskDto[];
    media?: MediaItemDto[];
    stats?: DashboardStatsDto;
}

export interface DashboardChangedEvent {
    revision: number;
    domains: DashboardDomain[];
    timestamp: number;
}

export type HabitQuickAction = 'toggle' | 'increment' | 'relapse';

export interface FinishTimerInput {
    note?: string;
    progressAdded?: number;
}

export type DashboardCommand =
    | { type: 'timer.start'; habitId: string; mode?: 'timer' | 'pm'; taskId?: string; mediaPath?: string }
    | { type: 'timer.pause' }
    | { type: 'timer.resume' }
    | { type: 'timer.prepareFinish' }
    | { type: 'timer.finish'; input: FinishTimerInput }
    | { type: 'timer.cancel' }
    | { type: 'habit.applyAction'; habitId: string; action: HabitQuickAction; date?: string }
    | { type: 'task.updateStatus'; scopeId: string; taskId: string; status: string }
    | { type: 'task.toggleSubtask'; scopeId: string; taskId: string; line: number; checked: boolean }
    | { type: 'task.open'; scopeId: string; taskId: string }
    | { type: 'media.open'; path: string }
    | { type: 'media.addProgress'; path: string; amount: number; note?: string }
    | { type: 'media.startTimer'; path: string };

export interface FinishTimerRequirements {
    elapsedSeconds: number;
    mediaPath?: string;
    mediaTitle?: string;
    currentProgress?: number;
    total?: number;
    unit?: string;
    suggestedProgress?: number;
}

export interface CommandResult {
    changedDomains: DashboardDomain[];
    finishRequirements?: FinishTimerRequirements;
}

export interface HabitTimerDashboardApiV1 {
    readonly apiVersion: typeof DASHBOARD_API_VERSION;
    readonly capabilities: readonly HabitCapability[];

    getSnapshot(query?: DashboardSnapshotQuery): Promise<ApiResult<DashboardSnapshot>>;
    subscribe(listener: (event: DashboardChangedEvent) => void): () => void;
    execute(command: DashboardCommand): Promise<ApiResult<CommandResult>>;
}

export type DashboardApiReceiver = (api: HabitTimerDashboardApiV1) => void;
