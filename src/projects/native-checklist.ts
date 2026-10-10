import type { ProjectTask, ProjectStage } from './types';
import { checklistNodeId, stripChecklistNodeId } from './engine/task-identity';
import { markdownContentLines } from './engine/markdown-lines';

export const GITHUB_IMPORT_SECTION = 'Импорт из GitHub';
export const PROJECT_ROOT_HEADING = 'Задачи проекта';

export function checklistStageNames(tasks: ProjectTask[], stages: ProjectStage[] = []): string[] {
    return [...new Set([...stages.map(stage => stage.title), ...tasks.map(task => task.section).filter((section): section is string =>
        Boolean(section?.startsWith('Этап ')))])];
}

export function parseChecklistStages(content: string, existing: { id: string; title: string; kind: string }[] = []): ProjectStage[] {
    const known = existing.filter(entry => entry.kind === 'stage');
    const result: ProjectStage[] = [];
    const lines = content.split('\n');
    const contentLines = markdownContentLines(lines);
    for (const [sourceLine, line] of lines.entries()) {
        if (!contentLines[sourceLine]) continue;
        const title = stripChecklistNodeId(line).match(/^##[ \t]+(Этап\s+.+?)\s*$/)?.[1];
        if (!title) continue;
        const number = title.match(/^Этап\s+(\d+)\b/)?.[1];
        const previous = known.find(stage => stage.title === title) || (number ? known.find(stage =>
            stage.title.match(/^Этап\s+(\d+)\b/)?.[1] === number) : undefined);
        result.push({ id: checklistNodeId(line) || previous?.id || `stage:${title}`, title, sourceLine });
    }
    return result;
}

export interface NativeChecklistNode {
    key: string;
    title: string;
    stage: string;
    parentKey?: string;
    kind: 'stage' | 'group' | 'leaf';
    task?: ProjectTask;
}

/** Parent-first order is required because GitHub creates a sub-issue under an existing Issue. */
export function nativeChecklistNodes(tasks: ProjectTask[], stages: ProjectStage[] = []): NativeChecklistNode[] {
    const nodes = new Map<string, NativeChecklistNode>();
    for (const stage of stages) nodes.set(stage.id, { key: stage.id, title: stage.title, stage: stage.title, kind: 'stage' });
    const taskIds = new Set(tasks.map(task => task.id));
    for (const task of tasks) {
        if (task.section && !task.section.startsWith('Этап ') && task.section !== GITHUB_IMPORT_SECTION) continue;
        const stage = task.section === GITHUB_IMPORT_SECTION ? '' : task.section || '';
        const stageKey = stage ? task.sectionKey || `stage:${stage}` : undefined;
        if (stageKey && !nodes.has(stageKey)) nodes.set(stageKey, {
            key: stageKey, title: stage, stage, kind: 'stage'
        });
        let parentKey = stageKey;
        for (const ancestor of task.checklistAncestors || []) {
            const key = `group:${ancestor.id}`;
            if (!nodes.has(key)) nodes.set(key, {
                key, title: ancestor.title, stage, parentKey, kind: 'group'
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
