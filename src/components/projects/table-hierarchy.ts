import type { ProjectTask } from '../../projects/types';

export type SubIssueProgress = { done: number; total: number };

export type TableHierarchy = {
    taskById: Map<string, ProjectTask>;
    taskChildren: Map<string, ProjectTask[]>;
    taskDepth: Map<string, number>;
    groupProgress: Map<string, SubIssueProgress>;
    stageProgress: Map<string, SubIssueProgress>;
};

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const items = map.get(key) || [];
    items.push(value);
    map.set(key, items);
}

export function buildTableHierarchy(tasks: ProjectTask[], completedStatus: string): TableHierarchy {
    const taskById = new Map(tasks.map(task => [task.id, task]));
    const taskChildren = new Map<string, ProjectTask[]>();
    const taskDepth = new Map<string, number>();
    const groupDescendants = new Map<string, ProjectTask[]>();
    const groupDirectTasks = new Map<string, ProjectTask[]>();
    const childGroups = new Map<string, Set<string>>();
    const stageGroups = new Map<string, Set<string>>();
    const stageDirectTasks = new Map<string, ProjectTask[]>();

    for (const task of tasks) {
        if (task.parentId) append(taskChildren, task.parentId, task);
        const ancestors = task.checklistAncestors || [];
        if (task.section && ancestors[0]) {
            const groups = stageGroups.get(task.section) || new Set<string>();
            groups.add(ancestors[0].id);
            stageGroups.set(task.section, groups);
        } else if (task.section && !task.parentId) {
            append(stageDirectTasks, task.section, task);
        }

        for (let depth = 0; depth < ancestors.length; depth++) {
            const groupId = ancestors[depth]!.id;
            append(groupDescendants, groupId, task);
            const nextGroup = ancestors[depth + 1];
            if (nextGroup) {
                const children = childGroups.get(groupId) || new Set<string>();
                children.add(nextGroup.id);
                childGroups.set(groupId, children);
            } else if (!task.parentId) {
                append(groupDirectTasks, groupId, task);
            }
        }
    }

    const isDone = (task: ProjectTask): boolean => task.status === completedStatus;
    const groupIsDone = (id: string): boolean => Boolean(groupDescendants.get(id)?.length) && groupDescendants.get(id)!.every(isDone);
    const groupProgress = new Map<string, SubIssueProgress>();
    for (const id of groupDescendants.keys()) {
        const direct = groupDirectTasks.get(id) || [];
        const groups = childGroups.get(id) || new Set<string>();
        groupProgress.set(id, { total: direct.length + groups.size,
            done: direct.filter(isDone).length + [...groups].filter(groupIsDone).length });
    }

    const stageProgress = new Map<string, SubIssueProgress>();
    for (const section of new Set([...stageGroups.keys(), ...stageDirectTasks.keys()])) {
        const direct = stageDirectTasks.get(section) || [];
        const groups = stageGroups.get(section) || new Set<string>();
        stageProgress.set(section, { total: direct.length + groups.size,
            done: direct.filter(isDone).length + [...groups].filter(groupIsDone).length });
    }

    const depthOf = (id: string, visiting = new Set<string>()): number => {
        if (taskDepth.has(id)) return taskDepth.get(id)!;
        const parentId = taskById.get(id)?.parentId;
        if (!parentId || !taskById.has(parentId) || visiting.has(parentId)) return 0;
        visiting.add(id);
        const depth = 1 + depthOf(parentId, visiting);
        visiting.delete(id);
        taskDepth.set(id, depth);
        return depth;
    };
    for (const task of tasks) depthOf(task.id);

    return { taskById, taskChildren, taskDepth, groupProgress, stageProgress };
}
