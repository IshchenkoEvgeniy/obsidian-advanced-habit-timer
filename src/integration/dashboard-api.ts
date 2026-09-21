import { TFile, moment, type EventRef } from 'obsidian';
import { get } from 'svelte/store';
import type HabitTimerPlugin from '../main';
import { projectTaskToData } from '../projects/task-data';
import type { ProjectScopeDefinition, ProjectTask } from '../projects/types';
import { habitId } from './habit-id';
import { buildDashboardSnapshot, DASHBOARD_API_CAPABILITIES } from './dashboard-snapshot';
import {
    DASHBOARD_API_REQUEST_EVENT,
    DASHBOARD_API_READY_EVENT,
    DASHBOARD_API_UNAVAILABLE_EVENT,
    DASHBOARD_API_VERSION,
    type ApiResult,
    type CommandResult,
    type DashboardApiReceiver,
    type DashboardChangedEvent,
    type DashboardCommand,
    type DashboardDomain,
    type DashboardSnapshot,
    type DashboardSnapshotQuery,
    type HabitTimerDashboardApiV1
} from './dashboard-api-contract';

interface WorkspaceEventBus {
    on(name: string, callback: (...args: unknown[]) => unknown): EventRef;
    trigger(name: string, ...data: unknown[]): void;
}

interface LocatedTask {
    scope: ProjectScopeDefinition;
    task: ProjectTask;
}

const ALL_DOMAINS: DashboardDomain[] = ['timer', 'habits', 'projects', 'library', 'stats', 'settings'];

function errorResult<T>(
    revision: number,
    code: 'NOT_READY' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'UNSUPPORTED' | 'INTERNAL',
    message: string,
    recoverable = true
): ApiResult<T> {
    return { ok: false, error: { code, message, recoverable }, revision };
}

export class DashboardApiBridge {
    private revision = 1;
    private listeners = new Set<(event: DashboardChangedEvent) => void>();
    private pendingDomains = new Set<DashboardDomain>();
    private snapshotCache = new Map<string, Promise<DashboardSnapshot>>();
    private flushTimer: number | null = null;
    private stopped = false;
    private readonly eventBus: WorkspaceEventBus;

    readonly api: HabitTimerDashboardApiV1;

    constructor(private plugin: HabitTimerPlugin) {
        this.eventBus = plugin.app.workspace as unknown as WorkspaceEventBus;
        this.api = Object.freeze({
            apiVersion: DASHBOARD_API_VERSION,
            capabilities: Object.freeze([...DASHBOARD_API_CAPABILITIES]),
            getSnapshot: (query?: DashboardSnapshotQuery) => this.getSnapshot(query),
            subscribe: (listener: (event: DashboardChangedEvent) => void) => this.subscribe(listener),
            execute: (command: DashboardCommand) => this.execute(command)
        });
    }

    start(): void {
        this.stopped = false;
        this.plugin.registerEvent(this.eventBus.on(DASHBOARD_API_REQUEST_EVENT, (...args: unknown[]) => {
            const receiver = args[0] as DashboardApiReceiver | undefined;
            if (typeof receiver === 'function') receiver(this.api);
        }));

        this.plugin.registerEvent(this.plugin.app.metadataCache.on('changed', () => {
            this.emitChanged(['habits', 'projects', 'library', 'stats']);
        }));
        this.plugin.registerEvent(this.plugin.app.vault.on('create', () => {
            this.emitChanged(['habits', 'projects', 'library', 'stats']);
        }));
        this.plugin.registerEvent(this.plugin.app.vault.on('delete', () => {
            this.emitChanged(['habits', 'projects', 'library', 'stats']);
        }));
        this.plugin.registerEvent(this.plugin.app.vault.on('rename', () => {
            this.emitChanged(['habits', 'projects', 'library', 'stats']);
        }));

        this.eventBus.trigger(DASHBOARD_API_READY_EVENT, this.api);
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
        this.flushTimer = null;
        this.pendingDomains.clear();
        this.snapshotCache.clear();
        this.listeners.clear();
        this.eventBus.trigger(DASHBOARD_API_UNAVAILABLE_EVENT, DASHBOARD_API_VERSION);
    }

    emitChanged(domains: DashboardDomain[] = ALL_DOMAINS): void {
        if (this.stopped) return;
        this.snapshotCache.clear();
        domains.forEach(domain => this.pendingDomains.add(domain));
        if (this.flushTimer !== null) window.clearTimeout(this.flushTimer);
        this.flushTimer = window.setTimeout(() => this.flushChanged(), 150);
    }

    private flushChanged(): void {
        this.flushTimer = null;
        if (!this.pendingDomains.size || this.stopped) return;
        const event: DashboardChangedEvent = {
            revision: ++this.revision,
            domains: [...this.pendingDomains],
            timestamp: Date.now()
        };
        this.pendingDomains.clear();
        this.listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.error('Habit Timer dashboard API listener failed:', error);
            }
        });
    }

    private subscribe(listener: (event: DashboardChangedEvent) => void): () => void {
        if (this.stopped) return () => undefined;
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private async getSnapshot(query?: DashboardSnapshotQuery): Promise<ApiResult<DashboardSnapshot>> {
        if (this.stopped) return errorResult(this.revision, 'NOT_READY', 'Habit Timer dashboard API is unavailable.');
        try {
            const cacheKey = JSON.stringify(query || {});
            let pending = this.snapshotCache.get(cacheKey);
            if (!pending) {
                pending = buildDashboardSnapshot(this.plugin, query, this.revision);
                this.snapshotCache.set(cacheKey, pending);
            }
            const snapshot = await pending;
            return { ok: true, data: snapshot, revision: this.revision };
        } catch (error) {
            this.snapshotCache.delete(JSON.stringify(query || {}));
            console.error('Habit Timer dashboard snapshot failed:', error);
            return errorResult(this.revision, 'INTERNAL', 'Could not build the dashboard snapshot.');
        }
    }

    private async locateTask(scopeId: string | undefined, taskId: string): Promise<LocatedTask | null> {
        const scopes = scopeId
            ? this.plugin.settings.projectScopes.filter(scope => scope.id === scopeId)
            : this.plugin.settings.projectScopes;
        for (const scope of scopes) {
            const task = (await this.plugin.projectEngine.loadTasks(scope)).find(value => value.id === taskId);
            if (task) return { scope, task };
        }
        return null;
    }

    private async execute(command: DashboardCommand): Promise<ApiResult<CommandResult>> {
        if (this.stopped) return errorResult(this.revision, 'NOT_READY', 'Habit Timer dashboard API is unavailable.');

        try {
            const result = await this.executeCommand(command);
            if (!result.ok) return result;
            this.emitChanged(result.data.changedDomains);
            return result;
        } catch (error) {
            console.error(`Habit Timer dashboard command ${command.type} failed:`, error);
            return errorResult(this.revision, 'INTERNAL', `Command ${command.type} failed.`);
        }
    }

    private async executeCommand(command: DashboardCommand): Promise<ApiResult<CommandResult>> {
        switch (command.type) {
            case 'timer.start': {
                const property = this.plugin.settings.properties.find(value => habitId(value) === command.habitId);
                if (!property) return errorResult(this.revision, 'NOT_FOUND', 'Habit not found.');

                let started = false;
                if (command.mediaPath) {
                    const item = get(this.plugin.stateManager.mediaItems).find(value => value.file.path === command.mediaPath);
                    if (!item) return errorResult(this.revision, 'NOT_FOUND', 'Media item not found.');
                    started = await this.plugin.startTimerForHabit(property.name, {
                        bookPath: item.file.path,
                        mode: command.mode,
                        openView: false
                    });
                } else if (command.taskId) {
                    const located = await this.locateTask(undefined, command.taskId);
                    if (!located) return errorResult(this.revision, 'NOT_FOUND', 'Project task not found.');
                    started = await this.plugin.startTimerForHabit(property.name, {
                        taskFile: located.task.file,
                        taskName: located.task.name,
                        isSingleFileTask: located.scope.sourceType === 'file',
                        mode: command.mode,
                        openView: false
                    });
                } else {
                    started = await this.plugin.startTimerForHabit(property.name, { mode: command.mode, openView: false });
                }
                if (!started) return errorResult(this.revision, 'CONFLICT', 'Another timer is already active.');
                return { ok: true, data: { changedDomains: ['timer'] }, revision: this.revision };
            }
            case 'timer.pause': {
                const changed = await this.plugin.pauseTimerSession();
                if (!changed) return errorResult(this.revision, 'NOT_FOUND', 'Active timer not found.');
                return { ok: true, data: { changedDomains: ['timer'] }, revision: this.revision };
            }
            case 'timer.resume': {
                const changed = await this.plugin.resumeTimerSession();
                if (!changed) return errorResult(this.revision, 'NOT_FOUND', 'Active timer not found.');
                return { ok: true, data: { changedDomains: ['timer'] }, revision: this.revision };
            }
            case 'timer.prepareFinish': {
                const requirements = await this.plugin.prepareFinishTimerSession();
                if (!requirements) return errorResult(this.revision, 'NOT_FOUND', 'Active timer not found.');
                return {
                    ok: true,
                    data: { changedDomains: [], finishRequirements: requirements },
                    revision: this.revision
                };
            }
            case 'timer.finish': {
                const changed = await this.plugin.finishTimerSession(command.input);
                if (!changed) return errorResult(this.revision, 'VALIDATION', 'Timer has no elapsed time to save.');
                return {
                    ok: true,
                    data: { changedDomains: ['timer', 'habits', 'projects', 'library', 'stats'] },
                    revision: this.revision
                };
            }
            case 'timer.cancel': {
                const changed = await this.plugin.cancelTimerSession();
                if (!changed) return errorResult(this.revision, 'NOT_FOUND', 'Active timer not found.');
                return { ok: true, data: { changedDomains: ['timer'] }, revision: this.revision };
            }
            case 'habit.applyAction': {
                const property = this.plugin.settings.properties.find(value => habitId(value) === command.habitId);
                if (!property) return errorResult(this.revision, 'NOT_FOUND', 'Habit not found.');
                const date = command.date || moment().format('YYYY-MM-DD');
                if (command.action === 'toggle') await this.plugin.toggleBinaryHabit(property.name, date);
                else if (command.action === 'increment') await this.plugin.updateCountHabit(property.name, 1, date);
                else await this.plugin.logRelapse(property.name, date);
                return { ok: true, data: { changedDomains: ['habits', 'stats'] }, revision: this.revision };
            }
            case 'task.updateStatus': {
                const located = await this.locateTask(command.scopeId, command.taskId);
                if (!located) return errorResult(this.revision, 'NOT_FOUND', 'Project task not found.');
                const columns = located.scope.statuses.split(',').map(status => status.trim()).filter(Boolean);
                if (!columns.includes(command.status)) {
                    return errorResult(this.revision, 'VALIDATION', 'Status is not configured for this project scope.');
                }
                await this.plugin.projectEngine.saveTask(
                    located.task.file,
                    projectTaskToData(located.task, seconds => this.plugin.formatTime(seconds), { status: command.status }),
                    located.scope.sourceType === 'file',
                    located.task.name,
                    columns,
                    located.task.blockId
                );
                return { ok: true, data: { changedDomains: ['projects'] }, revision: this.revision };
            }
            case 'task.toggleSubtask': {
                const located = await this.locateTask(command.scopeId, command.taskId);
                if (!located) return errorResult(this.revision, 'NOT_FOUND', 'Project task not found.');
                await this.plugin.projectEngine.toggleSubtask(located.task.file, command.line, command.checked);
                return { ok: true, data: { changedDomains: ['projects'] }, revision: this.revision };
            }
            case 'task.open': {
                const located = await this.locateTask(command.scopeId, command.taskId);
                if (!located) return errorResult(this.revision, 'NOT_FOUND', 'Project task not found.');
                await this.plugin.app.workspace.getLeaf(false).openFile(located.task.file);
                return { ok: true, data: { changedDomains: [] }, revision: this.revision };
            }
            case 'media.open': {
                const file = this.plugin.app.vault.getAbstractFileByPath(command.path);
                if (!(file instanceof TFile)) return errorResult(this.revision, 'NOT_FOUND', 'Media file not found.');
                await this.plugin.app.workspace.getLeaf(false).openFile(file);
                return { ok: true, data: { changedDomains: [] }, revision: this.revision };
            }
            case 'media.startTimer': {
                const item = get(this.plugin.stateManager.mediaItems).find(value => value.file.path === command.path);
                if (!item) return errorResult(this.revision, 'NOT_FOUND', 'Media item not found.');
                const started = await this.plugin.startTimerForMedia(item, { openView: false });
                if (!started) return errorResult(this.revision, 'VALIDATION', 'Media item has no linked timer habit.');
                return { ok: true, data: { changedDomains: ['timer'] }, revision: this.revision };
            }
            case 'media.addProgress':
                return errorResult(
                    this.revision,
                    'UNSUPPORTED',
                    'Library writes are not available until the media session service is extracted.'
                );
        }
    }
}
