import { ButtonComponent, ItemView, Modal, Notice, WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import HabitTimerPlugin from './main';
import { t } from './i18n';
import ProjectsApp from './components/projects/ProjectsApp.svelte';
import type { ProjectScopeDefinition, ProjectScopeStats, ProjectTask, TaskData } from './projects/types';
import { ProjectDataEngine } from './projects/project-data';
import { taskDisplayTitle } from './projects/engine/task-identity';
import { BoardView } from './projects/views/board-view';
import { isDone } from './utils/status';
import { projectTaskToData } from './projects/task-data';
import { GitHubProjectsClient, parseGitHubProjectUrl, parseGitHubRepositoryUrl, type GitHubProjectSnapshot } from './projects/github-client';
import { checklistChecks, checklistGroups, checklistMarker, remoteChecklistChecks, renderChecklistBody, replaceManagedChecklist } from './projects/checklist-sync';
import { nativeChecklistMarker, nativeChecklistNodes } from './projects/native-checklist';
import { localStatusForRemote, localValues, planGitHubSync, remoteOptionForLocal, remoteValues, syncPlanSummary, type SyncedField } from './projects/github-sync';
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
    archivedTasks: ProjectTask[] = [];
    columns: string[] = ['Backlog', 'To Do', 'In Progress', 'Done'];
    selectedTasks = new Set<string>();
    activeScopeId = '';

    readonly dataEngine: ProjectDataEngine;
    readonly boardSubView: BoardView;

    private component: ReturnType<typeof mount> | null = null;
    private loadTasksTimeout: ReturnType<typeof setTimeout> | null = null;
    private loadGeneration = 0;
    private githubToken = '';
    private githubSyncing = false;

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
            let settingsChanged = false;
            for (const scope of this.plugin.settings.projectScopes || []) {
                if (scope.sourceType === 'file' && scope.sourceValue === oldPath) {
                    scope.sourceValue = file.path;
                    settingsChanged = true;
                }
                if (!scope.githubBindings) continue;
                for (const [taskId, binding] of Object.entries(scope.githubBindings)) {
                    const prefix = ['virtual', 'block', 'file', 'line'].find(kind => taskId.startsWith(`${kind}:${oldPath}${kind === 'file' ? '' : ':'}`));
                    if (!prefix) continue;
                    const newId = taskId.replace(`${prefix}:${oldPath}`, `${prefix}:${file.path}`);
                    delete scope.githubBindings[taskId];
                    scope.githubBindings[newId] = binding;
                    settingsChanged = true;
                }
            }
            if (settingsChanged) void this.plugin.saveSettings();
            this.dataEngine.invalidateCacheEntry(oldPath);
            this.dataEngine.invalidateCacheEntry(file.path);
            this.scheduleReload(250);
        }));
    }

    async onClose(): Promise<void> {
        this.githubToken = '';
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
            this.archivedTasks = [];
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

        this.tasks = loadedTasks.filter(task => !task.archived);
        this.archivedTasks = loadedTasks.filter(task => task.archived);
        for (const status of new Set(this.tasks.map(task => task.status))) {
            if (!this.columns.includes(status)) this.columns.push(status);
        }
        const liveIds = new Set(this.tasks.map(task => task.id));
        this.selectedTasks = new Set([...this.selectedTasks].filter(id => liveIds.has(id)));
        const stats = await this.calculateScopeStats(scopes, activeScope, this.tasks);
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
            const scopeTasks = scope.id === activeScope.id ? activeTasks : (await this.dataEngine.loadTasks(scope)).filter(task => !task.archived);
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

    async archiveSelected(): Promise<void> {
        const scope = this.getActiveScope();
        if (!scope) return;
        for (const task of this.selectedList()) await this.dataEngine.setArchived(task, true, scope.sourceType === 'file');
        this.clearSelection();
        await this.loadTasks();
    }

    private promptGitHubConnection(scope: ProjectScopeDefinition): Promise<{ url: string; token: string; repositoryUrl: string } | null> {
        return new Promise(resolve => {
            const ru = this.plugin.settings.language === 'ru';
            const modal = new Modal(this.app);
            let settled = false;
            const finish = (value: { url: string; token: string; repositoryUrl: string } | null): void => {
                if (settled) return;
                settled = true;
                resolve(value);
                modal.close();
            };
            modal.setTitle('GitHub Projects');
            modal.contentEl.createEl('p', { text: ru ? 'Адрес GitHub Project' : 'Project URL' });
            const urlInput = modal.contentEl.createEl('input', { type: 'url', value: scope.githubProjectUrl || 'https://github.com/users/IshchenkoEvgeniy/projects/2' });
            urlInput.style.width = '100%';
            modal.contentEl.createEl('p', { text: ru
                ? 'Classic PAT: scope project; для создания Issues также repo или public_repo. Токен хранится только в памяти окна.'
                : 'Classic PAT: project scope; creating Issues also needs repo or public_repo. The token stays in view memory.' });
            const tokenInput = modal.contentEl.createEl('input', { type: 'password', value: this.githubToken });
            tokenInput.style.width = '100%';
            modal.contentEl.createEl('p', { text: ru
                ? 'Для этапов и настоящих Sub-issues укажите репозиторий игры. Без него структурированный чеклист не будет отправлен в GitHub. Не указывайте репозиторий Obsidian-плагина.'
                : 'Enter the game repository for stages and native Sub-issues. A structured checklist cannot sync without it. Do not enter the Obsidian plugin repository.' });
            const repositoryInput = modal.contentEl.createEl('input', {
                type: 'url', value: scope.githubIssuesRepositoryUrl || '',
                placeholder: 'https://github.com/OWNER/GAME-REPOSITORY'
            });
            repositoryInput.style.width = '100%';
            const row = modal.contentEl.createDiv('modal-button-container');
            new ButtonComponent(row).setButtonText(ru ? 'Отмена' : 'Cancel').onClick(() => finish(null));
            new ButtonComponent(row).setButtonText(ru ? 'Загрузить проект' : 'Load project').setCta().onClick(() => {
                try {
                    parseGitHubProjectUrl(urlInput.value);
                    if (!tokenInput.value.trim()) throw new Error('Enter a GitHub token.');
                    const repositoryUrl = repositoryInput.value.trim();
                    if (repositoryUrl) {
                        const repository = parseGitHubRepositoryUrl(repositoryUrl);
                        if (repository.owner.toLowerCase() === 'ishchenkoevgeniy' &&
                            repository.name.toLowerCase() === 'obsidian-advanced-habit-timer') {
                            throw new Error(ru ? 'Это репозиторий плагина. Укажите репозиторий игры.' : 'This is the plugin repository. Enter the game repository.');
                        }
                    }
                    finish({ url: urlInput.value.trim(), token: tokenInput.value.trim(), repositoryUrl });
                } catch (error) { new Notice(String(error)); }
            });
            modal.onClose = () => finish(null);
            modal.open();
        });
    }

    private confirmGitHubSync(title: string, summary: ReturnType<typeof syncPlanSummary>, conflicts: string[]): Promise<boolean> {
        return new Promise(resolve => {
            const ru = this.plugin.settings.language === 'ru';
            const modal = new Modal(this.app);
            let settled = false;
            const finish = (value: boolean): void => {
                if (settled) return;
                settled = true;
                resolve(value);
                modal.close();
            };
            modal.setTitle(`Sync: ${title}`);
            modal.contentEl.createEl('p', { text: ru
                ? `В GitHub: ${summary.push} · В Obsidian: ${summary.pull} · Связать: ${summary.link} · Конфликты: ${summary.conflicts}`
                : `Push: ${summary.push} · Pull: ${summary.pull} · Link: ${summary.link} · Conflicts: ${summary.conflicts}` });
            modal.contentEl.createEl('p', { text: ru
                ? 'Конфликтующие поля и отсутствующие связанные строки пропускаются. Удаление между системами не передаётся.'
                : 'Conflicting fields and missing linked items are skipped. Deletions are never propagated.' });
            if (conflicts.length) {
                const list = modal.contentEl.createEl('ul');
                for (const message of conflicts.slice(0, 8)) list.createEl('li', { text: message });
                if (conflicts.length > 8) list.createEl('li', { text: `…and ${conflicts.length - 8} more` });
            }
            const row = modal.contentEl.createDiv('modal-button-container');
            new ButtonComponent(row).setButtonText(ru ? 'Отмена' : 'Cancel').onClick(() => finish(false));
            new ButtonComponent(row).setButtonText(ru ? 'Применить синхронизацию' : 'Apply sync').setCta().onClick(() => finish(true));
            modal.onClose = () => finish(false);
            modal.open();
        });
    }

    async syncGitHub(): Promise<void> {
        if (this.githubSyncing) {
            new Notice('GitHub synchronization is already running.');
            return;
        }
        const scope = this.getActiveScope();
        if (!scope) return;
        if (!['file', 'folder'].includes(scope.sourceType)) {
            new Notice('GitHub sync currently needs a file or folder project source.');
            return;
        }
        const connection = await this.promptGitHubConnection(scope);
        if (!connection) return;
        if (scope.githubProjectUrl && scope.githubProjectUrl.replace(/\/$/, '') !== connection.url.replace(/\/$/, '') &&
            Object.keys(scope.githubBindings || {}).length) {
            new Notice('This Obsidian project already has GitHub item links. Create a separate project for another GitHub URL.', 10000);
            return;
        }
        this.githubToken = connection.token;
        const client = new GitHubProjectsClient(connection.token);
        this.githubSyncing = true;
        try {
            new Notice('Loading GitHub Project…');
            const snapshot = await client.loadProject(connection.url);
            const sourceTasks = await this.dataEngine.loadTasks(scope);
            if (scope.sourceType === 'file' && checklistGroups(sourceTasks).length) {
                if (connection.repositoryUrl) await this.syncNativeChecklist(scope, connection.url, connection.repositoryUrl,
                    client, snapshot, sourceTasks);
                else new Notice(this.plugin.settings.language === 'ru'
                    ? 'Для синхронизации этапов и подзадач укажите репозиторий игры в окне GitHub Sync.'
                    : 'Enter the game repository in GitHub Sync to synchronize stages and sub-issues.', 10000);
                return;
            }
            const plan = planGitHubSync(scope, sourceTasks, snapshot);
            const summary = syncPlanSummary(plan);
            const statusOption = (status: string): string | undefined =>
                remoteOptionForLocal(status, plan.statusField?.options || []);
            const unmappedStatuses = [...new Set([
                ...plan.createRemote.map(task => task.status),
                ...plan.pairs.filter(pair => pair.push.includes('status')).map(pair => pair.task.status)
            ].filter(status => status && !statusOption(status)))];
            summary.conflicts += unmappedStatuses.length;
            const conflicts = [
                ...plan.pairs.filter(pair => pair.conflict.length || pair.conflictFields.length)
                    .map(pair => `${pair.task.name}: ${[...pair.conflict, ...pair.conflictFields].join(', ')}`),
                ...plan.missingLocal.map(item => `Missing local task: ${item.title}`),
                ...plan.missingRemote.map(task => `Missing GitHub item: ${task.name}`),
                ...plan.ambiguous,
                ...unmappedStatuses.map(status => `No matching GitHub Status option: ${status}`)
            ];
            if (!(await this.confirmGitHubSync(snapshot.title, summary, conflicts))) return;
            scope.githubProjectUrl = connection.url;
            scope.githubFields = snapshot.fields;
            scope.githubBindings ||= {};
            await this.plugin.saveSettings();
            const itemMeta = (item: typeof snapshot.items[number]) => ({
                url: item.url, contentType: item.contentType, fields: item.fields,
                assignees: item.assignees, subIssues: item.subIssues
            });
            const initialFields = (task: ProjectTask): { field: typeof snapshot.fields[number]; value: string }[] => {
                const result: { field: typeof snapshot.fields[number]; value: string }[] = [];
                for (const field of snapshot.fields) {
                    const key = field.name.toLowerCase().replace(/[\s_-]+/g, '');
                    const value = field.type === 'DATE' && key === 'startdate' ? task.startDate
                        : field.type === 'DATE' && (key === 'targetdate' || key === 'duedate') ? task.endDate
                        : field.type === 'SINGLE_SELECT' && key === 'priority' && task.priority
                            ? field.options?.find(option => option.name.toLowerCase() === task.priority!.toLowerCase())?.name
                            : undefined;
                    if (value) result.push({ field, value });
                }
                return result;
            };
            let changed = 0;
            const warnings: string[] = [];
            const report = (): void => { if (changed && changed % 25 === 0) new Notice(`GitHub sync: ${changed} changes applied…`); };

            for (const pair of plan.pairs) {
                const oldBinding = scope.githubBindings![pair.task.id];
                const localFields = { ...(oldBinding?.localFields || oldBinding?.meta?.fields || pair.item.fields) };
                const baseFields = { ...(oldBinding?.baseFields || oldBinding?.meta?.fields || pair.item.fields) };
                const current = localValues(pair.task);
                const remote = remoteValues(pair.item, scope,
                    pair.newlyLinked ? pair.task.status : scope.githubBindings![pair.task.id]?.base.status);
                const target = { ...current };
                for (const field of pair.pull) target[field] = remote[field] as never;
                const localStatus = pair.pull.includes('status') || pair.pull.includes('name');
                if (pair.pull.includes('archived')) {
                    await this.dataEngine.setArchived(pair.task, target.archived, scope.sourceType === 'file');
                    changed++; report();
                }
                if (localStatus) {
                    await this.dataEngine.saveTask(pair.task.file, {
                        ...this.taskData(pair.task, target.status), name: target.name
                    }, scope.sourceType === 'file', pair.task.name, this.columns, pair.task.blockId);
                    changed++; report();
                }
                for (const field of pair.push) {
                    if (field === 'name') await client.updateTitle(pair.item, current.name);
                    else if (field === 'status') {
                        const option = statusOption(current.status);
                        if (!option || !plan.statusField) { warnings.push(`No GitHub Status option for: ${current.status}`); continue; }
                        await client.updateStatus(snapshot.id, pair.item.id, plan.statusField.id, option);
                    } else await client.setArchived(snapshot.id, pair.item.id, current.archived);
                    changed++; report();
                }
                for (const name of pair.pullFields) {
                    const remoteValue = pair.item.fields[name];
                    if (remoteValue === undefined) delete localFields[name];
                    else localFields[name] = remoteValue;
                    changed++; report();
                }
                for (const name of pair.pushFields) {
                    const definition = snapshot.fields.find(field => field.name === name);
                    if (!definition) continue;
                    await client.updateCustomField(snapshot.id, pair.item.id, definition, localFields[name] ?? '');
                    changed++; report();
                }
                for (const field of snapshot.fields) {
                    if (pair.conflictFields.includes(field.name)) continue;
                    const value = localFields[field.name] ?? pair.item.fields[field.name];
                    if (value === undefined) delete baseFields[field.name];
                    else baseFields[field.name] = value;
                }
                const base = { ...(scope.githubBindings![pair.task.id]?.base || current) };
                for (const field of ['name', 'status', 'archived'] as SyncedField[]) {
                    if (pair.conflict.includes(field)) continue;
                    if (field === 'status' && pair.push.includes('status') && !statusOption(current.status)) continue;
                    if (field === 'status' && pair.newlyLinked && !pair.pull.includes('status') && !remote.status) {
                        base.status = '';
                    } else base[field] = target[field] as never;
                }
                let bindingKey = pair.task.id;
                if (pair.pull.length) {
                    const reloaded = await this.dataEngine.loadTasks(scope);
                    const candidates = reloaded.filter(task => task.file.path === pair.task.file.path &&
                        task.name === target.name && task.section === pair.task.section);
                    if (candidates.length === 1) bindingKey = candidates[0]!.id;
                    else if (candidates.length > 1 && pair.task.sourceLine !== undefined) {
                        candidates.sort((a, b) => Math.abs((a.sourceLine || 0) - pair.task.sourceLine!) - Math.abs((b.sourceLine || 0) - pair.task.sourceLine!));
                        if (Math.abs((candidates[0]!.sourceLine || 0) - pair.task.sourceLine) <
                            Math.abs((candidates[1]!.sourceLine || 0) - pair.task.sourceLine)) bindingKey = candidates[0]!.id;
                    }
                }
                if (bindingKey !== pair.task.id) delete scope.githubBindings![pair.task.id];
                scope.githubBindings![bindingKey] = { itemId: pair.item.id, base, localFields, baseFields, meta: itemMeta(pair.item) };
                await this.plugin.saveSettings();
            }

            for (const task of plan.createRemote) {
                const marker = `<!-- obsidian-project-task: ${scope.id}/${task.id} -->`;
                const body = `Imported from Obsidian project “${scope.name}”.\n\nSource: ${task.file.path}\n${marker}`;
                const itemId = await client.createDraft(snapshot.id, task.name, body);
                changed++; report();
                scope.githubBindings![task.id] = {
                    itemId, base: { name: task.name, status: '', archived: false },
                    localFields: {}, baseFields: {}, meta: { contentType: 'DraftIssue', fields: {} }
                };
                await this.plugin.saveSettings();
                const option = statusOption(task.status);
                if (option && plan.statusField) {
                    await client.updateStatus(snapshot.id, itemId, plan.statusField.id, option);
                    changed++; report();
                    scope.githubBindings![task.id]!.base.status = task.status;
                    await this.plugin.saveSettings();
                } else if (task.status) warnings.push(`No GitHub Status option for: ${task.status}`);
                if (task.archived) {
                    await client.setArchived(snapshot.id, itemId, true); changed++; report();
                    scope.githubBindings![task.id]!.base.archived = true;
                    await this.plugin.saveSettings();
                }
                for (const { field, value } of initialFields(task)) {
                    await client.updateCustomField(snapshot.id, itemId, field, value);
                    scope.githubBindings![task.id]!.localFields![field.name] = value;
                    scope.githubBindings![task.id]!.baseFields![field.name] = value;
                    changed++; report();
                    await this.plugin.saveSettings();
                }
            }

            const createdLocalItems = [] as typeof plan.createLocal;
            for (const item of plan.createLocal) {
                if (scope.sourceType === 'folder' && /[\\/:*?"<>|]/.test(item.title)) {
                    warnings.push(`Cannot use GitHub title as a file name: ${item.title}`);
                    continue;
                }
                const status = localStatusForRemote(scope, item.status) || this.columns[0] || 'Backlog';
                await this.dataEngine.createTask(scope, { name: item.title, status });
                createdLocalItems.push(item);
                changed++; report();
            }
            if (createdLocalItems.length) {
                const reloaded = await this.dataEngine.loadTasks(scope);
                for (const item of createdLocalItems) {
                    const candidates = reloaded.filter(task => task.name === item.title && !scope.githubBindings![task.id]);
                    if (candidates.length !== 1) { warnings.push(`Could not link imported task: ${item.title}`); continue; }
                    const task = candidates[0]!;
                    if (item.archived) await this.dataEngine.setArchived(task, true, scope.sourceType === 'file');
                    scope.githubBindings![task.id] = { itemId: item.id,
                        base: { name: item.title, status: item.status ? localStatusForRemote(scope, item.status) : '', archived: item.archived },
                        localFields: { ...item.fields }, baseFields: { ...item.fields }, meta: itemMeta(item) };
                    await this.plugin.saveSettings();
                }
            }
            await this.loadTasks();
            new Notice(`GitHub sync complete: ${changed} changes. ${conflicts.length} conflicts skipped. ${warnings.length} warnings.`);
            if (warnings.length) console.warn('GitHub sync warnings:', warnings);
        } catch (error) {
            console.error('GitHub sync failed:', error);
            new Notice(`GitHub sync stopped: ${error instanceof Error ? error.message : String(error)}`, 10000);
            await this.loadTasks();
        } finally {
            this.githubSyncing = false;
        }
    }

    private confirmStructuredChecklist(stages: number, groups: number, tasks: number, flatItems: number): Promise<boolean> {
        return new Promise(resolve => {
            const ru = this.plugin.settings.language === 'ru';
            const modal = new Modal(this.app);
            let settled = false;
            const finish = (answer: boolean): void => {
                if (settled) return;
                settled = true;
                resolve(answer);
                modal.close();
            };
            modal.setTitle(ru ? 'Синхронизация структуры чеклиста' : 'Sync checklist structure');
            modal.contentEl.createEl('p', { text: ru
                ? `${stages} этапов · ${groups} крупных задач · ${tasks} пунктов чеклиста.`
                : `${stages} stages · ${groups} parent tasks · ${tasks} checklist items.` });
            modal.contentEl.createEl('p', { text: ru
                ? 'В GitHub появится поле «Этап» и по одному draft item на крупную задачу. Внутри каждого будет Markdown-чеклист. Отметки пунктов синхронизируются в обе стороны.'
                : 'GitHub will get a Stage field and one draft item per parent task. Each item will contain a Markdown checklist. Checkbox states sync both ways.' });
            modal.contentEl.createEl('p', { text: ru
                ? 'Системная колонка GitHub «Sub-issues progress» работает только с Issues из репозитория и для draft items останется пустой.'
                : 'GitHub’s built-in Sub-issues progress column requires repository Issues and remains empty for draft items.' });
            if (flatItems) modal.contentEl.createEl('p', { text: ru
                ? `${flatItems} ранее созданных плоских draft items будут перемещены в архив проекта после создания структуры. Их можно восстановить.`
                : `${flatItems} previously created flat draft items will be archived after the structured items are created. They can be restored.` });
            const row = modal.contentEl.createDiv('modal-button-container');
            new ButtonComponent(row).setButtonText(ru ? 'Отмена' : 'Cancel').onClick(() => finish(false));
            new ButtonComponent(row).setButtonText(ru ? 'Применить' : 'Apply').setCta().onClick(() => finish(true));
            modal.onClose = () => finish(false);
            modal.open();
        });
    }

    private async syncStructuredChecklist(scope: ProjectScopeDefinition, url: string, client: GitHubProjectsClient,
        snapshot: GitHubProjectSnapshot, tasks: ProjectTask[]): Promise<void> {
        const groups = checklistGroups(tasks);
        const stages = [...new Set(groups.map(group => group.stage))];
        const structuredTaskIds = new Set(groups.flatMap(group => group.tasks.map(task => task.id)));
        const remoteById = new Map(snapshot.items.map(item => [item.id, item]));
        const flatItems = Object.entries(scope.githubBindings || {}).filter(([taskId, binding]) => {
            const item = remoteById.get(binding.itemId);
            return structuredTaskIds.has(taskId) && item?.contentType === 'DraftIssue' &&
                item.body.includes(`<!-- obsidian-project-task: ${scope.id}/${taskId} -->`);
        });
        if (!(await this.confirmStructuredChecklist(stages.length, groups.length, structuredTaskIds.size, flatItems.length))) return;

        let stageField = snapshot.fields.find(field => field.name === 'Этап' && field.type === 'SINGLE_SELECT');
        if (!stageField) stageField = await client.createStageField(snapshot.id, stages);
        else stageField = await client.ensureStageOptions(stageField, stages);
        scope.githubProjectUrl = url;
        scope.githubFields = [...snapshot.fields.filter(field => field.id !== stageField.id), stageField];
        scope.githubChecklistGroups ||= {};
        await this.plugin.saveSettings();

        const doneStatus = this.columns[this.columns.length - 1] || 'Done';
        const warnings: string[] = [];
        const outsideCount = tasks.length - structuredTaskIds.size;
        let changed = 0;
        for (const group of groups) {
            const previous = scope.githubChecklistGroups[group.id];
            let item = previous ? remoteById.get(previous.itemId) : undefined;
            if (previous && !item) {
                warnings.push(`Linked GitHub task is missing: ${group.title}`);
                continue;
            }
            if (!item) item = snapshot.items.find(candidate => candidate.body.includes(checklistMarker(scope.id, group.id)));
            const checks = checklistChecks(group, doneStatus);
            if (item) {
                if (item.contentType !== 'DraftIssue') {
                    warnings.push(`Cannot update non-draft checklist item: ${group.title}`);
                    continue;
                }
                const remoteChecks = remoteChecklistChecks(item.body);
                const pulls: { line: number; checked: boolean; task: ProjectTask }[] = [];
                for (const task of group.tasks) {
                    const remote = remoteChecks[task.id];
                    if (remote === undefined) continue;
                    const base = previous?.baseChecks[task.id] ?? remote;
                    if (remote !== base && checks[task.id] === base) {
                        checks[task.id] = remote;
                        if (task.sourceLine !== undefined) pulls.push({ line: task.sourceLine, checked: remote, task });
                    }
                }
                if (pulls.length) {
                    const file = group.tasks[0]!.file;
                    const lines = (await this.app.vault.read(file)).split('\n');
                    for (const pull of pulls) {
                        const line = lines[pull.line];
                        const match = line?.match(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*(.*)$/);
                        if (!line || !match || taskDisplayTitle(match[1] || '') !== pull.task.name) {
                            throw new Error(`Checklist line moved: ${pull.line + 1}`);
                        }
                        lines[pull.line] = line.replace(/\[[ xX]\]/, pull.checked ? '[x]' : '[ ]');
                    }
                    await this.app.vault.modify(file, lines.join('\n'));
                    changed += pulls.length;
                }
                const rendered = renderChecklistBody(scope.id, group, checks);
                const nextBody = replaceManagedChecklist(item.body, rendered, scope.id, group.id);
                if (nextBody === null) {
                    warnings.push(`Managed checklist markers are missing: ${group.title}`);
                    continue;
                }
                if (nextBody !== item.body) {
                    await client.updateDraftBody(item.contentId, nextBody);
                    changed++;
                }
                if (item.title !== group.title) {
                    await client.updateTitle(item, group.title);
                    changed++;
                }
            } else {
                const created = await client.createChecklistDraft(snapshot.id, group.title,
                    renderChecklistBody(scope.id, group, checks));
                item = { id: created.itemId, contentId: created.contentId, contentType: 'DraftIssue',
                    title: group.title, body: '', status: '', archived: false, fields: {} };
                scope.githubChecklistGroups[group.id] = { itemId: item.id, contentId: item.contentId,
                    baseTitle: group.title, baseChecks: { ...checks } };
                await this.plugin.saveSettings();
                changed++;
            }
            const stageOption = stageField.options?.find(option => option.name === group.stage);
            if (stageOption && item.fields['Этап'] !== group.stage) {
                await client.updateStatus(snapshot.id, item.id, stageField.id, stageOption.id);
                changed++;
            } else if (!stageOption) warnings.push(`No stage option: ${group.stage}`);
            const groupStatus = Object.values(checks).every(Boolean) ? doneStatus : (this.columns[0] || 'Backlog');
            const statusField = snapshot.fields.find(field => field.name === 'Status' && field.type === 'SINGLE_SELECT');
            const statusOption = statusField && remoteOptionForLocal(groupStatus, statusField.options || []);
            if (statusField && statusOption && localStatusForRemote(scope, item.status) !== groupStatus) {
                await client.updateStatus(snapshot.id, item.id, statusField.id, statusOption);
                changed++;
            }
            scope.githubChecklistGroups[group.id] = { itemId: item.id, contentId: item.contentId,
                baseTitle: group.title, baseChecks: { ...checks } };
            await this.plugin.saveSettings();
            if (changed && changed % 25 === 0) new Notice(`GitHub checklist: ${changed} changes…`);
        }

        // Archive only drafts created by this plugin's earlier flat sync, after all parent items exist.
        if (!warnings.length) {
            let archivedCount = 0;
            for (const [taskId, binding] of flatItems) {
                const item = remoteById.get(binding.itemId);
                if (!item) continue;
                if (!item.archived) await client.setArchived(snapshot.id, item.id, true);
                delete scope.githubBindings![taskId];
                changed++;
                archivedCount++;
                await this.plugin.saveSettings();
                if (archivedCount % 25 === 0) new Notice(`GitHub checklist: ${archivedCount}/${flatItems.length} old drafts archived…`);
                if (!item.archived) await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        if (outsideCount) warnings.push(`${outsideCount} tasks outside numbered stages were left untouched.`);
        await this.loadTasks();
        new Notice(`GitHub checklist sync: ${changed} changes, ${warnings.length} warnings.`, 10000);
        if (warnings.length) console.warn('GitHub checklist sync warnings:', warnings);
    }

    private confirmNativeChecklist(repositoryUrl: string, stages: number, groups: number, leaves: number,
        convertible: number): Promise<boolean> {
        return new Promise(resolve => {
            const ru = this.plugin.settings.language === 'ru';
            const modal = new Modal(this.app);
            let settled = false;
            const finish = (answer: boolean): void => {
                if (settled) return;
                settled = true;
                resolve(answer);
                modal.close();
            };
            modal.setTitle(ru ? 'Настоящие GitHub Issues' : 'Native GitHub Issues');
            modal.contentEl.createEl('p', { text: repositoryUrl });
            modal.contentEl.createEl('p', { text: ru
                ? `${stages} этапов · ${groups} задач и групп · ${leaves} подзадач. Плагин создаст Issues в указанном репозитории и свяжет их как Sub-issues.`
                : `${stages} stages · ${groups} parent tasks and groups · ${leaves} sub-issues. The plugin will create Issues in this repository and link them as Sub-issues.` });
            if (convertible) modal.contentEl.createEl('p', { text: ru
                ? `${convertible} существующих draft items будут превращены в Issues с сохранением элементов Project.`
                : `${convertible} existing draft items will be converted to Issues while keeping their Project items.` });
            modal.contentEl.createEl('p', { text: ru
                ? 'Это много запросов к GitHub. Синхронизацию можно безопасно продолжить после прерывания; состояние сохраняется после каждого Issue.'
                : 'This makes many GitHub API requests. You can resume after interruption; progress is saved after every Issue.' });
            const row = modal.contentEl.createDiv('modal-button-container');
            new ButtonComponent(row).setButtonText(ru ? 'Отмена' : 'Cancel').onClick(() => finish(false));
            new ButtonComponent(row).setButtonText(ru ? 'Создать структуру Issues' : 'Create issue hierarchy').setCta()
                .onClick(() => finish(true));
            modal.onClose = () => finish(false);
            modal.open();
        });
    }

    private async syncNativeChecklist(scope: ProjectScopeDefinition, projectUrl: string, repositoryUrl: string,
        client: GitHubProjectsClient, snapshot: GitHubProjectSnapshot, tasks: ProjectTask[]): Promise<void> {
        const normalizedRepository = repositoryUrl.replace(/\/$/, '');
        if (scope.githubIssuesRepositoryUrl && scope.githubIssuesRepositoryUrl.replace(/\/$/, '') !== normalizedRepository &&
            Object.keys(scope.githubNativeItems || {}).length) {
            throw new Error('This project is already linked to another Issues repository.');
        }
        const nodes = nativeChecklistNodes(tasks);
        const remoteById = new Map(snapshot.items.map(item => [item.id, item]));
        const findExisting = (node: typeof nodes[number]): typeof snapshot.items[number] | undefined => {
            const previous = scope.githubNativeItems?.[node.key];
            if (previous) {
                const linked = remoteById.get(previous.itemId);
                if (!linked) throw new Error(`Linked Issue is missing from the Project: ${node.title}`);
                return linked;
            }
            const marker = nativeChecklistMarker(scope.id, node.key);
            const marked = snapshot.items.find(item => item.body.includes(marker));
            if (marked) return marked;
            if (node.kind === 'group') {
                const groupId = node.key.slice('group:'.length);
                const oldGroup = scope.githubChecklistGroups?.[groupId];
                const draft = oldGroup && remoteById.get(oldGroup.itemId);
                if (draft && !draft.archived && draft.body.includes(checklistMarker(scope.id, groupId))) return draft;
            }
            if (node.kind === 'leaf' && node.task) {
                const oldBinding = scope.githubBindings?.[node.task.id];
                const draft = oldBinding && remoteById.get(oldBinding.itemId);
                if (draft && !draft.archived &&
                    draft.body.includes(`<!-- obsidian-project-task: ${scope.id}/${node.task.id} -->`)) return draft;
            }
            return undefined;
        };
        const convertible = nodes.filter(node => {
            const item = findExisting(node);
            return item?.contentType === 'DraftIssue' && !item.archived;
        }).length;
        if (!(await this.confirmNativeChecklist(normalizedRepository,
            nodes.filter(node => node.kind === 'stage').length,
            nodes.filter(node => node.kind === 'group').length,
            nodes.filter(node => node.kind === 'leaf').length, convertible))) return;
        const repositoryId = await client.repositoryId(normalizedRepository);
        const stages = [...new Set(nodes.map(node => node.stage))];
        let stageField = snapshot.fields.find(field => field.name === 'Этап' && field.type === 'SINGLE_SELECT');
        if (!stageField) stageField = await client.createStageField(snapshot.id, stages);
        else stageField = await client.ensureStageOptions(stageField, stages);
        scope.githubProjectUrl = projectUrl;
        scope.githubIssuesRepositoryUrl = normalizedRepository;
        scope.githubFields = [...snapshot.fields.filter(field => field.id !== stageField.id), stageField];
        scope.githubNativeItems ||= {};
        await this.plugin.saveSettings();

        const doneStatus = this.columns[this.columns.length - 1] || 'Done';
        const finalChecks = new Map<string, boolean>();
        const pulls: { line: number; checked: boolean; task: ProjectTask }[] = [];
        const warnings: string[] = [];
        const issueIds = new Map<string, string>();
        const statusField = snapshot.fields.find(field => field.name === 'Status' && field.type === 'SINGLE_SELECT');
        let changed = 0;
        let processed = 0;
        for (const node of nodes) {
            const parentIssueId = node.parentKey ? issueIds.get(node.parentKey) : undefined;
            if (node.parentKey && !parentIssueId) throw new Error(`Parent Issue was not created: ${node.title}`);
            const previous = scope.githubNativeItems[node.key];
            let item = findExisting(node);
            if (item?.archived) throw new Error(`Linked Issue is archived in the Project: ${node.title}`);
            if (item?.contentType === 'PullRequest') throw new Error(`A pull request is linked to checklist node: ${node.title}`);
            if (item?.contentType === 'Issue' && item.url && !item.url.startsWith(`${normalizedRepository}/issues/`)) {
                throw new Error(`Linked Issue belongs to another repository: ${item.url}`);
            }
            if (item?.contentType === 'DraftIssue') {
                const converted = await client.convertDraftToIssue(item.id, repositoryId);
                const marker = nativeChecklistMarker(scope.id, node.key);
                let body = item.body;
                if (node.kind === 'group') {
                    const groupId = node.key.slice('group:'.length);
                    const start = `<!-- obsidian-checklist-start: ${scope.id}/${groupId} -->`;
                    const end = `<!-- obsidian-checklist-end: ${scope.id}/${groupId} -->`;
                    const from = body.indexOf(start);
                    const to = body.indexOf(end, from + start.length);
                    if (from >= 0 && to >= 0) body = `${body.slice(0, from)}Sub-issues are linked below.\n${body.slice(to + end.length)}`;
                }
                if (!body.includes(marker)) body = `${body.trim()}\n\n${marker}`;
                await client.updateIssueBody(converted.issueId, body);
                item = { ...item, id: converted.itemId, contentId: converted.issueId,
                    contentType: 'Issue', url: converted.url, body, issueState: 'OPEN' };
                changed++;
            } else if (!item) {
                const marker = nativeChecklistMarker(scope.id, node.key);
                const body = `Imported from Obsidian project “${scope.name}”.\n\nSource: ${scope.sourceValue}\n\n${marker}`;
                const created = await client.createIssue(repositoryId, snapshot.id, node.title, body, parentIssueId);
                item = { id: created.itemId, contentId: created.id, contentType: 'Issue', title: node.title,
                    body, url: created.url, status: '', archived: false, fields: {}, issueState: 'OPEN', parentIssueId };
                changed++;
            }
            if (item.contentType !== 'Issue') throw new Error(`Issue conversion failed: ${node.title}`);
            remoteById.set(item.id, item);
            // Persist the created Issue before any further mutation so retrying does not duplicate it.
            scope.githubNativeItems[node.key] = {
                itemId: item.id, issueId: item.contentId,
                url: item.url,
                baseTitle: previous?.baseTitle || node.title,
                baseClosed: previous?.baseClosed ?? (item.issueState === 'CLOSED')
            };
            await this.plugin.saveSettings();
            issueIds.set(node.key, item.contentId);
            if (parentIssueId && item.parentIssueId !== parentIssueId) {
                if (item.parentIssueId) warnings.push(`Parent changed on GitHub; skipped reparenting: ${node.title}`);
                else {
                    await client.addSubIssue(parentIssueId, item.contentId);
                    item.parentIssueId = parentIssueId;
                    changed++;
                }
            }
            if (item.title !== node.title) {
                if (previous && item.title !== previous.baseTitle && node.title !== previous.baseTitle) {
                    warnings.push(`Title changed on both sides: ${node.title}`);
                } else if (previous && item.title !== previous.baseTitle) {
                    warnings.push(`GitHub title changed; edit the Markdown title manually: ${item.title}`);
                } else {
                    await client.updateTitle(item, node.title);
                    item.title = node.title;
                    changed++;
                }
            }
            if (item.title === node.title) {
                scope.githubNativeItems[node.key]!.baseTitle = node.title;
                await this.plugin.saveSettings();
            }
            const stageOption = stageField.options?.find(option => option.name === node.stage);
            if (!stageOption) throw new Error(`Stage option was not created: ${node.stage}`);
            if (stageOption && item.fields['Этап'] !== node.stage) {
                await client.updateStatus(snapshot.id, item.id, stageField.id, stageOption.id);
                item.fields['Этап'] = node.stage;
                changed++;
            }
            if (node.kind === 'leaf' && node.task) {
                const localClosed = node.task.status === doneStatus;
                const remoteClosed = item.issueState === 'CLOSED';
                const baseClosed = previous?.baseClosed ?? remoteClosed;
                let finalClosed = localClosed;
                if (remoteClosed !== baseClosed && localClosed === baseClosed) {
                    finalClosed = remoteClosed;
                    if (node.task.sourceLine !== undefined) pulls.push({ line: node.task.sourceLine,
                        checked: remoteClosed, task: node.task });
                } else if (remoteClosed !== baseClosed && localClosed !== baseClosed && remoteClosed !== localClosed) {
                    warnings.push(`Completion changed on both sides: ${node.title}`);
                    finalClosed = remoteClosed;
                } else if (localClosed !== remoteClosed) {
                    await client.setIssueClosed(item.contentId, localClosed);
                    item.issueState = localClosed ? 'CLOSED' : 'OPEN';
                    changed++;
                }
                finalChecks.set(node.task.id, finalClosed);
                if (finalClosed === (item.issueState === 'CLOSED')) {
                    scope.githubNativeItems[node.key]!.baseClosed = finalClosed;
                    await this.plugin.saveSettings();
                }
                if (statusField) {
                    const status = finalClosed ? doneStatus : (this.columns[0] || 'Backlog');
                    const option = remoteOptionForLocal(status, statusField.options || []);
                    if (option && (finalClosed || !item.status) && localStatusForRemote(scope, item.status) !== status) {
                        await client.updateStatus(snapshot.id, item.id, statusField.id, option);
                        item.status = status;
                        changed++;
                    }
                }
                const oldBinding = scope.githubBindings?.[node.task.id];
                if (oldBinding?.itemId === item.id) {
                    oldBinding.meta = { contentType: 'Issue', url: item.url, fields: item.fields };
                    await this.plugin.saveSettings();
                }
            }
            processed++;
            if (processed % 25 === 0) new Notice(`GitHub Issues: ${processed}/${nodes.length} linked…`);
            await new Promise(resolve => setTimeout(resolve, 120));
        }
        if (pulls.length) {
            const file = pulls[0]!.task.file;
            const lines = (await this.app.vault.read(file)).split('\n');
            for (const pull of pulls) {
                const line = lines[pull.line];
                const match = line?.match(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*(.*)$/);
                if (!line || !match || taskDisplayTitle(match[1] || '') !== pull.task.name) {
                    throw new Error(`Checklist line moved: ${pull.line + 1}`);
                }
                lines[pull.line] = line.replace(/\[[ xX]\]/, pull.checked ? '[x]' : '[ ]');
            }
            await this.app.vault.modify(file, lines.join('\n'));
            changed += pulls.length;
        }
        // Parent Issue completion follows all of its descendant checklist items.
        for (const node of nodes.filter(node => node.kind !== 'leaf').reverse()) {
            const descendants = nodes.filter(candidate => candidate.kind === 'leaf' && candidate.task &&
                (node.kind === 'stage' ? candidate.stage === node.stage :
                    candidate.task.checklistAncestors?.some(parent => `group:${parent.id}` === node.key)));
            if (!descendants.length) continue;
            const closed = descendants.every(candidate => finalChecks.get(candidate.task!.id));
            const item = remoteById.get(scope.githubNativeItems[node.key]!.itemId);
            if (item && (item.issueState === 'CLOSED') !== closed) {
                await client.setIssueClosed(item.contentId, closed);
                item.issueState = closed ? 'CLOSED' : 'OPEN';
                changed++;
            }
            if (closed && item && statusField) {
                const option = remoteOptionForLocal(doneStatus, statusField.options || []);
                if (option && localStatusForRemote(scope, item.status) !== doneStatus) {
                    await client.updateStatus(snapshot.id, item.id, statusField.id, option);
                    item.status = doneStatus;
                    changed++;
                }
            }
            scope.githubNativeItems[node.key]!.baseClosed = closed;
            await this.plugin.saveSettings();
        }
        await this.loadTasks();
        new Notice(`GitHub Issues sync: ${changed} changes, ${warnings.length} warnings.`, 10000);
        if (warnings.length) console.warn('GitHub Issues sync warnings:', warnings);
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
