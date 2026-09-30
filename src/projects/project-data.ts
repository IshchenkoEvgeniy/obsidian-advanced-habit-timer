import { App, TFile } from 'obsidian';
import HabitTimerPlugin from '../main';
import type { ProjectScopeDefinition, ProjectTask, TaskData } from './types';
import { ProjectCache } from './engine/cache';
import { ProjectParser } from './engine/parser';
import { ProjectMutator } from './engine/mutator';
import { ChecklistStateStore } from './checklist-state';
import type { GitHubItem } from './github-client';

export class ProjectDataEngine {
    private cache: ProjectCache;
    private parser: ProjectParser;
    private mutator: ProjectMutator;
    private checklistState: ChecklistStateStore;

    constructor(public app: App, public plugin: HabitTimerPlugin) {
        this.cache = new ProjectCache();
        this.parser = new ProjectParser(app, this.cache);
        this.mutator = new ProjectMutator(app, plugin, this.parser);
        this.checklistState = new ChecklistStateStore(app);
    }

    async renameChecklistSource(oldPath: string, source: TFile): Promise<void> {
        await this.checklistState.renameSource(oldPath, source);
    }

    /** Remove one entry (call on file rename/delete). */
    invalidateCacheEntry(path: string) {
        this.cache.invalidateCacheEntry(path);
    }

    /** Remove all entries whose paths start with a prefix (call on folder delete). */
    invalidateCachePrefix(prefix: string) {
        this.cache.invalidateCachePrefix(prefix);
    }

    async loadTasks(scope: ProjectScopeDefinition): Promise<ProjectTask[]> {
        const parsed = await this.parser.loadTasks(scope);
        return this.checklistState.reconcile(scope, parsed.map(task => ({ ...task,
            checklistAncestors: task.checklistAncestors?.map(ancestor => ({ ...ancestor })) })));
    }

    async saveTaskDescription(scope: ProjectScopeDefinition, task: ProjectTask, description: string): Promise<void> {
        if (scope.sourceType === 'file') {
            await this.checklistState.saveDescription(scope, task, description);
        } else {
            const content = await this.app.vault.read(task.file);
            const start = '<!-- project-description:start -->';
            const end = '<!-- project-description:end -->';
            const block = `${start}\n${description.trim()}\n${end}`;
            const pattern = /<!-- project-description:start -->[\s\S]*?<!-- project-description:end -->/;
            const updated = pattern.test(content) ? content.replace(pattern, block) : `${content.trimEnd()}\n\n${block}\n`;
            if (updated !== content) await this.app.vault.modify(task.file, updated);
        }
    }

    async saveEditedTask(scope: ProjectScopeDefinition, task: ProjectTask, data: TaskData, columns: string[]): Promise<void> {
        await this.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId, task.sourceLine);
        if (data.description !== task.description) {
            if (scope.sourceType === 'file') await this.loadTasks(scope);
            await this.saveTaskDescription(scope, task, data.description || '');
        }
    }

    async recordChecklistGitHub(scope: ProjectScopeDefinition, items: GitHubItem[], pulledCompletionIds?: Set<string>): Promise<void> {
        await this.checklistState.recordGitHub(scope, items, pulledCompletionIds);
    }

    async checklistDescriptions(scope: ProjectScopeDefinition): Promise<Map<string, string>> {
        return this.checklistState.descriptions(scope);
    }

    async saveChecklistNodeDescription(scope: ProjectScopeDefinition, key: string, description: string): Promise<void> {
        await this.checklistState.saveNodeDescription(scope, key, description);
    }

    async toggleSubtask(file: TFile, lineNum: number, checked: boolean): Promise<void> {
        return this.mutator.toggleSubtask(file, lineNum, checked);
    }

    async addSubtask(file: TFile, text: string, isSingleFileTask?: boolean, taskName?: string): Promise<void> {
        return this.mutator.addSubtask(file, text, isSingleFileTask, taskName);
    }

    async saveTask(taskFile: TFile, data: TaskData, isSingleFileTask?: boolean, oldTaskName?: string, columns?: string[], blockId?: string, sourceLine?: number): Promise<void> {
        return this.mutator.saveTask(taskFile, data, isSingleFileTask, oldTaskName, columns, blockId, sourceLine);
    }

    async createTask(scope: ProjectScopeDefinition, data: Partial<TaskData>): Promise<void> {
        const before = data.description ? new Set((await this.loadTasks(scope)).map(task => task.id)) : undefined;
        await this.mutator.createTask(scope, data);
        if (before && data.description) {
            const created = (await this.loadTasks(scope)).find(task => !before.has(task.id) && task.name === data.name);
            if (created) await this.saveTaskDescription(scope, created, data.description);
        }
    }

    async moveTaskBefore(scope: ProjectScopeDefinition, source: ProjectTask, target: ProjectTask): Promise<void> {
        return this.mutator.moveTaskBefore(scope, source, target);
    }

    async deleteTask(task: ProjectTask, isSingleFileTask?: boolean): Promise<void> {
        return this.mutator.deleteTask(task, isSingleFileTask);
    }

    async setArchived(task: ProjectTask, archived: boolean, isSingleFileTask?: boolean): Promise<void> {
        return this.mutator.setArchived(task, archived, isSingleFileTask);
    }

    async startTimerForTask(task: ProjectTask, isSingleFileTask?: boolean) {
        return this.mutator.startTimerForTask(task, isSingleFileTask);
    }
}
