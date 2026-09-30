import type { ProjectScopeDefinition, ProjectTask } from '../../projects/types';
import type { SubIssueProgress } from './table-hierarchy';

export type StageGrouping = 'none' | 'local' | `github:${string}`;
export type TableRowGroup = { key: string; label: string; rows: ProjectTask[]; estimate: number; spent: number };
export type StageCollection = { key: string; label: string; stages: number; done: number; first: boolean };
export type GroupedStage = TableRowGroup & { collection?: StageCollection };

export function tableStageKey(group: TableRowGroup): string {
    return group.rows[0]?.sectionKey || `stage:${group.key}`;
}

export function collectTableStages(tasks: ProjectTask[]): TableRowGroup[] {
    const stages = new Map<string, TableRowGroup>();
    for (const task of tasks) {
        if (!task.section) continue;
        let stage = stages.get(task.section);
        if (!stage) {
            stage = { key: task.section, label: task.section, rows: [], estimate: 0, spent: 0 };
            stages.set(task.section, stage);
        }
        stage.rows.push(task);
        stage.estimate += task.timeEstimatedSec || 0;
        stage.spent += task.timeSpentSec;
    }
    return [...stages.values()];
}

function groupingValue(group: TableRowGroup, scope: ProjectScopeDefinition, mode: StageGrouping): string {
    if (mode === 'local') return (scope.stageGroups?.[tableStageKey(group)] || '').trim();
    if (!mode.startsWith('github:')) return '';
    const field = mode.slice('github:'.length);
    const binding = scope.githubNativeItems?.[tableStageKey(group)];
    const stageValue = binding?.localFields?.[field] ?? binding?.meta?.fields[field];
    // A linked stage owns its grouping value, including an unset field.
    if (binding) return String(stageValue ?? '').trim();
    const values = new Set(group.rows.map(task => {
        const item = scope.githubNativeItems?.[`leaf:${task.id}`] || scope.githubBindings?.[task.id];
        return String(item?.localFields?.[field] ?? item?.meta?.fields[field] ?? '').trim();
    }));
    // Never split a stage when its tasks have different field values.
    return values.size === 1 ? [...values][0]! : '';
}

export function groupTableStages(groups: TableRowGroup[], scope: ProjectScopeDefinition, mode: StageGrouping,
    progress: Map<string, SubIssueProgress>, emptyLabel: string): GroupedStage[] {
    if (mode === 'none') return groups;
    const collections = new Map<string, TableRowGroup[]>();
    for (const stage of groups) {
        const value = groupingValue(stage, scope, mode);
        const members = collections.get(value) || [];
        members.push(stage);
        collections.set(value, members);
    }
    // Keep the source order inside a group and place unassigned stages last.
    const entries = [...collections].sort(([a], [b]) => Number(!a) - Number(!b));
    return entries.flatMap(([value, stages]) => {
        const done = stages.filter(stage => {
            const summary = progress.get(stage.key);
            return Boolean(summary && summary.total > 0 && summary.done === summary.total);
        }).length;
        return stages.map((stage, index) => ({ ...stage, collection: {
            key: JSON.stringify([mode, value]), label: value || emptyLabel,
            stages: stages.length, done, first: index === 0
        } }));
    });
}
