import { App, TFile } from 'obsidian';
import HabitTimerPlugin from '../main';
import type { ProjectScopeDefinition, ProjectTask, TaskData } from './types';
import { ProjectCache } from './engine/cache';
import { ProjectParser } from './engine/parser';
import { ProjectMutator } from './engine/mutator';

export class ProjectDataEngine {
    private cache: ProjectCache;
    private parser: ProjectParser;
    private mutator: ProjectMutator;

    constructor(public app: App, public plugin: HabitTimerPlugin) {
        this.cache = new ProjectCache();
        this.parser = new ProjectParser(app, this.cache);
        this.mutator = new ProjectMutator(app, plugin, this.parser);
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
        return this.parser.loadTasks(scope);
    }

    async toggleSubtask(file: TFile, lineNum: number, checked: boolean): Promise<void> {
        return this.mutator.toggleSubtask(file, lineNum, checked);
    }

    async addSubtask(file: TFile, text: string, isSingleFileTask?: boolean, taskName?: string): Promise<void> {
        return this.mutator.addSubtask(file, text, isSingleFileTask, taskName);
    }

    async saveTask(taskFile: TFile, data: TaskData, isSingleFileTask?: boolean, oldTaskName?: string, columns?: string[], blockId?: string): Promise<void> {
        return this.mutator.saveTask(taskFile, data, isSingleFileTask, oldTaskName, columns, blockId);
    }

    async createTask(scope: ProjectScopeDefinition, data: Partial<TaskData>): Promise<void> {
        return this.mutator.createTask(scope, data);
    }

    async deleteTask(task: ProjectTask, isSingleFileTask?: boolean): Promise<void> {
        return this.mutator.deleteTask(task, isSingleFileTask);
    }

    async startTimerForTask(task: ProjectTask, isSingleFileTask?: boolean) {
        return this.mutator.startTimerForTask(task, isSingleFileTask);
    }
}
