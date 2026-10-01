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
import { aggregateChecklistStatus } from './projects/checklist-status';
import { importGitHubChecklistItems } from './projects/github-import';
import { localStatusForRemote, localValues, planGitHubSync, remoteOptionForLocal, remoteValues, syncPlanSummary, type SyncedField } from './projects/github-sync';
import {
    activeScopeId as activeScopeIdStore,
    columns as columnsStore,
    scopesWithStats,
    selectedTasks as selectedTasksStore,
    tasks as tasksStore
} from './store/ProjectsStore';

export const VIEW_TYPE_PROJECTS = 'habit-projects-view';

function issueDescription(body: string, marker: string): string {
    let description = body.replace(marker, '').trim();
    description = description.replace(/^Imported from Obsidian project [^\n]+\.\s*\n\s*Source: [^\n]+\s*/i, '').trim();
    if (description === 'Sub-issues are linked below.') return '';
    return description;
}

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
            if ((this.plugin.settings.projectScopes || []).some(scope => scope.sourceType === 'file' &&
                file.path === scope.sourceValue.replace(/\.md$/i, '.tasks.md'))) return;
            if (!this.isProjectFile(file.path)) return;
            this.dataEngine.invalidateCacheEntry(file.path);
            this.scheduleReload(500);
        }));
        this.registerEvent(this.app.vault.on('delete', file => {
            if (!this.isProjectFile(file.path)) return;
            this.dataEngine.invalidateCacheEntry(file.path);
            this.scheduleReload(250);
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (!this.isProjectFile(oldPath) && !this.isProjectFile(file.path)) return;
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

    refreshSettings(): void {
        this.scheduleReload(0);
    }

    private isProjectFile(path: string): boolean {
        return (this.plugin.settings.projectScopes || []).some(scope => {
            if (scope.sourceType === 'file') {
                return path === scope.sourceValue || path.startsWith(`${scope.sourceValue.replace(/\.md$/i, '')}.tasks/`);
            }
            if (scope.sourceType === 'folder') {
                const folder = scope.sourceValue.trim().replace(/\/$/, '');
                return !folder || path.startsWith(`${folder}/`);
            }
            return true;
        });
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
        await this.plugin.projectSourceRename;
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
            if (!this.columns.includes(status)) this.columns.splice(Math.max(0, this.columns.length - 1), 0, status);
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
                task.name, this.columns, task.blockId, task.sourceLine
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
            urlInput.setCssStyles({ width: '100%' });
            modal.contentEl.createEl('p', { text: ru
                ? 'Classic PAT: scope project; для создания Issues также repo или public_repo. Токен хранится только в памяти окна.'
                : 'Classic PAT: project scope; creating Issues also needs repo or public_repo. The token stays in view memory.' });
            const tokenInput = modal.contentEl.createEl('input', { type: 'password', value: this.githubToken });
            tokenInput.setCssStyles({ width: '100%' });
            modal.contentEl.createEl('p', { text: ru
                ? 'Для этапов и настоящих Sub-issues укажите репозиторий игры. Без него структурированный чеклист не будет отправлен в GitHub. Не указывайте репозиторий Obsidian-плагина.'
                : 'Enter the game repository for stages and native Sub-issues. A structured checklist cannot sync without it. Do not enter the Obsidian plugin repository.' });
            const repositoryInput = modal.contentEl.createEl('input', {
                type: 'url', value: scope.githubIssuesRepositoryUrl || '',
                placeholder: 'https://github.com/OWNER/GAME-REPOSITORY'
            });
            repositoryInput.setCssStyles({ width: '100%' });
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
            (Object.keys(scope.githubBindings || {}).length || Object.keys(scope.githubNativeItems || {}).length ||
                Object.keys(scope.githubChecklistGroups || {}).length)) {
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
            if (!summary.push && !summary.pull && !summary.link && !summary.conflicts) {
                let refreshed = scope.githubProjectUrl !== connection.url ||
                    JSON.stringify(scope.githubFields || []) !== JSON.stringify(snapshot.fields);
                scope.githubProjectUrl = connection.url;
                scope.githubFields = snapshot.fields;
                for (const pair of plan.pairs) {
                    const binding = scope.githubBindings?.[pair.task.id];
                    if (!binding) continue;
                    const meta = { url: pair.item.url, contentType: pair.item.contentType, fields: pair.item.fields,
                        assignees: pair.item.assignees, subIssues: pair.item.subIssues };
                    if (JSON.stringify(binding.meta) !== JSON.stringify(meta)) {
                        binding.meta = meta;
                        refreshed = true;
                    }
                }
                if (refreshed) {
                    await this.plugin.saveSettings();
                    await this.loadTasks();
                }
                new Notice(this.plugin.settings.language === 'ru' ? 'GitHub: изменений нет.' : 'GitHub: no changes.');
                return;
            }
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
                const oldBinding = scope.githubBindings[pair.task.id];
                const localFields = { ...(oldBinding?.localFields || oldBinding?.meta?.fields || pair.item.fields) };
                const baseFields = { ...(oldBinding?.baseFields || oldBinding?.meta?.fields || pair.item.fields) };
                const current = localValues(pair.task);
                const remote = remoteValues(pair.item, scope,
                    pair.newlyLinked ? pair.task.status : scope.githubBindings[pair.task.id]?.base.status);
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
                    }, scope.sourceType === 'file', pair.task.name, this.columns, pair.task.blockId, pair.task.sourceLine);
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
                const base = { ...(scope.githubBindings[pair.task.id]?.base || current) };
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
                if (bindingKey !== pair.task.id) delete scope.githubBindings[pair.task.id];
                scope.githubBindings[bindingKey] = { itemId: pair.item.id, base, localFields, baseFields, meta: itemMeta(pair.item) };
                await this.plugin.saveSettings();
            }

            for (const task of plan.createRemote) {
                const marker = `<!-- obsidian-project-task: ${scope.id}/${task.id} -->`;
                const body = `Imported from Obsidian project “${scope.name}”.\n\nSource: ${task.file.path}\n${marker}`;
                const itemId = await client.createDraft(snapshot.id, task.name, body);
                changed++; report();
                scope.githubBindings[task.id] = {
                    itemId, base: { name: task.name, status: '', archived: false },
                    localFields: {}, baseFields: {}, meta: { contentType: 'DraftIssue', fields: {} }
                };
                await this.plugin.saveSettings();
                const option = statusOption(task.status);
                if (option && plan.statusField) {
                    await client.updateStatus(snapshot.id, itemId, plan.statusField.id, option);
                    changed++; report();
                    scope.githubBindings[task.id]!.base.status = task.status;
                    await this.plugin.saveSettings();
                } else if (task.status) warnings.push(`No GitHub Status option for: ${task.status}`);
                if (task.archived) {
                    await client.setArchived(snapshot.id, itemId, true); changed++; report();
                    scope.githubBindings[task.id]!.base.archived = true;
                    await this.plugin.saveSettings();
                }
                for (const { field, value } of initialFields(task)) {
                    await client.updateCustomField(snapshot.id, itemId, field, value);
                    scope.githubBindings[task.id]!.localFields![field.name] = value;
                    scope.githubBindings[task.id]!.baseFields![field.name] = value;
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
                    const candidates = reloaded.filter(task => task.name === item.title && !scope.githubBindings?.[task.id]);
                    if (candidates.length !== 1) { warnings.push(`Could not link imported task: ${item.title}`); continue; }
                    const task = candidates[0]!;
                    if (item.archived) await this.dataEngine.setArchived(task, true, scope.sourceType === 'file');
                    scope.githubBindings[task.id] = { itemId: item.id,
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

    private confirmNativeChecklist(repositoryUrl: string, newIssues: number, convertible: number,
        existingIssues: number): Promise<boolean> {
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
                ? `Будет создано новых Issues: ${newIssues}. Уже найдено: ${existingIssues}. Существующие Issues будут повторно использованы.`
                : `New Issues to create: ${newIssues}. Already found: ${existingIssues}. Existing Issues will be reused.` });
            if (convertible) modal.contentEl.createEl('p', { text: ru
                ? `${convertible} существующих draft items будут превращены в Issues с сохранением элементов Project.`
                : `${convertible} existing draft items will be converted to Issues while keeping their Project items.` });
            modal.contentEl.createEl('p', { text: ru
                ? 'Привязки сохраняются по мере создания. Повторная синхронизация обновит только изменившиеся задачи и прогресс.'
                : 'Links are saved as Issues are created. Later syncs update only changed items and progress.' });
            const row = modal.contentEl.createDiv('modal-button-container');
            new ButtonComponent(row).setButtonText(ru ? 'Отмена' : 'Cancel').onClick(() => finish(false));
            new ButtonComponent(row).setButtonText(ru ? 'Продолжить синхронизацию' : 'Continue sync').setCta()
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
        let nodes = nativeChecklistNodes(tasks);
        let localDescriptions = await this.dataEngine.checklistDescriptions(scope);
        const remoteById = new Map(snapshot.items.map(item => [item.id, item]));
        const findExisting = (node: typeof nodes[number]): typeof snapshot.items[number] | undefined => {
            const previous = scope.githubNativeItems?.[node.key];
            if (previous) {
                const linked = remoteById.get(previous.itemId);
                if (!linked) throw new Error(`Linked Issue is missing from the Project: ${node.title}`);
                return linked;
            }
            if (node.task?.githubItemId) {
                const imported = remoteById.get(node.task.githubItemId);
                if (imported) return imported;
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
        const plannedExisting = new Map<string, typeof snapshot.items[number]>();
        const claimedItems = new Set<string>();
        const matchByTitleAndParent = (node: typeof nodes[number], parentIssueId?: string): typeof snapshot.items[number] | undefined => {
            const candidates = snapshot.items.filter(item => item.contentType === 'Issue' && !item.archived &&
                !claimedItems.has(item.id) && item.title === node.title && item.parentIssueId === parentIssueId &&
                (!item.url || item.url.toLowerCase().startsWith(`${normalizedRepository.toLowerCase()}/issues/`)) &&
                !item.body.includes('<!-- obsidian-checklist-node:') &&
                !item.body.includes('<!-- obsidian-project-task:'));
            if (candidates.length > 1) throw new Error(`Multiple Issues match ${node.title}; link one manually before syncing.`);
            return candidates[0];
        };
        const planExisting = (): void => {
            plannedExisting.clear();
            claimedItems.clear();
            for (const node of nodes) {
                const parent = node.parentKey ? plannedExisting.get(node.parentKey) : undefined;
                const found = findExisting(node) || (!node.parentKey || parent?.contentType === 'Issue'
                    ? matchByTitleAndParent(node, parent?.contentId) : undefined);
                if (!found) continue;
                if (claimedItems.has(found.id)) throw new Error(`The same GitHub item matches multiple checklist tasks: ${found.title}`);
                plannedExisting.set(node.key, found);
                claimedItems.add(found.id);
            }
        };
        planExisting();
        const imported = await importGitHubChecklistItems(this.app, scope, tasks, nodes, snapshot.items,
            plannedExisting, normalizedRepository);
        if (imported.count) {
            tasks = await this.dataEngine.loadTasks(scope);
            for (const item of snapshot.items) {
                const task = tasks.find(candidate => candidate.githubItemId === item.id);
                if (!task) continue;
                const description = issueDescription(item.body, nativeChecklistMarker(scope.id, `leaf:${task.id}`));
                if (description && !task.notePath) {
                    await this.dataEngine.saveChecklistNodeDescription(scope, `leaf:${task.id}`, description);
                }
            }
            nodes = nativeChecklistNodes(tasks);
            localDescriptions = await this.dataEngine.checklistDescriptions(scope);
            planExisting();
            await this.loadTasks();
        }
        const convertible = [...plannedExisting.values()].filter(item => item.contentType === 'DraftIssue' && !item.archived).length;
        const newIssues = nodes.length - plannedExisting.size;
        if ((newIssues || convertible) && !(await this.confirmNativeChecklist(normalizedRepository,
            newIssues, convertible, plannedExisting.size - convertible))) {
            if (imported.count) new Notice(`${imported.count} GitHub items imported into Obsidian. Issue conversion was cancelled.`);
            return;
        }
        const repositoryId = newIssues || convertible ? await client.repositoryId(normalizedRepository) : '';
        const stages = [...new Set(nodes.map(node => node.stage).filter(Boolean))];
        let stageField = snapshot.fields.find(field => field.name === 'Этап' && field.type === 'SINGLE_SELECT');
        if (!stageField) stageField = await client.createStageField(snapshot.id, stages);
        else stageField = await client.ensureStageOptions(stageField, stages);
        const updatedFields = [...snapshot.fields.filter(field => field.id !== stageField.id), stageField];
        const connectionChanged = scope.githubProjectUrl !== projectUrl ||
            scope.githubIssuesRepositoryUrl !== normalizedRepository ||
            JSON.stringify(scope.githubFields || []) !== JSON.stringify(updatedFields) || !scope.githubNativeItems;
        scope.githubProjectUrl = projectUrl;
        scope.githubIssuesRepositoryUrl = normalizedRepository;
        scope.githubFields = updatedFields;
        scope.githubNativeItems ||= {};
        if (connectionChanged) await this.plugin.saveSettings();

        const doneStatus = this.columns[this.columns.length - 1] || 'Done';
        const pulls: { line: number; checked?: boolean; status?: string; task: ProjectTask }[] = [];
        const synchronizedStatuses = new Map<string, string>();
        const warnings: string[] = [...imported.warnings];
        const issueIds = new Map<string, string>();
        const statusField = snapshot.fields.find(field => field.name === 'Status' && field.type === 'SINGLE_SELECT');
        if (!statusField) warnings.push('GitHub Project has no Status field; intermediate task statuses cannot be synchronized.');
        let changed = imported.count;
        let processed = 0;
        let bindingsUpdated = connectionChanged;
        for (const node of nodes) {
            const changedBeforeNode = changed;
            const parentIssueId = node.parentKey ? issueIds.get(node.parentKey) : undefined;
            if (node.parentKey && !parentIssueId) throw new Error(`Parent Issue was not created: ${node.title}`);
            const previous = scope.githubNativeItems[node.key];
            let item = plannedExisting.get(node.key) || findExisting(node);
            if (!item && (!node.parentKey || parentIssueId)) {
                item = matchByTitleAndParent(node, parentIssueId);
                if (item) claimedItems.add(item.id);
            }
            if (item?.archived) throw new Error(`Linked Issue is archived in the Project: ${node.title}`);
            if (item?.contentType === 'PullRequest') throw new Error(`A pull request is linked to checklist node: ${node.title}`);
            const externalIssue = item?.contentType === 'Issue' && typeof item.url === 'string' &&
                !item.url.toLowerCase().startsWith(`${normalizedRepository.toLowerCase()}/issues/`);
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
                const body = `${localDescriptions.get(node.key)?.trim() || `Imported from Obsidian project “${scope.name}”.\n\nSource: ${scope.sourceValue}`}\n\n${marker}`;
                const created = await client.createIssue(repositoryId, snapshot.id, node.title, body, parentIssueId);
                item = { id: created.itemId, contentId: created.id, contentType: 'Issue', title: node.title,
                    body, url: created.url, status: '', archived: false, fields: {}, issueState: 'OPEN', parentIssueId };
                changed++;
            }
            if (item.contentType !== 'Issue') throw new Error(`Issue conversion failed: ${node.title}`);
            const marker = nativeChecklistMarker(scope.id, node.key);
            if (!item.body.includes(marker)) {
                const body = `${item.body.trim()}\n\n${marker}`.trim();
                await client.updateIssueBody(item.contentId, body);
                item.body = body;
                changed++;
            }
            remoteById.set(item.id, item);
            // Persist the created Issue before any further mutation so retrying does not duplicate it.
            const binding = {
                ...previous,
                itemId: item.id, issueId: item.contentId,
                url: item.url,
                baseTitle: previous?.baseTitle || node.title,
                baseClosed: previous?.baseClosed ?? (item.issueState === 'CLOSED'),
                baseDescription: previous?.baseDescription,
                baseStatus: previous?.baseStatus
            };
            if (JSON.stringify(previous) !== JSON.stringify(binding)) {
                scope.githubNativeItems[node.key] = binding;
                await this.plugin.saveSettings();
                bindingsUpdated = true;
            }
            issueIds.set(node.key, item.contentId);
            if (parentIssueId && item.parentIssueId !== parentIssueId) {
                if (item.parentIssueId) warnings.push(`Parent changed on GitHub; skipped reparenting: ${node.title}`);
                else if (externalIssue) {
                    warnings.push(`Issue from another repository was not reparented: ${item.url}`);
                } else {
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
                if (scope.githubNativeItems[node.key]!.baseTitle !== node.title) {
                    scope.githubNativeItems[node.key]!.baseTitle = node.title;
                    bindingsUpdated = true;
                }
            }
            {
                const localDescription = localDescriptions.get(node.key)?.trim() || '';
                const remoteDescription = issueDescription(item.body, marker);
                const baseDescription = previous?.baseDescription;
                if (localDescription !== remoteDescription) {
                    if (baseDescription !== undefined && localDescription !== baseDescription && remoteDescription !== baseDescription) {
                        warnings.push(`Description changed on both sides: ${node.title}`);
                    } else if (baseDescription !== undefined && remoteDescription !== baseDescription && localDescription === baseDescription ||
                        baseDescription === undefined && !localDescription && remoteDescription) {
                        await this.dataEngine.saveChecklistNodeDescription(scope, node.key, remoteDescription);
                        localDescriptions.set(node.key, remoteDescription);
                        if (node.task) node.task.description = remoteDescription;
                    } else if (baseDescription !== undefined && localDescription !== baseDescription && remoteDescription === baseDescription ||
                        baseDescription === undefined && localDescription && !remoteDescription) {
                        const body = `${localDescription || `Imported from Obsidian project “${scope.name}”.\n\nSource: ${scope.sourceValue}`}\n\n${marker}`;
                        await client.updateIssueBody(item.contentId, body);
                        item.body = body;
                        changed++;
                    } else {
                        warnings.push(`Description differs on GitHub and Obsidian: ${node.title}`);
                    }
                }
                const synchronizedDescription = issueDescription(item.body, marker);
                if (synchronizedDescription === (localDescriptions.get(node.key)?.trim() || '') &&
                    scope.githubNativeItems[node.key]!.baseDescription !== synchronizedDescription) {
                    scope.githubNativeItems[node.key]!.baseDescription = synchronizedDescription;
                    bindingsUpdated = true;
                }
            }
            if (node.stage) {
                const stageOption = stageField.options?.find(option => option.name === node.stage);
                if (!stageOption) throw new Error(`Stage option was not created: ${node.stage}`);
                if (item.fields['Этап'] !== node.stage) {
                    await client.updateStatus(snapshot.id, item.id, stageField.id, stageOption.id);
                    item.fields['Этап'] = node.stage;
                    changed++;
                }
            }
            if (node.kind === 'leaf' && node.task) {
                const createdNow = !previous && !plannedExisting.has(node.key);
                const localClosed = node.task.status === doneStatus;
                const remoteClosed = item.issueState === 'CLOSED' ||
                    Boolean(item.status && localStatusForRemote(scope, item.status) === doneStatus);
                const baseClosed = previous?.baseClosed ?? (item.issueState === 'CLOSED');
                let finalClosed = localClosed;
                if (!previous && !createdNow && remoteClosed && !localClosed) {
                    finalClosed = true;
                    if (node.task.sourceLine !== undefined) pulls.push({ line: node.task.sourceLine,
                        checked: true, task: node.task });
                } else if (previous && remoteClosed !== baseClosed && localClosed === baseClosed) {
                    finalClosed = remoteClosed;
                    if (node.task.sourceLine !== undefined) pulls.push({ line: node.task.sourceLine,
                        checked: remoteClosed, task: node.task });
                } else if (previous && remoteClosed !== baseClosed && localClosed !== baseClosed && remoteClosed !== localClosed) {
                    warnings.push(`Completion changed on both sides: ${node.title}`);
                    finalClosed = remoteClosed;
                }
                if (finalClosed !== (item.issueState === 'CLOSED')) {
                    await client.setIssueClosed(item.contentId, finalClosed);
                    item.issueState = finalClosed ? 'CLOSED' : 'OPEN';
                    changed++;
                }
                if (finalClosed === (item.issueState === 'CLOSED') &&
                    scope.githubNativeItems[node.key]!.baseClosed !== finalClosed) {
                    scope.githubNativeItems[node.key]!.baseClosed = finalClosed;
                    bindingsUpdated = true;
                }
                const nativeBinding = scope.githubNativeItems[node.key]!;
                if (!statusField && nativeBinding.baseStatus !== undefined) {
                    delete nativeBinding.baseStatus;
                    bindingsUpdated = true;
                }
                const firstStatus = this.columns[0] || 'Backlog';
                const localStatus = finalClosed ? doneStatus : node.task.status === doneStatus ? firstStatus : node.task.status;
                const remoteStatus = statusField ?
                    (item.status ? localStatusForRemote(scope, item.status) : firstStatus) : localStatus;
                const baseStatus = previous?.baseStatus ?? (createdNow ? firstStatus : remoteStatus);
                let finalStatus = localStatus;
                let statusConflict = false;
                if (!finalClosed && localStatus !== remoteStatus) {
                    if (previous && localStatus !== baseStatus && remoteStatus !== baseStatus) {
                        warnings.push(`Status changed on both sides: ${node.title}`);
                        statusConflict = true;
                    } else if (previous && localStatus === baseStatus && remoteStatus !== baseStatus ||
                        !previous && !createdNow && localStatus === firstStatus) {
                        finalStatus = remoteStatus;
                    } else if (!previous && !createdNow && remoteStatus !== firstStatus) {
                        warnings.push(`Status differs on GitHub and Obsidian: ${node.title}`);
                        statusConflict = true;
                    }
                }
                if (statusField && !statusConflict && (finalStatus !== remoteStatus || !item.status)) {
                    const option = remoteOptionForLocal(finalStatus, statusField.options || []);
                    if (option) {
                        await client.updateStatus(snapshot.id, item.id, statusField.id, option);
                        item.status = statusField.options?.find(value => value.id === option)?.name || finalStatus;
                        item.fields.Status = item.status;
                        changed++;
                    } else warnings.push(`No matching GitHub Status option: ${finalStatus}`);
                }
                if (statusField && !statusConflict && localStatusForRemote(scope, item.status) === finalStatus) {
                    if (nativeBinding.baseStatus !== finalStatus) {
                        nativeBinding.baseStatus = finalStatus;
                        bindingsUpdated = true;
                    }
                }
                // Parent aggregation below must use the result of this sync, including pulls.
                if (!statusConflict) {
                    if (node.task.status !== finalStatus && node.task.sourceLine !== undefined) {
                        pulls.push({ line: node.task.sourceLine, status: finalStatus, task: node.task });
                    }
                    synchronizedStatuses.set(node.task.id, finalStatus);
                }
                const editableFields = snapshot.fields.filter(field => field.name !== 'Status' && field.name !== 'Этап' &&
                    ['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'ITERATION'].includes(field.type));
                const localFields = { ...(nativeBinding.localFields || nativeBinding.meta?.fields || item.fields) };
                const baseFields = { ...(nativeBinding.baseFields || nativeBinding.meta?.fields || item.fields) };
                for (const field of editableFields) {
                    const name = field.name;
                    const localValue = String(localFields[name] ?? '');
                    const remoteValue = String(item.fields[name] ?? '');
                    const baseValue = String(baseFields[name] ?? '');
                    if (localValue === remoteValue) { baseFields[name] = item.fields[name] ?? ''; continue; }
                    if (localValue === baseValue) {
                        localFields[name] = item.fields[name] ?? '';
                        baseFields[name] = item.fields[name] ?? '';
                    } else if (remoteValue === baseValue) {
                        await client.updateCustomField(snapshot.id, item.id, field, localFields[name] ?? '');
                        item.fields[name] = localFields[name] ?? '';
                        baseFields[name] = item.fields[name]!;
                        changed++;
                    } else warnings.push(`Field “${name}” changed on both sides: ${node.title}`);
                }
                const meta = { fields: { ...item.fields }, assignees: item.assignees, subIssues: item.subIssues };
                if (JSON.stringify(nativeBinding.localFields) !== JSON.stringify(localFields) ||
                    JSON.stringify(nativeBinding.baseFields) !== JSON.stringify(baseFields) ||
                    JSON.stringify(nativeBinding.meta) !== JSON.stringify(meta)) {
                    nativeBinding.localFields = localFields;
                    nativeBinding.baseFields = baseFields;
                    nativeBinding.meta = meta;
                    bindingsUpdated = true;
                }
                const oldBinding = scope.githubBindings?.[node.task.id];
                if (oldBinding?.itemId === item.id) {
                    const meta = { contentType: 'Issue' as const, url: item.url, fields: item.fields };
                    if (JSON.stringify(oldBinding.meta) !== JSON.stringify(meta)) {
                        oldBinding.meta = meta;
                        bindingsUpdated = true;
                    }
                }
            }
            // Stage/group Issues also carry grouping fields (Milestone, Iteration,
            // custom single-select fields), even though they have no checkbox row.
            if (!node.task) {
                const nativeBinding = scope.githubNativeItems[node.key]!;
                const meta = { fields: { ...item.fields }, assignees: item.assignees, subIssues: item.subIssues };
                if (JSON.stringify(nativeBinding.meta) !== JSON.stringify(meta)) {
                    nativeBinding.meta = meta;
                    bindingsUpdated = true;
                }
            }
            processed++;
            if (bindingsUpdated && processed % 25 === 0) await this.plugin.saveSettings();
            if (changed > changedBeforeNode) {
                if (processed % 25 === 0) new Notice(`GitHub Issues: ${processed}/${nodes.length} checked…`);
                await new Promise(resolve => setTimeout(resolve, 120));
            }
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
                if (pull.checked !== undefined) lines[pull.line] = line.replace(/\[[ xX]\]/, pull.checked ? '[x]' : '[ ]');
                if (pull.status !== undefined) {
                    const firstStatus = this.columns[0] || 'Backlog';
                    const cleaned = lines[pull.line]!.replace(/\s*<!-- project-status: [^>]* -->/g, '');
                    const marker = pull.status === doneStatus ||
                        (pull.status === firstStatus && !pull.task.githubItemId) ? '' :
                        ` <!-- project-status: ${pull.status.replace(/-->/g, '')} -->`;
                    lines[pull.line] = /\s+\^[A-Za-z0-9-]+\s*$/.test(cleaned)
                        ? cleaned.replace(/(\s+\^[A-Za-z0-9-]+\s*)$/, `${marker}$1`)
                        : `${cleaned.trimEnd()}${marker}`;
                }
            }
            await this.app.vault.modify(file, lines.join('\n'));
            changed += pulls.length;
        }
        // GitHub does not propagate sub-issue completion to the parent Issue's Status.
        // Keep stages and numbered groups consistent with the aggregate shown in Obsidian.
        for (const node of [...nodes].reverse().filter(node => node.kind !== 'leaf')) {
            const binding = scope.githubNativeItems[node.key]!;
            const item = remoteById.get(binding.itemId);
            if (!item) continue;
            const descendants = tasks.filter(task => node.kind === 'stage'
                ? task.section === node.stage
                : task.checklistAncestors?.some(ancestor => `group:${ancestor.id}` === node.key));
            const targetStatus = aggregateChecklistStatus(descendants.map(task => ({ ...task,
                status: synchronizedStatuses.get(task.id) ?? task.status })), this.columns);
            const targetClosed = targetStatus === doneStatus;
            if ((item.issueState === 'CLOSED') !== targetClosed) {
                await client.setIssueClosed(item.contentId, targetClosed);
                item.issueState = targetClosed ? 'CLOSED' : 'OPEN';
                changed++;
            }
            if (statusField && localStatusForRemote(scope, item.status) !== targetStatus) {
                const option = remoteOptionForLocal(targetStatus, statusField.options || []);
                if (option) {
                    await client.updateStatus(snapshot.id, item.id, statusField.id, option);
                    item.status = statusField.options?.find(value => value.id === option)?.name || targetStatus;
                    item.fields.Status = item.status;
                    changed++;
                } else warnings.push(`No matching GitHub Status option: ${targetStatus} (${node.title})`);
            }
            const meta = { fields: { ...item.fields }, assignees: item.assignees, subIssues: item.subIssues };
            if (binding.baseClosed !== targetClosed || binding.baseStatus !== targetStatus || JSON.stringify(binding.meta) !== JSON.stringify(meta)) {
                binding.baseClosed = targetClosed;
                if (!statusField || localStatusForRemote(scope, item.status) === targetStatus) binding.baseStatus = targetStatus;
                binding.meta = meta;
                bindingsUpdated = true;
            }
        }
        if (bindingsUpdated) await this.plugin.saveSettings();
        if (changed || bindingsUpdated || pulls.length) await this.loadTasks();
        await this.dataEngine.recordChecklistGitHub(scope, [...remoteById.values()],
            new Set(pulls.filter(pull => pull.checked === true).map(pull => `leaf:${pull.task.id}`)));
        new Notice(`GitHub Issues sync: ${changed} changes, ${warnings.length} warnings.`, 10000);
        if (warnings.length) {
            console.warn('GitHub Issues sync warnings:', warnings);
            const modal = new Modal(this.app);
            modal.setTitle(this.plugin.settings.language === 'ru' ? 'Проблемы синхронизации GitHub' : 'GitHub sync warnings');
            const list = modal.contentEl.createEl('ul');
            for (const warning of warnings.slice(0, 50)) list.createEl('li', { text: warning });
            if (warnings.length > 50) modal.contentEl.createEl('p', { text: `… and ${warnings.length - 50} more warnings in the console.` });
            modal.open();
        }
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
