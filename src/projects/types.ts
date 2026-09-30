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
    /** Local groups above stages, keyed by the persistent stage key. */
    stageGroups?: Record<string, string>;
    /**
     * Comma-separated list of paths/prefixes to exclude from this scope.
     * Examples: "Archive/, Templates/MyTask.md, _daily"
     * A pattern matches a file if its path starts with the pattern (folder)
     * or equals it exactly (file), or if the filename contains the pattern (glob-like).
     * Prefix with '!' to negate (re-include).
     */
    excludePatterns?: string;
    githubProjectUrl?: string;
    /** Optional repository used for native GitHub Issues and sub-issues. */
    githubIssuesRepositoryUrl?: string;
    githubNativeItems?: Record<string, {
        itemId: string;
        issueId: string;
        url?: string;
        baseTitle: string;
        baseClosed?: boolean;
        baseDescription?: string;
        baseStatus?: string;
        localFields?: Record<string, string | number>;
        baseFields?: Record<string, string | number>;
        meta?: {
            fields: Record<string, string | number>;
            assignees?: string[];
            subIssues?: { completed: number; total: number };
        };
    }>;
    githubChecklistGroups?: Record<string, {
        itemId: string;
        contentId: string;
        baseTitle: string;
        baseChecks: Record<string, boolean>;
    }>;
    githubFields?: { id: string; name: string; type: string; options?: { id: string; name: string; color?: string }[] }[];
    githubBindings?: Record<string, {
        itemId: string;
        base: { name: string; status: string; archived: boolean };
        localFields?: Record<string, string | number>;
        baseFields?: Record<string, string | number>;
        meta?: {
            url?: string;
            contentType: 'DraftIssue' | 'Issue' | 'PullRequest';
            fields: Record<string, string | number>;
            assignees?: string[];
            subIssues?: { completed: number; total: number };
        };
    }>;
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
    /** Nearest level-two heading in a checklist file, or child folder in a folder scope. */
    section?: string;
    /** Persistent key for a structured checklist stage, retained when its heading changes. */
    sectionKey?: string;
    images?: string[];
    subtasks?: ProjectSubtask[];
    order?: number;
    sourceLine?: number;
    blockId?: string;
    parentId?: string;
    indent?: number;
    archived?: boolean;
    /** Numbered headings above a checkbox in a structured Markdown checklist. */
    checklistAncestors?: { id: string; title: string; sourceLine: number }[];
    /** Full Markdown body is kept in a sibling task note when present. */
    description?: string;
    notePath?: string;
    completedAt?: string | null;
}

export function projectTaskId(filePath: string, sourceLine?: number, blockId?: string): string {
    if (blockId) return `block:${filePath}:${blockId}`;
    return sourceLine === undefined ? `file:${filePath}` : `line:${filePath}:${sourceLine}`;
}

export type ProjectTab = 'board' | 'table' | 'calendar' | 'dashboard' | 'timeline';

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
    section?: string;
    order?: number;
    description?: string;
}
