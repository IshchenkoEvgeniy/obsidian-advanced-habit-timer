import type { StageGrouping } from './table-stage-groups';
import { normalizeColumnWidths, type ColumnWidths } from './table-column-widths';

export const fieldKeys = ['assignees', 'status', 'linkedPrs', 'subIssues', 'iteration', 'estimate', 'start', 'due', 'priority', 'section', 'tags', 'habit', 'spent'] as const;
export type Field = typeof fieldKeys[number];
export type GroupField = 'none' | 'section' | 'status' | 'priority' | 'habit';
export type SortRule = { field: Field | 'title'; direction: 1 | -1 };
export type ViewConfig = { query: string; visible: Field[]; fieldOrder: Field[]; hiddenGitHub?: string[];
    groupBy: GroupField; sliceBy: GroupField; sliceValue: string; sortRules: SortRule[];
    showEstimateSum: boolean; showSpentSum: boolean; stageGrouping?: StageGrouping; columnWidths?: ColumnWidths };
export type SavedView = { id: string; name: string; config: ViewConfig };

const isField = (key: unknown): key is Field => fieldKeys.includes(key as Field);
const isGroup = (key: unknown): key is GroupField => ['none', 'section', 'status', 'priority', 'habit'].includes(String(key));

function isSortRule(value: unknown): value is SortRule {
    if (!value || typeof value !== 'object') return false;
    const rule = value as Record<string, unknown>;
    return (rule.field === 'title' || isField(rule.field)) && (rule.direction === 1 || rule.direction === -1);
}

export function hasCurrentTableViewConfig(saved: Record<string, unknown>): boolean {
    return Array.isArray(saved.visible) || typeof saved.query === 'string' || Array.isArray(saved.fieldOrder) || Boolean(saved.columnWidths);
}

/** Read old preferences without letting an older saved-view baseline replace the current draft. */
export function normalizeTableViewConfig(input: unknown, fallback: ViewConfig): ViewConfig {
    const saved = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    const order = Array.isArray(saved.fieldOrder) ? saved.fieldOrder.filter(isField) : fallback.fieldOrder;
    const stageGrouping = saved.stageGrouping;
    return {
        query: typeof saved.query === 'string' ? saved.query : fallback.query,
        visible: Array.isArray(saved.visible) ? [...new Set(saved.visible.filter(isField))] : [...fallback.visible],
        fieldOrder: [...new Set([...order, ...fieldKeys])],
        hiddenGitHub: Array.isArray(saved.hiddenGitHub) ? saved.hiddenGitHub.filter((key): key is string => typeof key === 'string') : fallback.hiddenGitHub,
        groupBy: isGroup(saved.groupBy) ? saved.groupBy : fallback.groupBy,
        sliceBy: isGroup(saved.sliceBy) ? saved.sliceBy : fallback.sliceBy,
        sliceValue: typeof saved.sliceValue === 'string' ? saved.sliceValue : fallback.sliceValue,
        sortRules: Array.isArray(saved.sortRules) ? saved.sortRules.filter(isSortRule) : fallback.sortRules,
        showEstimateSum: typeof saved.showEstimateSum === 'boolean' ? saved.showEstimateSum : fallback.showEstimateSum,
        showSpentSum: typeof saved.showSpentSum === 'boolean' ? saved.showSpentSum : fallback.showSpentSum,
        columnWidths: normalizeColumnWidths(saved.columnWidths),
        stageGrouping: stageGrouping === 'none' || stageGrouping === 'local' ||
            typeof stageGrouping === 'string' && stageGrouping.startsWith('github:') && stageGrouping.length > 7
            ? stageGrouping as StageGrouping : fallback.stageGrouping || 'none'
    };
}
