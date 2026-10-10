import { App, normalizePath, Notice, TFile } from 'obsidian';
import type { ProjectScopeDefinition, ProjectTask, ProjectStage } from './types';
import { GITHUB_IMPORT_SECTION, nativeChecklistNodes, parseChecklistStages } from './native-checklist';
import type { GitHubItem } from './github-client';
import { blockIdFromTaskLine, taskDisplayTitle, newTaskBlockId, withChecklistNodeId, stripChecklistNodeId, checklistNodeId } from './engine/task-identity';
import { readTaskMetadata, replaceTaskMetadata } from './engine/task-metadata';
import { ChecklistNotes, checklistNoteLink, localCompletionTime, type ChecklistNoteState } from './checklist-notes';
import { aggregateChecklistStatus } from './checklist-status';
import { findTaskBlockEnd } from './engine/task-block';
import { markdownContentLines } from './engine/markdown-lines';

/** The checklist keeps its readable short entries; this file holds the complete current index. */
export interface ChecklistStateEntry {
    id: string;
    kind: 'stage' | 'group' | 'task';
    parentId?: string;
    title: string;
    status: string;
    checked: boolean;
    completedAt: string | null;
    sourceLine?: number;
    githubItemId?: string;
    stage?: string;
    priority?: string;
    tags?: string;
    startDate?: string;
    dueDate?: string;
    estimateSeconds?: number;
    timeSpentSeconds?: number;
    habitName?: string;
    cover?: string;
    color?: string;
    archived?: boolean;
    order?: number;
    notePath?: string;
    noteAnchor?: string;
    noteRootId?: string;
    github?: {
        itemId: string;
        issueId: string;
        url?: string;
        fields?: Record<string, string | number>;
        number?: number;
        state?: 'OPEN' | 'CLOSED';
        closedAt?: string | null;
        createdAt?: string;
        updatedAt?: string;
        assignees?: string[];
        labels?: string[];
        milestone?: string;
        issueType?: string;
        subIssues?: { completed: number; total: number };
        parentIssueId?: string;
        archived?: boolean;
    };
}

interface ChecklistStateFile extends ChecklistNoteState {
    schemaVersion: 1;
    source: string;
    entries: ChecklistStateEntry[];
}

function statePath(source: TFile): string {
    const parent = source.parent?.path;
    return normalizePath(`${parent && parent !== '/' ? parent + '/' : ''}${source.basename}.tasks.json`);
}

function indexPath(source: TFile): string {
    const parent = source.parent?.path;
    return normalizePath(`${parent && parent !== '/' ? parent + '/' : ''}${source.basename}.tasks.md`);
}

function noteFolder(source: TFile): string {
    const parent = source.parent?.path;
    return normalizePath(`${parent && parent !== '/' ? parent + '/' : ''}${source.basename}.tasks`);
}

function indexContent(state: ChecklistStateFile, source: TFile): string {
    const lines = [
        '---', 'project_task_index: true', `source: ${JSON.stringify(state.source)}`, '---', '',
        `# Задачи — ${source.basename}`, '',
        `Источник: [[${state.source.replace(/\.md$/i, '')}|${source.basename}]]`, '',
        '> Этот список автоматически обновляется по исходному чеклисту. Время показано в местном часовом поясе.', ''
    ];
    const depths = new Map<string, number>();
    for (const entry of state.entries) {
        const depth = entry.parentId ? (depths.get(entry.parentId) ?? 0) + 1 : 0;
        depths.set(entry.id, depth);
        const status = entry.checked ? '✅' : '○';
        const completed = entry.completedAt ? ` · Завершено: ${localCompletionTime(entry.completedAt)}` :
            entry.checked ? ' · Завершено ранее, время неизвестно' : '';
        const link = checklistNoteLink(entry);
        const note = link ? ` · [[${link}|Заметка]]` : '';
        const stage = entry.kind === 'stage' ? '**' : '';
        lines.push(`${'  '.repeat(depth)}- ${status} ${stage}${entry.title}${stage} · ${entry.status}${completed}${note}`);
    }
    return `${lines.join('\n')}\n`;
}

function leadingNumber(title: string): string | undefined {
    return title.match(/^(?:Этап\s+)?(\d+(?:\.\d+)*)\.?\s/u)?.[1];
}

/** Reuse saved keys before building GitHub nodes. Text and file paths are not durable identities. */
function restoreTaskKeys(tasks: ProjectTask[], entries: ChecklistStateEntry[], lines: string[]): void {
    if (!entries.length) return;
    const oldStages = entries.filter(entry => entry.kind === 'stage');
    const oldGroups = entries.filter(entry => entry.kind === 'group');
    const oldTasks = entries.filter(entry => entry.kind === 'task');
    const claimed = new Set<string>();
    const idChanges = new Map<string, string>();
    for (const task of tasks) {
        if (task.section?.startsWith('Этап ')) {
            const stage = oldStages.find(entry => entry.title === task.section) ||
                oldStages.find(entry => leadingNumber(entry.title) && leadingNumber(entry.title) === leadingNumber(task.section!));
            task.sectionKey = task.sectionKey || stage?.id || `stage:${task.section}`;
        }
        let parentKey = task.sectionKey;
        for (const ancestor of task.checklistAncestors || []) {
            const number = leadingNumber(ancestor.title);
            const previous = oldGroups.find(entry => entry.parentId === parentKey &&
                (entry.title === ancestor.title || Boolean(number && number === leadingNumber(entry.title))));
            if (previous && !checklistNodeId(lines[ancestor.sourceLine] || '')) ancestor.id = previous.id.slice('group:'.length);
            parentKey = `group:${ancestor.id}`;
        }
        const parsedId = task.id;
        const kindPrefix = !task.section || task.section.startsWith('Этап ') || task.section === GITHUB_IMPORT_SECTION ? 'leaf:' : 'task:';
        const parsedKey = `${kindPrefix}${parsedId}`;
        const parentId = task.parentId ? idChanges.get(task.parentId) || task.parentId : undefined;
        const expectedParent = parentId ? `${kindPrefix}${parentId}` : parentKey;
        const candidates = oldTasks.filter(entry => !claimed.has(entry.id) &&
            entry.id.startsWith(kindPrefix) && entry.parentId === expectedParent &&
            (task.githubItemId
                ? entry.id === parsedKey || entry.githubItemId === task.githubItemId || entry.github?.itemId === task.githubItemId
                : !entry.githubItemId || entry.id === parsedKey));
        const number = leadingNumber(task.name);
        const sameTitle = candidates.filter(entry => entry.title === task.name);
        const sameNumber = number ? candidates.filter(entry => leadingNumber(entry.title) === number) : [];
        const exact = oldTasks.find(entry => !claimed.has(entry.id) &&
            (entry.id === `leaf:${parsedId}` || entry.id === `task:${parsedId}`));
        // Stored IDs are authoritative. Title/number matching is only a legacy migration fallback.
        const persistedId = readTaskMetadata(task.sourceText || '').id;
        const previous = exact || (!persistedId ? candidates.find(entry => entry.id === parsedKey) ||
            (sameTitle.length === 1 ? sameTitle[0] : sameTitle.find(entry => entry.sourceLine === task.sourceLine)) ||
            (sameNumber.length === 1 ? sameNumber[0] : sameNumber.find(entry => entry.sourceLine === task.sourceLine)) : undefined);
        if (previous) {
            claimed.add(previous.id);
            task.id = previous.id.replace(/^(leaf|task):/, '');
            idChanges.set(parsedId, task.id);
        }
        if (task.parentId) task.parentId = parentId;
    }
}

export class ChecklistStateStore {
    private static pending = new Map<string, Promise<void>>();
    private static cleanupWarnings = new Map<string, string>();
    private pending = ChecklistStateStore.pending;

    private notes: ChecklistNotes;

    constructor(private app: App) { this.notes = new ChecklistNotes(app); }

    async stages(scope: ProjectScopeDefinition): Promise<ProjectStage[]> {
        if (scope.sourceType !== 'file') return [];
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) return [];
        const state = await this.read(statePath(source), source.path);
        return parseChecklistStages(await this.app.vault.read(source), state.entries);
    }

    async renameNote(scope: ProjectScopeDefinition, oldPath: string, newPath: string): Promise<void> {
        if (scope.sourceType !== 'file') return;
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) return;
        const path = statePath(source);
        await this.locked(path, async () => {
            const state = await this.read(path, source.path);
            if (!state.entries.some(entry => entry.notePath === oldPath) && !Object.values(state.rootNotes || {}).includes(oldPath)) return;
            for (const entry of state.entries) if (entry.notePath === oldPath) entry.notePath = newPath;
            state.rootNotes = Object.fromEntries(Object.entries(state.rootNotes || {}).map(([id, notePath]) => [id, notePath === oldPath ? newPath : notePath]));
            state.pendingNoteArchives = state.pendingNoteArchives?.map(item => ({ ...item,
                destination: item.destination === oldPath ? newPath : item.destination }));
            state.pendingSectionMoves = state.pendingSectionMoves?.map(item => ({ ...item,
                path: item.path === oldPath ? newPath : item.path,
                destination: item.destination === oldPath ? newPath : item.destination }));
            await this.write(path, state);
        });
    }

    async renameSource(oldPath: string, source: TFile): Promise<void> {
        const oldBase = oldPath.replace(/\.md$/i, '');
        const oldStatePath = normalizePath(`${oldBase}.tasks.json`);
        const oldFile = this.app.vault.getAbstractFileByPath(oldStatePath);
        if (!(oldFile instanceof TFile)) return;
        const newStatePath = statePath(source);
        await this.locked(newStatePath, async () => {
            if (oldStatePath !== newStatePath && this.app.vault.getAbstractFileByPath(newStatePath)) {
                throw new Error(`Checklist state already exists at ${newStatePath}`);
            }
            const state = await this.read(oldStatePath, oldPath);
            const oldFolder = normalizePath(`${oldBase}.tasks`);
            const newFolder = noteFolder(source);
            const folder = this.app.vault.getAbstractFileByPath(oldFolder);
            const oldIndex = this.app.vault.getAbstractFileByPath(normalizePath(`${oldBase}.tasks.md`));
            const nextIndex = indexPath(source);
            if (oldIndex instanceof TFile && oldIndex.path !== nextIndex &&
                this.app.vault.getAbstractFileByPath(nextIndex)) {
                throw new Error(`Task index already exists at ${nextIndex}`);
            }
            if (folder && oldFolder !== newFolder) {
                if (this.app.vault.getAbstractFileByPath(newFolder)) throw new Error(`Task note folder already exists at ${newFolder}`);
                await this.app.vault.rename(folder, newFolder);
                for (const entry of state.entries) {
                    if (entry.notePath?.startsWith(`${oldFolder}/`)) {
                        entry.notePath = normalizePath(`${newFolder}/${entry.notePath.slice(oldFolder.length + 1)}`);
                    }
                }
                const movedPath = (path: string): string => path.startsWith(`${oldFolder}/`) ?
                    normalizePath(`${newFolder}/${path.slice(oldFolder.length + 1)}`) : path;
                state.rootNotes = Object.fromEntries(Object.entries(state.rootNotes || {}).map(([id, path]) => [id, movedPath(path)]));
                state.pendingNoteArchives = state.pendingNoteArchives?.map(item => ({ ...item, path: movedPath(item.path), destination: movedPath(item.destination) }));
                state.pendingSectionMoves = state.pendingSectionMoves?.map(item => ({ ...item, path: movedPath(item.path), destination: movedPath(item.destination) }));
            }
            state.source = source.path;
            if (oldStatePath !== newStatePath) await this.app.vault.rename(oldFile, newStatePath);
            if (oldIndex instanceof TFile && oldIndex.path !== nextIndex) {
                const content = await this.app.vault.read(oldIndex);
                if (/^---\r?\nproject_task_index: true\r?\n/.test(content)) await this.app.vault.rename(oldIndex, nextIndex);
            }
            await this.write(newStatePath, state);
        });
    }

    private async locked<T>(path: string, action: () => Promise<T>): Promise<T> {
        const prior = this.pending.get(path) || Promise.resolve();
        const current = prior.catch(() => undefined).then(action);
        const done = current.then(() => undefined, () => undefined);
        this.pending.set(path, done);
        try { return await current; }
        finally { if (this.pending.get(path) === done) this.pending.delete(path); }
    }

    private async read(path: string, source: string): Promise<ChecklistStateFile> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return { schemaVersion: 1, source, entries: [] };
        const parsed: unknown = JSON.parse(await this.app.vault.read(file));
        if (!parsed || typeof parsed !== 'object' || (parsed as ChecklistStateFile).schemaVersion !== 1 ||
            !Array.isArray((parsed as ChecklistStateFile).entries) || (parsed as ChecklistStateFile).source !== source) {
            throw new Error(`Unsupported or invalid checklist state: ${path}`);
        }
        return parsed as ChecklistStateFile;
    }

    private async persist(path: string, state: ChecklistStateFile): Promise<void> {
        const content = `${JSON.stringify(state, null, 2)}\n`;
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            if (await this.app.vault.read(existing) !== content) await this.app.vault.modify(existing, content);
        } else await this.app.vault.create(path, content);
    }

    private async write(path: string, state: ChecklistStateFile, overrides = new Map<string, string>(), ready = false, expected?: Map<string, string>): Promise<Map<string, string>> {
        const source = this.app.vault.getAbstractFileByPath(state.source);
        if (!(source instanceof TFile)) throw new Error(`Checklist source is missing: ${state.source}`);
        const markdownPath = indexPath(source);
        const index = this.app.vault.getAbstractFileByPath(markdownPath);
        if (index instanceof TFile && !/^---\r?\nproject_task_index: true\r?\n/.test(await this.app.vault.read(index))) {
            throw new Error(`Refusing to overwrite an unrelated note: ${markdownPath}`);
        }
        const descriptions = ready ? new Map<string, string>() : await this.notes.sync(source, state, overrides, expected);
        await this.persist(path, state);
        const markdown = indexContent(state, source);
        if (index instanceof TFile) {
            if (await this.app.vault.read(index) !== markdown) await this.app.vault.modify(index, markdown);
        } else await this.app.vault.create(markdownPath, markdown);
        // Cleanup is retryable and happens only after destinations and state links are durable.
        if (await this.notes.archiveLegacy(source, state)) await this.persist(path, state);
        const cleanupPending = [...state.pendingNoteArchives || [], ...state.pendingSectionMoves || []];
        if (cleanupPending.length) {
            const warningKey = cleanupPending.map(item => item.path).sort().join('\n');
            if (ChecklistStateStore.cleanupWarnings.get(path) !== warningKey) {
                ChecklistStateStore.cleanupWarnings.set(path, warningKey);
                new Notice('Некоторые прежние описания изменились во время переноса. Исходные заметки сохранены; сравните их с общими заметками этапов перед архивированием.', 12000);
            }
        } else ChecklistStateStore.cleanupWarnings.delete(path);
        return descriptions;
    }

    async reconcile(scope: ProjectScopeDefinition, tasks: ProjectTask[]): Promise<ProjectTask[]> {
        if (scope.sourceType !== 'file') return tasks;
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) return tasks;
        const path = statePath(source);
        return this.locked(path, async () => {
            const old = await this.read(path, source.path);
            const oldById = new Map(old.entries.map(entry => [entry.id, entry]));
            const oldByPosition = new Map(old.entries.filter(entry => entry.sourceLine !== undefined)
                .map(entry => [`${entry.kind}:${entry.sourceLine}`, entry]));
            const parsedSource = await this.app.vault.read(source);
            restoreTaskKeys(tasks, old.entries, parsedSource.split('\n'));
            if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('Duplicate task ID. Remove the copied metadata ID before syncing.');
            const blockIds = tasks.map(task => task.blockId).filter(Boolean);
            if (new Set(blockIds).size !== blockIds.length) throw new Error('Duplicate task block ID. Give copied rows unique anchors before syncing.');
            const columns = scope.statuses.split(',').map(value => value.trim()).filter(Boolean);
            const done = columns.at(-1) || 'Done';
            const stages = parseChecklistStages(parsedSource, old.entries);
            if (new Set(stages.map(stage => stage.id)).size !== stages.length) throw new Error('Duplicate stage ID. Remove the copied project-node marker before syncing.');
            const native = nativeChecklistNodes(tasks, stages);
            const entries: ChecklistStateEntry[] = [];
            const leafIds = new Set<string>();
            const summaries = new Map<string, { total: number; done: number }>();
            const ancestorLines = new Map<string, number>();
            const descendants = new Map<string, ProjectTask[]>();
            for (const task of tasks) {
                const keys = [task.section ? (task.sectionKey || `stage:${task.section}`) : '',
                    ...(task.checklistAncestors || []).map(ancestor => {
                        const key = `group:${ancestor.id}`;
                        if (ancestorLines.has(key) && ancestorLines.get(key) !== ancestor.sourceLine) throw new Error('Duplicate group ID. Remove the copied project-node marker before syncing.');
                        ancestorLines.set(key, ancestor.sourceLine);
                        return key;
                    })].filter(Boolean);
                for (const key of keys) {
                    const children = descendants.get(key) || [];
                    children.push(task);
                    descendants.set(key, children);
                    const summary = summaries.get(key) || { total: 0, done: 0 };
                    summary.total++;
                    if (task.status === done) summary.done++;
                    summaries.set(key, summary);
                }
            }
            for (const node of native) {
                if (node.task) leafIds.add(node.task.id);
                const summary = summaries.get(node.key);
                const checked = node.task ? node.task.status === done : Boolean(summary?.total && summary.total === summary.done);
                const byPosition = oldByPosition.get(`${node.kind === 'leaf' ? 'task' : node.kind}:${node.task?.sourceLine ?? -1}`);
                const previous = oldById.get(node.key) || (node.task &&
                    (oldById.get(`leaf:${node.task.id}`) || oldById.get(`task:${node.task.id}`))) || (node.task && !readTaskMetadata(node.task.sourceText || '').id && byPosition?.title === node.title &&
                    byPosition.parentId === node.parentKey ? byPosition : undefined);
                const binding = scope.githubNativeItems?.[node.key];
                entries.push({
                    id: node.key, kind: node.kind === 'leaf' ? 'task' : node.kind,
                    parentId: node.parentKey, title: node.title,
                    status: node.task?.status || aggregateChecklistStatus(descendants.get(node.key) || [], columns),
                    checked, completedAt: checked ? (node.task?.completedAt ??
                        (previous?.checked ? previous.completedAt : previous ? new Date().toISOString() : null)) : null,
                    sourceLine: node.task?.sourceLine ?? ancestorLines.get(node.key) ?? stages.find(stage => stage.id === node.key)?.sourceLine,
                    githubItemId: node.task?.githubItemId,
                    stage: node.stage, priority: node.task?.priority, tags: node.task?.tags,
                    startDate: node.task?.startDate, dueDate: node.task?.endDate,
                    estimateSeconds: node.task?.timeEstimatedSec,
                    timeSpentSeconds: node.task?.timeSpentSec, habitName: node.task?.habitName,
                    cover: node.task?.cover, color: node.task?.color,
                    archived: node.task?.archived, order: node.task?.order,
                    notePath: previous?.notePath, noteAnchor: previous?.noteAnchor, noteRootId: previous?.noteRootId,
                    github: binding ? { ...previous?.github, itemId: binding.itemId, issueId: binding.issueId,
                        url: binding.url } : previous?.github
                });
            }
            for (const task of tasks) {
                if (leafIds.has(task.id)) continue;
                const id = `task:${task.id}`;
                const byPosition = oldByPosition.get(`task:${task.sourceLine}`);
                const previous = oldById.get(id) || oldById.get(`leaf:${task.id}`) || (!readTaskMetadata(task.sourceText || '').id && byPosition?.title === task.name &&
                    byPosition.parentId === (task.parentId ? `task:${task.parentId}` : undefined) ? byPosition : undefined);
                const checked = task.status === done;
                entries.push({ id, kind: 'task', parentId: task.parentId ? `task:${task.parentId}` : undefined,
                    title: task.name, status: task.status, checked,
                    completedAt: checked ? (task.completedAt ??
                        (previous?.checked ? previous.completedAt : previous ? new Date().toISOString() : null)) : null,
                    sourceLine: task.sourceLine, stage: task.section, priority: task.priority, tags: task.tags,
                    githubItemId: task.githubItemId,
                    startDate: task.startDate, dueDate: task.endDate, estimateSeconds: task.timeEstimatedSec,
                    timeSpentSeconds: task.timeSpentSec, habitName: task.habitName,
                    cover: task.cover, color: task.color, archived: task.archived, order: task.order,
                    notePath: previous?.notePath, noteAnchor: previous?.noteAnchor, noteRootId: previous?.noteRootId, github: previous?.github });
            }
            const taskById = new Map(tasks.map(task => [task.id, task]));
            const nextState: ChecklistStateFile = { ...old, schemaVersion: 1, source: source.path, entries };
            if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate task or heading ID. Give copied rows unique IDs before syncing.');
            for (const entry of entries) {
                const task = entry.kind === 'task' ? taskById.get(entry.id.replace(/^(leaf|task):/, '')) : undefined;
                if (task) {
                    task.completedAt = entry.completedAt;
                }
            }
            // Keep existing inline completion metadata in step with manual checkbox changes.
            // Otherwise reopening in Markdown leaves an old timestamp that wins on re-completion.
            const updateCompletion = (content: string): string => {
                const lines = content.split('\n');
                const contentLines = markdownContentLines(lines);
                for (const task of tasks) {
                    const index = task.blockId ? lines.findIndex((line, row) => contentLines[row] && blockIdFromTaskLine(line) === task.blockId) : task.sourceLine ?? -1;
                    const line = lines[index];
                    if (!line || task.sourceText !== undefined && line !== task.sourceText || taskDisplayTitle(line.replace(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*/, '')) !== task.name) throw new Error('Task changed while loading the project. Refresh before syncing.');
                    const metadata = readTaskMetadata(line);

                    if (!metadata.id || !task.blockId || (metadata.completedAt ?? null) !== (task.completedAt ?? null)) {
                        task.blockId = task.blockId || newTaskBlockId(lines.join('\n'));
                        const anchored = blockIdFromTaskLine(line) ? line : `${line.trimEnd()} ^${task.blockId}`;
                        lines[index] = replaceTaskMetadata(anchored, { ...metadata, id: task.id, completedAt: task.completedAt ?? null });
                    }
                }
                for (const entry of entries.filter(entry => entry.kind !== 'task')) {
                    const index = entry.sourceLine ?? -1;
                    const line = lines[index];
                    if (!line) throw new Error('Project heading moved. Refresh the project.');
                    const currentId = checklistNodeId(line);
                    if (currentId && currentId !== entry.id) throw new Error('Project heading ID changed during loading. Refresh the project.');
                    const title = entry.kind === 'stage' ? stripChecklistNodeId(line).replace(/^##[ \t]+/, '').trim() : taskDisplayTitle(line.replace(/^[ \t]*-[ \t]+/, ''));
                    if (title !== entry.title) throw new Error('Project heading changed while preserving its identity. Refresh the project.');
                    lines[index] = withChecklistNodeId(line, entry.id);
                }
                for (const task of tasks) {
                    const index = lines.findIndex((line, row) => contentLines[row] && readTaskMetadata(line).id === task.id);
                    if (index >= 0) { task.sourceLine = index; task.sourceText = lines[index]; task.sourceBlock = lines.slice(index, findTaskBlockEnd(lines, index, task.indent || 0)).join('\n'); }
                }
                const byLine = new Map(tasks.map(task => [task.sourceLine, task]));
                for (const task of tasks) for (const subtask of task.subtasks || []) {
                    const child = byLine.get(subtask.line);
                    if (child?.parentId !== task.id) continue;
                    subtask.sourceText = child.sourceText;
                    subtask.blockId = child.blockId;
                }
                return lines.join('\n');
            };
            const sourceContent = parsedSource;
            const nextSource = updateCompletion(sourceContent);
            if (nextSource !== sourceContent) await this.app.vault.process(source, current => {
                if (current !== sourceContent) throw new Error('Checklist changed during migration. Refresh and try again.');
                return nextSource;
            });
            const descriptions = await this.notes.sync(source, nextState);
            for (const entry of entries) {
                const task = entry.kind === 'task' ? taskById.get(entry.id.replace(/^(leaf|task):/, '')) : undefined;
                if (task) {
                    task.description = descriptions.get(entry.id) || '';
                    task.notePath = entry.notePath;
                    task.noteAnchor = entry.noteAnchor;
                    task.noteRootId = entry.noteRootId;
                }
            }
            await this.write(path, nextState, new Map(), true);
            return tasks;
        });
    }

    async saveDescription(scope: ProjectScopeDefinition, task: ProjectTask, description: string, expected = task.description || ''): Promise<void> {
        if (scope.sourceType !== 'file') return;
        const path = statePath(task.file);
        await this.locked(path, async () => {
            const state = await this.read(path, task.file.path);
            const entry = state.entries.find(candidate => candidate.id === `leaf:${task.id}` || candidate.id === `task:${task.id}`);
            if (!entry) throw new Error(`Checklist task is missing from state: ${task.name}`);
            await this.write(path, state, new Map([[entry.id, description]]), false, new Map([[entry.id, expected]]));
        });
    }

    async descriptions(scope: ProjectScopeDefinition): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        if (scope.sourceType !== 'file') return result;
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) return result;
        const state = await this.read(statePath(source), source.path);
        return this.notes.descriptions(state);
    }

    async noteLink(scope: ProjectScopeDefinition, key: string): Promise<string | undefined> {
        if (scope.sourceType !== 'file') return undefined;
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) return undefined;
        const state = await this.read(statePath(source), source.path);
        const entry = state.entries.find(candidate => candidate.id === key);
        return entry ? checklistNoteLink(entry) : undefined;
    }

    async saveNodeDescription(scope: ProjectScopeDefinition, key: string, description: string, expected?: string): Promise<void> {
        return this.saveNodeDescriptions(scope, new Map([[key, description]]), expected === undefined ? undefined : new Map([[key, expected]]));
    }

    async saveNodeDescriptions(scope: ProjectScopeDefinition, descriptions: Map<string, string>, expected?: Map<string, string>): Promise<void> {
        if (scope.sourceType !== 'file' || !descriptions.size) return;
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) throw new Error('Checklist source is missing.');
        const path = statePath(source);
        await this.locked(path, async () => {
            const state = await this.read(path, source.path);
            for (const id of descriptions.keys()) {
                if (!state.entries.some(entry => entry.id === id)) throw new Error(`Checklist node is missing from state: ${id}`);
            }
            await this.write(path, state, descriptions, false, expected);
        });
    }

    async recordGitHub(scope: ProjectScopeDefinition, items: GitHubItem[], pulledCompletionIds: Set<string> = new Set()): Promise<void> {
        if (scope.sourceType !== 'file') return;
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) return;
        const path = statePath(source);
        await this.locked(path, async () => {
            const state = await this.read(path, source.path);
            const byId = new Map(items.map(item => [item.id, item]));
            for (const entry of state.entries) {
                const binding = scope.githubNativeItems?.[entry.id];
                if (!binding) continue;
                const item = byId.get(binding.itemId);
                if (!item) continue;
                entry.github = {
                    itemId: binding.itemId, issueId: binding.issueId, url: binding.url,
                    fields: item.fields, number: item.issueNumber, state: item.issueState,
                    closedAt: item.closedAt, createdAt: item.createdAt, updatedAt: item.updatedAt,
                    assignees: item.assignees, labels: item.labels, milestone: item.milestone,
                    issueType: item.issueType, subIssues: item.subIssues,
                    parentIssueId: item.parentIssueId, archived: item.archived
                };
                if (entry.kind === 'task' && entry.checked && item.closedAt &&
                    (!entry.completedAt || pulledCompletionIds.has(entry.id))) {
                    entry.completedAt = item.closedAt;
                }
            }
            await this.write(path, state);
        });
    }
}
