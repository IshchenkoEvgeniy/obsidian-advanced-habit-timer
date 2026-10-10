import { App, TFile } from 'obsidian';
import type HabitTimerPlugin from '../main';
import { renameProjectCovers } from './image-renames';
import type { ProjectScopeDefinition, ProjectTask, ProjectSubtask, TaskData } from './types';
import { markdownContentLines, maskMarkdownCodeSpans } from './engine/markdown-lines';
import { ProjectCache } from './engine/cache';
import { ProjectParser } from './engine/parser';
import { ProjectMutator, type TaskWriteResult } from './engine/mutator';
import { ChecklistStateStore } from './checklist-state';
import type { GitHubItem } from './github-client';
import { addChecklistGroupChild, addChecklistSubtask } from './structured-editor';
import { projectTaskToData } from './task-data';
import { GITHUB_IMPORT_SECTION, PROJECT_ROOT_HEADING } from './native-checklist';
import { validateTaskData } from './task-validation';
import { readTaskMetadata } from './engine/task-metadata';
import { validateTaskDescription } from './description-validation';

export type TaskPlacement =
    | { kind: 'root' }
    | { kind: 'stage'; section: string }
    | { kind: 'task'; parent: ProjectTask }
    | { kind: 'group'; parent: { id: string; title: string; sourceLine: number }; task: ProjectTask };

export class ProjectDataEngine {
    private cache: ProjectCache;
    private parser: ProjectParser;
    private mutator: ProjectMutator;
    private checklistState: ChecklistStateStore;
    private legacyImportChecked = new Map<string, number>();

    constructor(public app: App, public plugin: HabitTimerPlugin) {
        this.cache = new ProjectCache();
        this.parser = new ProjectParser(app, this.cache);
        this.mutator = new ProjectMutator(app, plugin, this.parser);
        this.checklistState = new ChecklistStateStore(app);
    }

    async renameChecklistSource(oldPath: string, source: TFile): Promise<void> {
        this.legacyImportChecked.delete(oldPath);
        this.legacyImportChecked.delete(source.path);
        await this.checklistState.renameSource(oldPath, source);
    }

    async renameChecklistNote(oldPath: string, file: TFile): Promise<void> {
        for (const scope of this.plugin.settings.projectScopes || []) {
            await this.checklistState.renameNote(scope, oldPath, file.path);
        }
    }

    /** Remove one entry (call on file rename/delete). */
    invalidateCacheEntry(path: string) {
        this.cache.invalidateCacheEntry(path);
        this.legacyImportChecked.delete(path);
    }

    /** Remove all entries whose paths start with a prefix (call on folder delete). */
    invalidateCachePrefix(prefix: string) {
        this.cache.invalidateCachePrefix(prefix);
        for (const path of this.legacyImportChecked.keys()) {
            if (path.startsWith(prefix)) this.legacyImportChecked.delete(path);
        }
    }

    async loadTasks(scope: ProjectScopeDefinition): Promise<ProjectTask[]> {
        if (scope.sourceType === 'file') {
            const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
            if (source instanceof TFile && this.legacyImportChecked.get(source.path) !== source.stat.mtime) {
                const content = await this.app.vault.read(source);
                const legacyHeading = new RegExp(`^##[ \\t]+${GITHUB_IMPORT_SECTION}$`, 'gm');
                if (legacyHeading.test(content)) {
                    const lines = content.split('\n');
                    const index = lines.findIndex(line => line.trim() === `## ${GITHUB_IMPORT_SECTION}`);
                    const end = lines.findIndex((line, row) => row > index && /^#{1,2}[ \t]+/.test(line));
                    const section = lines.slice(index + 1, end < 0 ? undefined : end);
                    const tasks = section.filter(line => /^[ \t]*-[ \t]+\[[ xX]\]/.test(line));
                    const safeToRename = index >= 0 && !content.includes(`# ${PROJECT_ROOT_HEADING}`) &&
                        tasks.every(line => /\s\^ht-[A-Za-z0-9-]+\s*$/.test(line) &&
                            !/<!-- github-project-item:/.test(line) &&
                            !/^[ \t]*-[ \t]+\[[ xX]\][ \t]*\*{0,2}\d+(?:\.\d+)+/.test(line));
                    if (safeToRename) {
                        lines[index] = `# ${PROJECT_ROOT_HEADING}`;
                        await this.app.vault.process(source, current => {
                            if (current !== content) throw new Error('Checklist changed during migration. Refresh and try again.');
                            return lines.join('\n');
                        });
                        this.cache.invalidateCacheEntry(source.path);
                    }
                }
                this.legacyImportChecked.set(source.path, source.stat.mtime);
            }
        }
        const parsed = await this.parser.loadTasks(scope);
        return this.checklistState.reconcile(scope, parsed.map(task => ({ ...task,
            subtasks: task.subtasks?.map(subtask => ({ ...subtask })),
            checklistAncestors: task.checklistAncestors?.map(ancestor => ({ ...ancestor })) })));
    }

    async loadStages(scope: ProjectScopeDefinition) { return this.checklistState.stages(scope); }

    async saveTaskDescription(scope: ProjectScopeDefinition, task: ProjectTask, description: string, expected = task.description || ''): Promise<void> {
        description = validateTaskDescription(description);
        if (scope.sourceType === 'file') {
            await this.checklistState.saveDescription(scope, task, description, expected);
        } else {
            await this.app.vault.process(task.file, content => {
            const start = '<!-- project-description:start -->';
            const end = '<!-- project-description:end -->';
            const block = `${start}\n${description.trim()}\n${end}`;
            const pattern = /<!-- project-description:start -->[\s\S]*?<!-- project-description:end -->/;
            const current = content.match(/<!-- project-description:start -->\r?\n([\s\S]*?)\r?\n<!-- project-description:end -->/)?.[1]?.trim() || '';
            if (current !== expected.trim()) throw new Error('Description changed while editing. Refresh before saving.');
            const updated = pattern.test(content) ? content.replace(pattern, () => block) : `${content.trimEnd()}\n\n${block}\n`;
            return updated;
            });
        }
    }

    async saveEditedTask(scope: ProjectScopeDefinition, task: ProjectTask, data: TaskData, columns: string[]): Promise<void> {
        data = validateTaskData(data, columns, scope.sourceType !== 'file');
        if (scope.sourceType === 'file' && task.file.path !== scope.sourceValue.trim()) throw new Error('The task belongs to another project.');
        if (scope.sourceType === 'folder') {
            const folder = scope.sourceValue.trim().replace(/^\/+|\/+$/g, '');
            if (folder && !task.file.path.startsWith(`${folder}/`)) throw new Error('The task belongs to another project.');
        }
        if ((data.description || '').trim() !== (task.description || '').trim()) {
            const current = scope.sourceType === 'file' ? await this.checklistDescriptions(scope) : undefined;
            const description = current ? current.get(`leaf:${task.id}`) ?? current.get(`task:${task.id}`) ?? '' :
                (await this.app.vault.read(task.file)).match(/<!-- project-description:start -->\r?\n([\s\S]*?)\r?\n<!-- project-description:end -->/)?.[1]?.trim() || '';
            if (description !== (task.description || '').trim()) throw new Error('Description changed while editing. Refresh before saving task fields.');
        }
        const written = await this.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId, task.sourceLine);
        if (data.description !== task.description) {
            const refreshed = scope.sourceType === 'file' ? (await this.loadTasks(scope)).find(candidate =>
                candidate.blockId === written.blockId && candidate.file.path === written.file.path) : task;
            if (!refreshed) throw new Error('The edited task could not be located by its block ID.');
            await this.saveTaskDescription(scope, refreshed, data.description || '', task.description || '');
        }
    }

    async recordChecklistGitHub(scope: ProjectScopeDefinition, items: GitHubItem[], pulledCompletionIds?: Set<string>): Promise<void> {
        await this.checklistState.recordGitHub(scope, items, pulledCompletionIds);
    }

    async renameStatuses(scope: ProjectScopeDefinition, renames: Record<string, string>): Promise<void> {
        if (scope.sourceType === 'file') {
            const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
            if (!(source instanceof TFile)) throw new Error('Project source file not found.');
            // Rename the vocabulary in one write; intermediate headings must not orphan task state.
            await this.app.vault.process(source, content => {
                const lines = content.split('\n');
                const contentLines = markdownContentLines(lines);
                const maskedLines = maskMarkdownCodeSpans(content).split('\n');
                return lines.map((line, row) => {
                    if (!contentLines[row]) return line;
                    const masked = maskedLines[row]!;
                    const heading = masked.match(/^(#{1,6})[ \t]+(.*)$/);
                    if (heading && renames[heading[2]!.trim()]) return `${heading[1]} ${renames[heading[2]!.trim()]}`;
                    if (!/^[ \t]*-[ \t]+\[[ xX]\]/.test(masked)) return line;
                    return line.replace(/<!-- project-status: ([^>]+) -->/g, (marker: string, status: string, offset: number) =>
                        masked.slice(offset, offset + marker.length) === marker && renames[status.trim()]
                            ? `<!-- project-status: ${renames[status.trim()]} -->` : marker);
                }).join('\n');
            });
            scope.statuses = scope.statuses.split(',').map(value => renames[value.trim()] || value.trim()).join(', ');
            this.invalidateCacheEntry(source.path);
            return;
        }
        const oldTasks = await this.loadTasks(scope);
        for (const task of oldTasks) {
            const status = renames[task.status];
            if (status) {
                await this.app.fileManager.processFrontMatter(task.file, fm => {
                    const properties = fm as Record<string, unknown>;
                    const renamed = typeof properties.status === 'string' ? renames[properties.status] : undefined;
                    if (renamed) properties.status = renamed;
                });
                this.invalidateCacheEntry(task.file.path);
            }
        }
    }

    async checklistDescriptions(scope: ProjectScopeDefinition): Promise<Map<string, string>> {
        return this.checklistState.descriptions(scope);
    }

    async checklistNodeLink(scope: ProjectScopeDefinition, key: string): Promise<string | undefined> {
        return this.checklistState.noteLink(scope, key);
    }

    async saveChecklistNodeDescription(scope: ProjectScopeDefinition, key: string, description: string, expected?: string): Promise<void> {
        await this.checklistState.saveNodeDescription(scope, key, description, expected);
    }

    async saveChecklistDescriptions(scope: ProjectScopeDefinition, descriptions: Map<string, string>, expected?: Map<string, string>): Promise<void> {
        await this.checklistState.saveNodeDescriptions(scope, descriptions, expected);
    }

    async readTasksForStats(scope: ProjectScopeDefinition): Promise<ProjectTask[]> {
        return this.parser.loadTasks(scope);
    }

    async toggleSubtask(file: TFile, subtask: ProjectSubtask, checked: boolean): Promise<void> {
        return this.mutator.toggleSubtask(file, subtask, checked);
    }

    async addSubtask(file: TFile, text: string, isSingleFileTask?: boolean, taskName?: string): Promise<void> {
        return this.mutator.addSubtask(file, text, isSingleFileTask, taskName);
    }

    async saveTask(taskFile: TFile, data: TaskData, isSingleFileTask?: boolean, oldTaskName?: string, columns?: string[], blockId?: string, sourceLine?: number): Promise<TaskWriteResult> {
        let identity: ProjectTask | undefined;
        if (isSingleFileTask && oldTaskName) {
            const content = await this.app.vault.read(taskFile);
            const line = this.parser.findTaskLineIndex(content.split('\n'), oldTaskName, blockId, sourceLine).lineIdx;
            if (line < 0) throw new Error('The task moved or was deleted. Refresh the project.');
            if (!readTaskMetadata(content.split('\n')[line]!).id) {
                const scope = this.plugin.settings.projectScopes?.find(candidate => candidate.sourceType === 'file' &&
                    candidate.sourceValue.trim() === taskFile.path) || { id: taskFile.path, name: taskFile.basename,
                        sourceType: 'file' as const, sourceValue: taskFile.path, statuses: columns?.join(', ') || 'Backlog, Done' };
                identity = (await this.loadTasks(scope)).find(task => task.sourceLine === line);
            }
        }
        const written = await this.mutator.saveTask(taskFile, data, isSingleFileTask, oldTaskName, columns, blockId, sourceLine, identity);
        this.invalidateCacheEntry(written.file.path);
        return written;
    }

    async createTask(scope: ProjectScopeDefinition, data: Partial<TaskData>, placement: TaskPlacement = { kind: 'root' }): Promise<ProjectTask> {
        const columns = scope.statuses.split(',').map(value => value.trim()).filter(Boolean);
        data = validateTaskData({ ...data, status: data.status || columns[0] || 'Backlog' }, columns, scope.sourceType !== 'file');
        const name = data.name!;
        if (placement.kind === 'task' || placement.kind === 'group') {
            if (scope.sourceType !== 'file') throw new Error('Nested checklist tasks require a file project.');
            if ((placement.kind === 'task' ? placement.parent.file : placement.task.file).path !== scope.sourceValue.trim()) throw new Error('The parent task belongs to another project.');
        }
        const beforeTasks = await this.loadTasks(scope);
        const status = data.status!;
        const tags = data.tags;
        const next = { ...data, name, status, tags,
            section: data.section === GITHUB_IMPORT_SECTION ? undefined : data.section };
        let written: TaskWriteResult;
        if (scope.sourceType === 'file' && placement.kind === 'task') {
            written = { file: placement.parent.file, blockId: await addChecklistSubtask(this.app, placement.parent, beforeTasks, name) };
        } else if (scope.sourceType === 'file' && placement.kind === 'group') {
            written = { file: placement.task.file, blockId: await addChecklistGroupChild(this.app, placement.task.file, beforeTasks, placement.parent, name) };
        } else {
            if (placement.kind === 'stage') next.section = placement.section;
            written = await this.mutator.createTask(scope, next);
        }
        this.cache.invalidateCacheEntry(written.file.path);
        const created = (await this.loadTasks(scope)).find(task => task.file.path === written.file.path &&
            (!written.blockId || task.blockId === written.blockId));
        if (!created) throw new Error('The task was saved but is excluded by this project source or filter. Do not create it again.');
        if (placement.kind === 'task' || placement.kind === 'group') {
            const fields = projectTaskToData(created, seconds => this.plugin.formatTime(seconds), {
                ...next, name: created.name, section: created.section
            });
            await this.saveTask(created.file, fields, true, created.name,
                columns, created.blockId, created.sourceLine);
            this.cache.invalidateCacheEntry(scope.sourceValue.trim());
        }
        if (data.description?.trim()) {
            const refreshed = (await this.loadTasks(scope)).find(task => task.blockId === written.blockId && task.file.path === written.file.path) || created;
            await this.saveTaskDescription(scope, refreshed, data.description);
        }
        return (await this.loadTasks(scope)).find(task => task.file.path === written.file.path &&
            (!written.blockId || task.blockId === written.blockId)) || created;
    }

    async moveTaskBefore(scope: ProjectScopeDefinition, source: ProjectTask, target: ProjectTask): Promise<void> {
        return this.mutator.moveTaskBefore(scope, source, target);
    }

    async renameImageReferences(oldPath: string, file: TFile): Promise<void> {
        const files = new Map<string, TFile>();
        for (const scope of this.plugin.settings.projectScopes || []) {
            if (scope.sourceType === 'file') {
                const source = this.app.vault.getAbstractFileByPath(scope.sourceValue.trim());
                if (source instanceof TFile) files.set(source.path, source);
            } else {
                for (const task of await this.parser.loadTasks(scope)) files.set(task.file.path, task.file);
            }
        }
        await renameProjectCovers(this.app, [...files.values()], oldPath, file.path);
        for (const path of files.keys()) this.invalidateCacheEntry(path);
    }

    async moveTaskAfter(scope: ProjectScopeDefinition, source: ProjectTask, target: ProjectTask): Promise<void> {
        return this.mutator.moveTaskBefore(scope, source, target, true);
    }

    async deleteTask(task: ProjectTask, isSingleFileTask?: boolean): Promise<void> {
        return this.mutator.deleteTask(task, isSingleFileTask);
    }

    async deleteTasks(tasks: ProjectTask[], isSingleFileTask?: boolean): Promise<void> {
        return this.mutator.deleteTasks(tasks, isSingleFileTask);
    }

    async setArchived(task: ProjectTask, archived: boolean, isSingleFileTask?: boolean): Promise<void> {
        return this.mutator.setArchived(task, archived, isSingleFileTask);
    }

    async startTimerForTask(task: ProjectTask, isSingleFileTask?: boolean) {
        return this.mutator.startTimerForTask(task, isSingleFileTask);
    }
}
