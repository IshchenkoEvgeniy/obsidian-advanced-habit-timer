import { TFile } from 'obsidian';

export interface ProjectScopeDefinition {
    id: string;
    name: string;
    sourceType: 'folder' | 'tag' | 'dataview' | 'file';
    sourceValue: string;
    targetFolder?: string;
    statuses: string;
    color?: string;
    templatePath?: string;
    defaultSubtasks?: string;
    /**
     * Comma-separated list of paths/prefixes to exclude from this scope.
     * Examples: "Archive/, Templates/MyTask.md, _daily"
     * A pattern matches a file if its path starts with the pattern (folder)
     * or equals it exactly (file), or if the filename contains the pattern (glob-like).
     * Prefix with '!' to negate (re-include).
     */
    excludePatterns?: string;
}

export interface ProjectScopeStats {
    id: string;
    name: string;
    color?: string;
    total: number;
    done: number;
    pct: number;
}

export interface ProjectSubtask {
    line: number;
    text: string;
    checked: boolean;
}

export interface ProjectTask {
    /** Unique within the loaded scope, including checklist tasks sharing one file. */
    id: string;
    file: TFile;
    name: string;
    status: string;
    timeSpentSec: number;
    timeEstimatedSec?: number;
    habitName?: string;
    startDate?: string;
    endDate?: string;
    cover?: string;
    color?: string;
    tags?: string;
    priority?: string;
    images?: string[];
    subtasks?: ProjectSubtask[];
    order?: number;
    sourceLine?: number;
    blockId?: string;
}

export function projectTaskId(filePath: string, sourceLine?: number, blockId?: string): string {
    if (blockId) return `block:${filePath}:${blockId}`;
    return sourceLine === undefined ? `file:${filePath}` : `line:${filePath}:${sourceLine}`;
}

export type ProjectTab = 'board' | 'table' | 'calendar' | 'dashboard' | 'gallery' | 'timeline';

export interface TaskData {
    name: string;
    status: string;
    habitName: string;
    timeEstimated: string;
    startDate: string;
    endDate: string;
    cover: string;
    color: string;
    tags?: string;
    priority?: string;
    order?: number;
}
