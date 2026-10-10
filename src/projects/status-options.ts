import type { GitHubField, GitHubProjectSnapshot, GitHubProjectsClient } from './github-client';
import type { ProjectScopeDefinition } from './types';

const COLORS = new Set(['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE']);

export function statusKey(value: string): string {
    return value.trim().replace(/[\s_-]+/g, '').toLocaleLowerCase();
}

export function statusMatches(local: string, remote: string): boolean {
    return statusKey(local) === statusKey(remote) ||
        (statusKey(local) === 'backlog' && statusKey(remote) === 'todo');
}

export function statusNames(scope: ProjectScopeDefinition): string[] {
    return scope.statuses.split(',').map(name => name.trim()).filter(Boolean);
}

/** Merge option definitions without replacing existing GitHub option IDs or item values. */
export async function syncProjectStatusOptions(scope: ProjectScopeDefinition, snapshot: GitHubProjectSnapshot,
    client: GitHubProjectsClient, observedStatuses: string[] = [],
    renameLocal?: (renames: Record<string, string>) => Promise<void>): Promise<boolean> {
    const field = snapshot.fields.find(candidate => candidate.type === 'SINGLE_SELECT' &&
        candidate.name.toLocaleLowerCase() === 'status');
    if (!field) throw new Error('GitHub Project has no single-select Status field.');
    const options: { id?: string; name: string; color?: string; description?: string }[] =
        (field.options || []).map(option => ({ ...option }));
    const local = statusNames(scope);
    const details = { ...(scope.statusDetails || {}) };
    const pendingEdits = new Set(scope.pendingStatusEdits || []);
    const previousField = scope.githubFields?.find(candidate => candidate.id === field.id);
    const remoteRenames: Record<string, string> = {};
    let localChanged = false;
    for (let index = 0; index < local.length; index++) {
        const name = local[index]!;
        // An explicit local rename has priority over an independently changed definition.
        if (Object.values(scope.pendingStatusRenames || {}).includes(name)) continue;
        const previous = previousField?.options?.find(option => option.id === scope.statusOptionIds?.[name]) ||
            previousField?.options?.find(option => statusMatches(name, option.name));
        const optionId = scope.statusOptionIds?.[name] || previous?.id;
        const remote = field.options?.find(option => option.id === optionId);
        if (!remote || statusMatches(name, remote.name) || previous?.name === remote.name) continue;
        remoteRenames[name] = remote.name;
        local[index] = remote.name;
        details[remote.name] = details[name] || {};
        delete details[name];
        if (pendingEdits.delete(name)) pendingEdits.add(remote.name);
        localChanged = true;
    }
    if (Object.keys(remoteRenames).length) {
        if (!renameLocal) throw new Error('Remote statuses were renamed. Reload the project before synchronizing.');
        await renameLocal(remoteRenames);
        for (const binding of Object.values(scope.githubBindings || {})) {
            binding.base.status = remoteRenames[binding.base.status] || binding.base.status;
        }
        for (const binding of Object.values(scope.githubNativeItems || {})) {
            if (binding.baseStatus) binding.baseStatus = remoteRenames[binding.baseStatus] || binding.baseStatus;
        }
        local.splice(0, local.length, ...new Set(local));
    }
    for (const status of observedStatuses) {
        const mapped = remoteRenames[status] || status;
        if (!mapped.trim() || local.some(name => statusKey(name) === statusKey(mapped))) continue;
        local.splice(Math.max(0, local.length - 1), 0, mapped.trim());
        localChanged = true;
    }
    // A previously linked option that disappeared remotely is a deletion, not a new local status.
    for (const name of [...local]) {
        const oldId = scope.statusOptionIds?.[name];
        if (!oldId || field.options?.some(option => option.id === oldId || statusMatches(name, option.name)) ||
            pendingEdits.has(name) || Object.values(scope.pendingStatusRenames || {}).includes(name) ||
            scope.pendingStatusDeletes?.includes(name)) continue;
        if (observedStatuses.some(status => statusKey(status) === statusKey(name)) || name === local[0] || name === local.at(-1)) {
            throw new Error(`Status “${name}” was deleted on GitHub. Choose a replacement in project settings before syncing; it will not be recreated automatically.`);
        }
        local.splice(local.indexOf(name), 1);
        delete details[name];
        localChanged = true;
    }
    let remoteChanged = false;

    for (const name of scope.pendingStatusDeletes || []) {
        const index = options.findIndex(option => statusKey(option.name) === statusKey(name));
        if (index < 0) continue;
        if (snapshot.items.some(item => statusKey(item.status) === statusKey(name))) {
            throw new Error(`GitHub Status “${name}” is still used by project items.`);
        }
        options.splice(index, 1);
        remoteChanged = true;
    }

    for (const [oldName, newName] of Object.entries(scope.pendingStatusRenames || {})) {
        const option = options.find(value => statusKey(value.name) === statusKey(oldName));
        if (!option) continue;
        if (options.some(value => value.id !== option.id && statusKey(value.name) === statusKey(newName))) {
            throw new Error(`GitHub Status already contains “${newName}”; resolve this rename in project settings.`);
        }
        if (option.name !== newName) {
            // The snapshot must use the new vocabulary for this same option ID too.
            for (const item of snapshot.items) if (statusKey(item.status) === statusKey(option.name)) {
                item.status = newName;
                item.fields.Status = newName;
            }
            option.name = newName; remoteChanged = true;
        }
    }

    for (const name of local) {
        if (options.some(option => statusMatches(name, option.name))) continue;
        const detail = details[name];
        const option = { name, color: COLORS.has(detail?.color || '') ? detail!.color! : 'GRAY',
            description: detail?.description || '' };
        const doneIndex = options.findIndex(value => statusMatches(local[local.length - 1] || 'Done', value.name));
        options.splice(doneIndex < 0 ? options.length : doneIndex, 0, option);
        remoteChanged = true;
    }

    for (const name of pendingEdits) {
        const option = options.find(value => statusMatches(name, value.name));
        if (!option) continue;
        const detail = details[name];
        const color = COLORS.has(detail?.color || '') ? detail!.color! : 'GRAY';
        const description = detail?.description || '';
        if (option.color !== color || (option.description || '') !== description) {
            option.color = color;
            option.description = description;
            remoteChanged = true;
        }
    }

    let resolved: GitHubField = field;
    if (remoteChanged) {
        resolved = await client.updateSingleSelectOptions(field, options.map(option => ({
            ...(option.id ? { id: option.id } : {}), name: option.name,
            color: COLORS.has(option.color || '') ? option.color! : 'GRAY',
            description: option.description || ''
        })));
        snapshot.fields = snapshot.fields.map(candidate => candidate.id === field.id ? resolved : candidate);
    }

    for (const option of resolved.options || []) {
        const name = local.find(value => statusMatches(value, option.name));
        if (!name) {
            local.splice(Math.max(0, local.length - 1), 0, option.name);
            localChanged = true;
        }
        const localName = name || option.name;
        if (!pendingEdits.has(localName)) {
            const next = { color: option.color || 'GRAY', description: option.description || '' };
            if (JSON.stringify(details[localName]) !== JSON.stringify(next)) {
                details[localName] = next;
                localChanged = true;
            }
        }
    }
    if (localChanged) {
        scope.statuses = local.join(', ');
        scope.statusDetails = details;
    }
    const optionIds = Object.fromEntries(local.flatMap(name => {
        const option = resolved.options?.find(value => statusMatches(name, value.name));
        return option ? [[name, option.id]] : [];
    }));
    if (JSON.stringify(scope.statusOptionIds || {}) !== JSON.stringify(optionIds)) {
        scope.statusOptionIds = optionIds;
        localChanged = true;
    }
    if (remoteChanged || Object.keys(scope.pendingStatusRenames || {}).length || pendingEdits.size ||
        scope.pendingStatusDeletes?.length) {
        delete scope.pendingStatusRenames;
        delete scope.pendingStatusEdits;
        delete scope.pendingStatusDeletes;
        localChanged = true;
    }
    if (JSON.stringify(scope.githubFields || []) !== JSON.stringify(snapshot.fields)) {
        scope.githubFields = snapshot.fields;
        localChanged = true;
    }
    return localChanged;
}
