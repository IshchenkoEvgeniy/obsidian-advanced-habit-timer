import type { ProjectTask } from './types';

export const GITHUB_IMPORT_SECTION = 'Импорт из GitHub';

export interface NativeChecklistNode {
    key: string;
    title: string;
    stage: string;
    parentKey?: string;
    kind: 'stage' | 'group' | 'leaf';
    task?: ProjectTask;
}

/** Parent-first order is required because GitHub creates a sub-issue under an existing Issue. */
export function nativeChecklistNodes(tasks: ProjectTask[]): NativeChecklistNode[] {
    const nodes = new Map<string, NativeChecklistNode>();
    const taskIds = new Set(tasks.map(task => task.id));
    for (const task of tasks) {
        if (!task.section?.startsWith('Этап ') && task.section !== GITHUB_IMPORT_SECTION) continue;
        const stage = task.section === GITHUB_IMPORT_SECTION ? '' : task.section;
        const stageKey = stage ? task.sectionKey || `stage:${stage}` : undefined;
        if (stageKey && !nodes.has(stageKey)) nodes.set(stageKey, {
            key: stageKey, title: stage, stage, kind: 'stage'
        });
        let parentKey = stageKey;
        for (const ancestor of task.checklistAncestors || []) {
            const key = `group:${ancestor.id}`;
            if (!nodes.has(key)) nodes.set(key, {
                key, title: ancestor.title, stage: task.section, parentKey, kind: 'group'
            });
            parentKey = key;
        }
        const key = `leaf:${task.id}`;
        nodes.set(key, { key, title: task.name, stage,
            parentKey: task.parentId && taskIds.has(task.parentId) ? `leaf:${task.parentId}` : parentKey,
            kind: 'leaf', task });
    }
    return [...nodes.values()];
}

export function nativeChecklistMarker(scopeId: string, key: string): string {
    return `<!-- obsidian-checklist-node: ${scopeId}/${key} -->`;
}
