import type { GitHubItem, GitHubProjectSnapshot } from './github-client';
import type { ProjectScopeDefinition, ProjectTask } from './types';

export type SyncedValues = { name: string; status: string; archived: boolean };
export type SyncedField = keyof SyncedValues;

export interface SyncPair {
    task: ProjectTask;
    item: GitHubItem;
    pull: SyncedField[];
    push: SyncedField[];
    conflict: SyncedField[];
    pullFields: string[];
    pushFields: string[];
    conflictFields: string[];
    newlyLinked: boolean;
}

export interface SyncPlan {
    pairs: SyncPair[];
    createRemote: ProjectTask[];
    createLocal: GitHubItem[];
    missingRemote: ProjectTask[];
    missingLocal: GitHubItem[];
    ambiguous: string[];
    statusField?: { id: string; options: { id: string; name: string }[] };
}

export function localValues(task: ProjectTask): SyncedValues {
    return { name: task.name, status: task.status, archived: Boolean(task.archived) };
}

function statusKey(value: string): string { return value.trim().replace(/[\s_-]+/g, '').toLocaleLowerCase(); }

export function localStatusForRemote(scope: ProjectScopeDefinition, remoteStatus: string): string {
    const localStatuses = scope.statuses.split(',').map(status => status.trim()).filter(Boolean);
    if (statusKey(remoteStatus) === 'todo') {
        const backlog = localStatuses.find(status => statusKey(status) === 'backlog');
        if (backlog) return backlog;
    }
    const exact = localStatuses.find(status => statusKey(status) === statusKey(remoteStatus));
    if (exact) return exact;
    if (statusKey(remoteStatus) === 'todo') return localStatuses.find(status => statusKey(status) === 'backlog') || remoteStatus;
    return remoteStatus;
}

export function remoteOptionForLocal(localStatus: string, options: { id: string; name: string }[]): string | undefined {
    const exact = options.find(option => statusKey(option.name) === statusKey(localStatus));
    if (exact) return exact.id;
    if (statusKey(localStatus) === 'backlog') return options.find(option => statusKey(option.name) === 'todo')?.id;
    return undefined;
}

export function remoteValues(item: GitHubItem, scope: ProjectScopeDefinition, preferredStatus?: string): SyncedValues {
    let status = localStatusForRemote(scope, item.status);
    if (preferredStatus && item.status && (statusKey(preferredStatus) === statusKey(item.status) ||
        (statusKey(item.status) === 'todo' && statusKey(preferredStatus) === 'backlog'))) status = preferredStatus;
    return { name: item.title, status, archived: item.archived };
}

function titleKey(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }

export function planGitHubSync(scope: ProjectScopeDefinition, tasks: ProjectTask[], snapshot: GitHubProjectSnapshot): SyncPlan {
    const bindings = scope.githubBindings || {};
    const remoteById = new Map(snapshot.items.map(item => [item.id, item]));
    const usedRemote = new Set<string>();
    const usedLocal = new Set<string>();
    const pairs: SyncPair[] = [];
    const createRemote: ProjectTask[] = [];
    const missingRemote: ProjectTask[] = [];
    const missingLocal: GitHubItem[] = [];
    const ambiguous: string[] = [];
    const statusField = snapshot.fields.find(field => field.name.toLocaleLowerCase() === 'status' && field.type === 'SINGLE_SELECT');
    const editableFields = snapshot.fields.filter(field => field.name !== 'Status' &&
        ['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'ITERATION'].includes(field.type));

    for (const task of tasks) {
        const binding = bindings[task.id];
        if (!binding) continue;
        usedLocal.add(task.id);
        const item = remoteById.get(binding.itemId);
        if (!item) { missingRemote.push(task); continue; }
        usedRemote.add(item.id);
        const local = localValues(task);
        const remote = remoteValues(item, scope, binding.base.status);
        const pull: SyncedField[] = [];
        const push: SyncedField[] = [];
        const conflict: SyncedField[] = [];
        for (const field of ['name', 'status', 'archived'] as SyncedField[]) {
            if (local[field] === remote[field]) continue;
            const baseline = binding.base[field];
            if (local[field] === baseline) pull.push(field);
            else if (remote[field] === baseline) push.push(field);
            else conflict.push(field);
        }
        const pullFields: string[] = [];
        const pushFields: string[] = [];
        const conflictFields: string[] = [];
        for (const field of editableFields) {
            const localValue = binding.localFields?.[field.name] ?? binding.meta?.fields[field.name] ?? '';
            const remoteValue = item.fields[field.name] ?? '';
            const baseValue = binding.baseFields?.[field.name] ?? binding.meta?.fields[field.name] ?? '';
            if (String(localValue) === String(remoteValue)) continue;
            if (String(localValue) === String(baseValue)) pullFields.push(field.name);
            else if (String(remoteValue) === String(baseValue)) pushFields.push(field.name);
            else conflictFields.push(field.name);
        }
        pairs.push({ task, item, pull, push, conflict, pullFields, pushFields, conflictFields, newlyLinked: false });
    }

    const titles = new Map<string, GitHubItem[]>();
    for (const item of snapshot.items) {
        if (usedRemote.has(item.id)) continue;
        const key = titleKey(item.title);
        const candidates = titles.get(key) || [];
        candidates.push(item);
        titles.set(key, candidates);
    }
    const localTitleCounts = new Map<string, number>();
    for (const task of tasks) {
        if (usedLocal.has(task.id)) continue;
        const key = titleKey(task.name);
        localTitleCounts.set(key, (localTitleCounts.get(key) || 0) + 1);
    }
    for (const task of tasks) {
        if (usedLocal.has(task.id)) continue;
        const candidates = titles.get(titleKey(task.name)) || [];
        if (candidates.length > 1 || (candidates.length && (localTitleCounts.get(titleKey(task.name)) || 0) > 1)) {
            ambiguous.push(`Ambiguous title: ${task.name}`);
            continue;
        }
        if (candidates.length === 1 && !usedRemote.has(candidates[0]!.id)) {
            const item = candidates[0]!;
            usedRemote.add(item.id);
            usedLocal.add(task.id);
            const local = localValues(task);
            const remote = remoteValues(item, scope, task.status);
            const pull: SyncedField[] = [];
            if (local.status !== remote.status && remote.status) pull.push('status');
            if (local.archived !== remote.archived) pull.push('archived');
            pairs.push({ task, item, pull, push: [], conflict: [], pullFields: [], pushFields: [], conflictFields: [], newlyLinked: true });
        } else {
            createRemote.push(task);
        }
    }
    const createLocal: GitHubItem[] = [];
    for (const item of snapshot.items) {
        if (usedRemote.has(item.id)) continue;
        if (Object.values(bindings).some(binding => binding.itemId === item.id)) missingLocal.push(item);
        else if ((titles.get(titleKey(item.title)) || []).length > 1 || (localTitleCounts.get(titleKey(item.title)) || 0) > 0) {
            ambiguous.push(`Ambiguous title: ${item.title}`);
        } else createLocal.push(item);
    }
    return {
        pairs, createRemote, createLocal, missingLocal, missingRemote, ambiguous,
        statusField: statusField ? { id: statusField.id, options: statusField.options || [] } : undefined
    };
}

export function syncPlanSummary(plan: SyncPlan): { push: number; pull: number; link: number; conflicts: number } {
    return {
        push: plan.createRemote.length + plan.pairs.reduce((sum, pair) => sum + pair.push.length + pair.pushFields.length, 0),
        pull: plan.createLocal.length + plan.pairs.reduce((sum, pair) => sum + pair.pull.length + pair.pullFields.length, 0),
        link: plan.pairs.filter(pair => pair.newlyLinked).length,
        conflicts: plan.missingLocal.length + plan.missingRemote.length + plan.ambiguous.length + plan.pairs.reduce((sum, pair) => sum + pair.conflict.length + pair.conflictFields.length, 0)
    };
}
