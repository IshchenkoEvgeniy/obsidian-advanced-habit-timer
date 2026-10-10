import type { ProjectDataEngine } from './project-data';
import type { ProjectScopeDefinition, ProjectTask, ProjectSubtask } from './types';
import { projectTaskToData } from './task-data';

export function boardHierarchyMatches(tasks: ProjectTask[], matches: ProjectTask[]): Set<string> {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const result = new Set<string>();
    for (const match of matches) {
        let task: ProjectTask | undefined = match;
        while (task && !result.has(task.id)) {
            result.add(task.id);
            task = task.parentId ? byId.get(task.parentId) : undefined;
        }
    }
    return result;
}

export function boardVisibleSubtasks(parent: ProjectTask, tasks: ProjectTask[], matches: ProjectTask[],
    completed: (task: ProjectTask) => boolean): ProjectSubtask[] {
    if (matches.some(task => task.id === parent.id)) return parent.subtasks || [];
    const byId = new Map(tasks.map(task => [task.id, task]));
    return matches.flatMap(task => {
        if (task.sourceLine === undefined) return [];
        let ancestor = task.parentId ? byId.get(task.parentId) : undefined;
        const seen = new Set<string>();
        while (ancestor && !seen.has(ancestor.id)) {
            if (ancestor.id === parent.id) return [{ line: task.sourceLine, sourceText: task.sourceText,
                blockId: task.blockId, checked: completed(task), text: task.name }];
            seen.add(ancestor.id);
            ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
        }
        return [];
    });
}

const compatible = (source: ProjectTask, target: ProjectTask): boolean => source.section === target.section &&
    source.parentId === target.parentId && source.indent === target.indent &&
    JSON.stringify(source.checklistAncestors?.map(item => item.id) || []) === JSON.stringify(target.checklistAncestors?.map(item => item.id) || []);

/** Move source Markdown intact; folder tasks keep their order in frontmatter. */
export async function moveBoardTask(engine: ProjectDataEngine, scope: ProjectScopeDefinition,
    tasks: ProjectTask[], sourceId: string, status: string, targetId: string | undefined,
    formatTime: (seconds: number) => string, columns: string[]): Promise<void> {
    let source = tasks.find(task => task.id === sourceId && !task.parentId);
    if (!source || sourceId === targetId) return;
    const changedStatus = source.status !== status;
    const roots = tasks.filter(task => !task.parentId && task.id !== sourceId && task.status === status)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    const targetIndex = targetId ? roots.findIndex(task => task.id === targetId) : -1;
    let target = targetIndex >= 0 ? roots[targetIndex] : undefined;
    if (scope.sourceType === 'file' && target && !compatible(source, target)) {
        if (!changedStatus) throw new Error('Move cards within the same checklist stage and parent.');
        target = undefined;
    }
    if (changedStatus) {
        await engine.saveTask(source.file, projectTaskToData(source, formatTime, { status }),
            scope.sourceType === 'file', source.name, columns, source.blockId, source.sourceLine);
        const refreshed = await engine.loadTasks(scope);
        source = refreshed.find(task => task.id === sourceId);
        if (!source) throw new Error('The moved task could not be located. Refresh the project.');
        if (target) target = refreshed.find(task => task.id === target!.id);
    }
    if (scope.sourceType === 'file') {
        if (target) await engine.moveTaskBefore(scope, source, target);
        else if (!targetId) {
            const last = roots.filter(task => compatible(source, task)).at(-1);
            if (last) {
                const current = changedStatus ? (await engine.loadTasks(scope)).find(task => task.id === last.id) : last;
                if (current) await engine.moveTaskAfter(scope, source, current);
            }
        }
        return;
    }
    roots.splice(targetIndex >= 0 ? targetIndex : roots.length, 0, source);
    for (const [index, task] of roots.entries()) {
        const order = index + 1;
        if (task.order === order) continue;
        await engine.saveTask(task.file, projectTaskToData(task, formatTime, { order }), false, task.name, columns, task.blockId);
    }
}
