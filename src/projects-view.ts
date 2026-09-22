import { ButtonComponent, ItemView, Modal, Notice, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import HabitTimerPlugin from './main';
import { t } from './i18n';
import ProjectsApp from './components/projects/ProjectsApp.svelte';
import type { ProjectScopeDefinition, ProjectScopeStats, ProjectTask, TaskData } from './projects/types';
import { ProjectDataEngine } from './projects/project-data';
import { BoardView } from './projects/views/board-view';
import { isDone } from './utils/status';
import { projectTaskToData } from './projects/task-data';
import {
    activeScopeId as activeScopeIdStore,
    columns as columnsStore,
    scopesWithStats,
    selectedTasks as selectedTasksStore,
    tasks as tasksStore
} from './store/ProjectsStore';

export const VIEW_TYPE_PROJECTS = 'habit-projects-view';

export class ProjectsView extends ItemView {
    tasks: ProjectTask[] = [];
    columns: string[] = ['Backlog', 'To Do', 'In Progress', 'Done'];
    selectedTasks = new Set<string>();
    activeScopeId = '';

    readonly dataEngine: ProjectDataEngine;
    readonly boardSubView: BoardView;

    private component: ReturnType<typeof mount> | null = null;
    private loadTasksTimeout: ReturnType<typeof setTimeout> | null = null;
    private loadGeneration = 0;

    constructor(leaf: WorkspaceLeaf, public plugin: HabitTimerPlugin) {
        super(leaf);
        this.dataEngine = new ProjectDataEngine(this.app, plugin);
        this.boardSubView = new BoardView(this.app, plugin, this.dataEngine);
    }

    getViewType(): string { return VIEW_TYPE_PROJECTS; }
    getDisplayText(): string { return t(this.plugin.settings.language, 'projects_tab'); }
    getIcon(): string { return 'layout-dashboard'; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('habit-projects-root');
        container.setCssStyles({ height: '100%', overflow: 'hidden', padding: '0' });

        await this.loadTasks();
        this.component = mount(ProjectsApp, {
            target: container,
            props: { plugin: this.plugin, app: this.app, view: this }
        });

        this.registerEvent(this.app.metadataCache.on('changed', file => {
            this.dataEngine.invalidateCacheEntry(file.path);
            this.scheduleReload(500);
        }));
        this.registerEvent(this.app.vault.on('delete', file => {
            this.dataEngine.invalidateCacheEntry(file.path);
            this.scheduleReload(250);
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            this.dataEngine.invalidateCacheEntry(oldPath);
            this.dataEngine.invalidateCacheEntry(file.path);
            this.scheduleReload(250);
        }));
    }

    async onClose(): Promise<void> {
        this.loadGeneration++;
        if (this.loadTasksTimeout) clearTimeout(this.loadTasksTimeout);
        this.loadTasksTimeout = null;
        await this.boardSubView.destroy();
        if (this.component) await unmount(this.component);
        this.component = null;
    }

    private scheduleReload(delay: number): void {
        if (this.loadTasksTimeout) clearTimeout(this.loadTasksTimeout);
        this.loadTasksTimeout = setTimeout(() => {
            this.loadTasksTimeout = null;
            void this.loadTasks();
        }, delay);
    }

    async setActiveScope(scopeId: string): Promise<void> {
        if (scopeId === this.activeScopeId) return;
        this.activeScopeId = scopeId;
        this.clearSelection();
        activeScopeIdStore.set(scopeId);
        await this.loadTasks();
    }

    getActiveScope(): ProjectScopeDefinition | undefined {
        return this.plugin.settings.projectScopes?.find(scope => scope.id === this.activeScopeId);
    }

    async loadTasks(): Promise<void> {
        const generation = ++this.loadGeneration;
        const scopes = this.plugin.settings.projectScopes || [];
        if (!scopes.length) {
            this.tasks = [];
            this.syncStores([]);
            return;
        }

        if (!this.activeScopeId || !scopes.some(scope => scope.id === this.activeScopeId)) {
            this.activeScopeId = scopes[0]!.id;
        }
        const activeScope = this.getActiveScope();
        if (!activeScope) return;

        const configuredColumns = activeScope.statuses.split(',').map(status => status.trim()).filter(Boolean);
        this.columns = configuredColumns.length ? configuredColumns : ['Backlog', 'To Do', 'In Progress', 'Done'];
        const loadedTasks = await this.dataEngine.loadTasks(activeScope);
        if (generation !== this.loadGeneration || activeScope.id !== this.activeScopeId) return;

        this.tasks = loadedTasks;
        for (const status of new Set(loadedTasks.map(task => task.status))) {
            if (!this.columns.includes(status)) this.columns.push(status);
        }
        const liveIds = new Set(loadedTasks.map(task => task.id));
        this.selectedTasks = new Set([...this.selectedTasks].filter(id => liveIds.has(id)));
        const stats = await this.calculateScopeStats(scopes, activeScope, loadedTasks);
        if (generation !== this.loadGeneration || activeScope.id !== this.activeScopeId) return;
        this.syncStores(stats);
    }

    private syncStores(stats: ProjectScopeStats[]): void {
        tasksStore.set(this.tasks);
        columnsStore.set(this.columns);
        selectedTasksStore.set(new Set(this.selectedTasks));
        activeScopeIdStore.set(this.activeScopeId);
        scopesWithStats.set(stats);
    }

    private async calculateScopeStats(
        scopes: ProjectScopeDefinition[],
        activeScope: ProjectScopeDefinition,
        activeTasks: ProjectTask[]
    ): Promise<ProjectScopeStats[]> {
        const result = await Promise.all(scopes.map(async scope => {
            const scopeTasks = scope.id === activeScope.id ? activeTasks : await this.dataEngine.loadTasks(scope);
            const statuses = scope.statuses.split(',').map(status => status.trim()).filter(Boolean);
            const doneStatus = statuses[statuses.length - 1] || 'Done';
            const done = scopeTasks.filter(task => isDone(task.status) || task.status === doneStatus).length;
            return {
                id: scope.id,
                name: scope.name,
                color: scope.color,
                total: scopeTasks.length,
                done,
                pct: scopeTasks.length ? Math.round(done / scopeTasks.length * 100) : 0
            };
        }));
        return result;
    }

    private selectedList(): ProjectTask[] {
        return this.tasks.filter(task => this.selectedTasks.has(task.id));
    }

    private taskData(task: ProjectTask, status = task.status): TaskData {
        return projectTaskToData(task, seconds => this.plugin.formatTime(seconds), { status });
    }

    async changeSelectedStatus(status: string): Promise<void> {
        const scope = this.getActiveScope();
        if (!scope) return;
        const selected = this.selectedList();
        for (const task of selected) {
            await this.dataEngine.saveTask(
                task.file, this.taskData(task, status), scope.sourceType === 'file',
                task.name, this.columns, task.blockId
            );
        }
        this.clearSelection();
        await this.loadTasks();
    }

    async duplicateSelected(): Promise<void> {
        const scope = this.getActiveScope();
        if (!scope) return;
        for (const task of this.selectedList()) {
            if (scope.sourceType === 'file') {
                await this.dataEngine.createTask(scope, { ...this.taskData(task), name: `${task.name} (copy)` });
                continue;
            }
            const content = await this.app.vault.read(task.file);
            const parentPath = task.file.parent?.path;
            const targetPath = parentPath ? `${parentPath}/${task.name} (copy).md` : `${task.name} (copy).md`;
            if (!this.app.vault.getAbstractFileByPath(targetPath)) await this.app.vault.create(targetPath, content);
        }
        this.clearSelection();
        await this.loadTasks();
    }

    async exportSelected(): Promise<void> {
        const rows = this.selectedList().map(task =>
            `| ${task.name.replace(/\|/g, '\\|')} | ${task.status} | ${task.habitName || '-'} | ${this.plugin.formatTime(task.timeSpentSec)} |`
        );
        const markdown = ['| Task | Status | Habit | Time |', '| --- | --- | --- | --- |', ...rows].join('\n');
        await navigator.clipboard.writeText(markdown);
        new Notice(t(this.plugin.settings.language, 'copied_to_clipboard'));
    }

    async deleteSelected(): Promise<void> {
        const scope = this.getActiveScope();
        const selected = this.selectedList();
        if (!scope || !selected.length) return;
        const confirmed = await this.confirmModal(
            this.plugin.settings.language === 'ru'
                ? `Удалить выбранные задачи (${selected.length})?`
                : `Delete selected tasks (${selected.length})?`
        );
        if (!confirmed) return;
        for (const task of selected) await this.dataEngine.deleteTask(task, scope.sourceType === 'file');
        this.clearSelection();
        await this.loadTasks();
    }

    clearSelection(): void {
        this.selectedTasks.clear();
        selectedTasksStore.set(new Set());
    }

    confirmModal(message: string): Promise<boolean> {
        return new Promise(resolve => {
            const modal = new Modal(this.app);
            let settled = false;
            const finish = (value: boolean): void => {
                if (settled) return;
                settled = true;
                resolve(value);
                modal.close();
            };
            modal.contentEl.createEl('p', { text: message });
            const row = modal.contentEl.createDiv('modal-button-container');
            new ButtonComponent(row).setButtonText('Cancel').onClick(() => finish(false));
            new ButtonComponent(row).setButtonText('Delete').setWarning().onClick(() => finish(true));
            modal.onClose = () => {
                if (settled) return;
                settled = true;
                resolve(false);
            };
            modal.open();
        });
    }
}
