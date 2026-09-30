import { App, normalizePath, parseYaml, stringifyYaml, TFile } from 'obsidian';
import type { ProjectScopeDefinition, ProjectTask } from './types';
import { nativeChecklistNodes } from './native-checklist';
import type { GitHubItem } from './github-client';

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

interface ChecklistStateFile {
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

function noteFilename(id: string, title: string): string {
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const slug = title.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, '-').slice(0, 48) || 'task';
    return `${slug}-${(hash >>> 0).toString(16)}.md`;
}

function noteBody(content: string): string {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)?/);
    return match ? content.slice(match[0].length).trim() : content.trim();
}

function noteContent(entry: ChecklistStateEntry, body: string, source: string, existing = ''): string {
    const oldYaml = existing.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    const parsed: unknown = oldYaml ? parseYaml(oldYaml[1] || '') : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Invalid frontmatter in task note: ${entry.notePath}`);
    }
    const frontmatter: Record<string, unknown> = { ...(parsed as Record<string, unknown>),
        project_task_id: entry.id, source, title: entry.title, kind: entry.kind,
        parent_id: entry.parentId || null, status: entry.status,
        completed_at: entry.completedAt,
        completed_local: entry.completedAt ? localCompletionTime(entry.completedAt) : null,
        priority: entry.priority || null,
        tags: entry.tags || null, start_date: entry.startDate || null,
        due_date: entry.dueDate || null, estimate_seconds: entry.estimateSeconds || null,
        time_spent_seconds: entry.timeSpentSeconds || 0,
        habit_name: entry.habitName || null, cover: entry.cover || null,
        color: entry.color || null, archived: Boolean(entry.archived),
        stage: entry.stage || null, source_line: entry.sourceLine ?? null,
        github: entry.github || null
    };
    return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

function localCompletionTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const two = (value: number) => String(value).padStart(2, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes < 0 ? '-' : '+';
    const offset = `${sign}${two(Math.floor(Math.abs(offsetMinutes) / 60))}:${two(Math.abs(offsetMinutes) % 60)}`;
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
        `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())} ${offset}`;
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
        const note = entry.notePath ? ` · [[${entry.notePath.replace(/\.md$/i, '')}|Заметка]]` : '';
        const stage = entry.kind === 'stage' ? '**' : '';
        lines.push(`${'  '.repeat(depth)}- ${status} ${stage}${entry.title}${stage} · ${entry.status}${completed}${note}`);
    }
    return `${lines.join('\n')}\n`;
}

function leadingNumber(title: string): string | undefined {
    return title.match(/^(?:Этап\s+)?(\d+(?:\.\d+)*)\.?\s/u)?.[1];
}

/** Reuse saved keys before building GitHub nodes. Text and file paths are not durable identities. */
function restoreTaskKeys(tasks: ProjectTask[], entries: ChecklistStateEntry[]): void {
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
            task.sectionKey = stage?.id || `stage:${task.section}`;
        }
        let parentKey = task.sectionKey;
        for (const ancestor of task.checklistAncestors || []) {
            const number = leadingNumber(ancestor.title);
            const previous = oldGroups.find(entry => entry.parentId === parentKey &&
                (entry.title === ancestor.title || Boolean(number && number === leadingNumber(entry.title))));
            if (previous) ancestor.id = previous.id.slice('group:'.length);
            parentKey = `group:${ancestor.id}`;
        }
        const parsedId = task.id;
        const kindPrefix = task.section?.startsWith('Этап ') ? 'leaf:' : 'task:';
        const parsedKey = `${kindPrefix}${parsedId}`;
        const parentId = task.parentId ? idChanges.get(task.parentId) || task.parentId : undefined;
        const expectedParent = parentId ? `${kindPrefix}${parentId}` : parentKey;
        const candidates = oldTasks.filter(entry => !claimed.has(entry.id) &&
            entry.id.startsWith(kindPrefix) && entry.parentId === expectedParent);
        const number = leadingNumber(task.name);
        const sameTitle = candidates.filter(entry => entry.title === task.name);
        const sameNumber = number ? candidates.filter(entry => leadingNumber(entry.title) === number) : [];
        const previous = candidates.find(entry => entry.id === parsedKey) ||
            (sameTitle.length === 1 ? sameTitle[0] : sameTitle.find(entry => entry.sourceLine === task.sourceLine)) ||
            (sameNumber.length === 1 ? sameNumber[0] : sameNumber.find(entry => entry.sourceLine === task.sourceLine));
        if (previous) {
            claimed.add(previous.id);
            task.id = previous.id.slice(kindPrefix.length);
            idChanges.set(parsedId, task.id);
        }
        if (task.parentId) task.parentId = parentId;
    }
}

export class ChecklistStateStore {
    private pending = new Map<string, Promise<void>>();

    constructor(private app: App) {}

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

    private async write(path: string, state: ChecklistStateFile): Promise<void> {
        const content = `${JSON.stringify(state, null, 2)}\n`;
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) {
            if (await this.app.vault.read(existing) !== content) await this.app.vault.modify(existing, content);
        } else await this.app.vault.create(path, content);
        const source = this.app.vault.getAbstractFileByPath(state.source);
        if (!(source instanceof TFile)) return;
        const markdownPath = indexPath(source);
        const markdown = indexContent(state, source);
        const index = this.app.vault.getAbstractFileByPath(markdownPath);
        if (index instanceof TFile) {
            const current = await this.app.vault.read(index);
            if (!/^---\r?\nproject_task_index: true\r?\n/.test(current)) {
                throw new Error(`Refusing to overwrite an unrelated note: ${markdownPath}`);
            }
            if (current !== markdown) await this.app.vault.modify(index, markdown);
        } else await this.app.vault.create(markdownPath, markdown);
    }

    private async updateNote(entry: ChecklistStateEntry, source: string, description?: string): Promise<string | undefined> {
        if (!entry.notePath && !description?.trim()) return undefined;
        const sourceFile = this.app.vault.getAbstractFileByPath(source);
        if (!(sourceFile instanceof TFile)) throw new Error(`Checklist source is missing: ${source}`);
        const folder = noteFolder(sourceFile);
        const path = entry.notePath || normalizePath(`${folder}/${noteFilename(entry.id, entry.title)}`);
        const existing = this.app.vault.getAbstractFileByPath(path);
        const current = existing instanceof TFile ? await this.app.vault.read(existing) : '';
        const body = description !== undefined ? description.trim() :
            existing instanceof TFile ? noteBody(current) : '';
        const content = noteContent(entry, body, source, current);
        if (existing instanceof TFile) {
            if (current !== content) await this.app.vault.modify(existing, content);
        } else {
            if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
            await this.app.vault.create(path, content);
        }
        return path;
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
            restoreTaskKeys(tasks, old.entries);
            const done = scope.statuses.split(',').map(value => value.trim()).filter(Boolean).at(-1) || 'Done';
            const native = nativeChecklistNodes(tasks);
            const entries: ChecklistStateEntry[] = [];
            const leafIds = new Set<string>();
            const summaries = new Map<string, { total: number; done: number }>();
            const ancestorLines = new Map<string, number>();
            for (const task of tasks) {
                const keys = [task.section ? (task.sectionKey || `stage:${task.section}`) : '',
                    ...(task.checklistAncestors || []).map(ancestor => {
                        const key = `group:${ancestor.id}`;
                        ancestorLines.set(key, ancestor.sourceLine);
                        return key;
                    })].filter(Boolean);
                for (const key of keys) {
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
                const previous = oldById.get(node.key) || (byPosition?.title === node.title &&
                    byPosition.parentId === node.parentKey ? byPosition : undefined);
                const binding = scope.githubNativeItems?.[node.key];
                entries.push({
                    id: node.key, kind: node.kind === 'leaf' ? 'task' : node.kind,
                    parentId: node.parentKey, title: node.title,
                    status: node.task?.status || (checked ? done : scope.statuses.split(',')[0]?.trim() || 'Backlog'),
                    checked, completedAt: checked ? (previous?.checked ? previous.completedAt : previous ? new Date().toISOString() : null) : null,
                    sourceLine: node.task?.sourceLine ?? ancestorLines.get(node.key),
                    stage: node.stage, priority: node.task?.priority, tags: node.task?.tags,
                    startDate: node.task?.startDate, dueDate: node.task?.endDate,
                    estimateSeconds: node.task?.timeEstimatedSec,
                    timeSpentSeconds: node.task?.timeSpentSec, habitName: node.task?.habitName,
                    cover: node.task?.cover, color: node.task?.color,
                    archived: node.task?.archived, order: node.task?.order,
                    notePath: previous?.notePath,
                    github: binding ? { ...previous?.github, itemId: binding.itemId, issueId: binding.issueId,
                        url: binding.url } : previous?.github
                });
            }
            for (const task of tasks) {
                if (leafIds.has(task.id)) continue;
                const id = `task:${task.id}`;
                const byPosition = oldByPosition.get(`task:${task.sourceLine}`);
                const previous = oldById.get(id) || (byPosition?.title === task.name &&
                    byPosition.parentId === (task.parentId ? `task:${task.parentId}` : undefined) ? byPosition : undefined);
                const checked = task.status === done;
                entries.push({ id, kind: 'task', parentId: task.parentId ? `task:${task.parentId}` : undefined,
                    title: task.name, status: task.status, checked,
                    completedAt: checked ? (previous?.checked ? previous.completedAt : previous ? new Date().toISOString() : null) : null,
                    sourceLine: task.sourceLine, stage: task.section, priority: task.priority, tags: task.tags,
                    startDate: task.startDate, dueDate: task.endDate, estimateSeconds: task.timeEstimatedSec,
                    timeSpentSeconds: task.timeSpentSec, habitName: task.habitName,
                    cover: task.cover, color: task.color, archived: task.archived, order: task.order,
                    notePath: previous?.notePath, github: previous?.github });
            }
            const taskById = new Map(tasks.map(task => [task.id, task]));
            for (const entry of entries) {
                if (!entry.notePath) continue;
                const note = this.app.vault.getAbstractFileByPath(entry.notePath);
                if (note instanceof TFile) {
                    const description = noteBody(await this.app.vault.read(note));
                    const task = taskById.get(entry.id.replace(/^(leaf|task):/, ''));
                    if (task) { task.description = description; task.notePath = entry.notePath; }
                    await this.updateNote(entry, source.path);
                } else entry.notePath = undefined;
            }
            for (const entry of entries) {
                const task = taskById.get(entry.id.replace(/^(leaf|task):/, ''));
                if (task) task.completedAt = entry.completedAt;
            }
            await this.write(path, { schemaVersion: 1, source: source.path, entries });
            return tasks;
        });
    }

    async saveDescription(scope: ProjectScopeDefinition, task: ProjectTask, description: string): Promise<void> {
        if (scope.sourceType !== 'file') return;
        const path = statePath(task.file);
        await this.locked(path, async () => {
            const state = await this.read(path, task.file.path);
            const entry = state.entries.find(candidate => candidate.id === `leaf:${task.id}` || candidate.id === `task:${task.id}` ||
                candidate.kind === 'task' && candidate.sourceLine === task.sourceLine);
            if (!entry) throw new Error(`Checklist task is missing from state: ${task.name}`);
            entry.notePath = await this.updateNote(entry, task.file.path, description);
            await this.write(path, state);
        });
    }

    async descriptions(scope: ProjectScopeDefinition): Promise<Map<string, string>> {
        const result = new Map<string, string>();
        if (scope.sourceType !== 'file') return result;
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) return result;
        const state = await this.read(statePath(source), source.path);
        for (const entry of state.entries) {
            if (!entry.notePath) continue;
            const note = this.app.vault.getAbstractFileByPath(entry.notePath);
            if (note instanceof TFile) result.set(entry.id, noteBody(await this.app.vault.read(note)));
        }
        return result;
    }

    async saveNodeDescription(scope: ProjectScopeDefinition, key: string, description: string): Promise<void> {
        if (scope.sourceType !== 'file') return;
        const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
        if (!(source instanceof TFile)) return;
        const path = statePath(source);
        await this.locked(path, async () => {
            const state = await this.read(path, source.path);
            const entry = state.entries.find(candidate => candidate.id === key);
            if (!entry) throw new Error(`Checklist node is missing from state: ${key}`);
            entry.notePath = await this.updateNote(entry, source.path, description);
            await this.write(path, state);
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
                if (entry.notePath) await this.updateNote(entry, source.path);
            }
            await this.write(path, state);
        });
    }
}
