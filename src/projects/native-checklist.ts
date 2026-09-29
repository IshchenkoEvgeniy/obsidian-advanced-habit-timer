import type { ProjectTask } from './types';

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
    for (const task of tasks) {
        if (!task.section?.startsWith('Этап ')) continue;
        const stageKey = `stage:${task.section}`;
        if (!nodes.has(stageKey)) nodes.set(stageKey, {
            key: stageKey, title: task.section, stage: task.section, kind: 'stage'
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
        nodes.set(key, { key, title: task.name, stage: task.section,
            parentKey: task.parentId && tasks.some(candidate => candidate.id === task.parentId) ? `leaf:${task.parentId}` : parentKey,
            kind: 'leaf', task });
    }
    return [...nodes.values()];
}

export function nativeChecklistMarker(scopeId: string, key: string): string {
    return `<!-- obsidian-checklist-node: ${scopeId}/${key} -->`;
}
