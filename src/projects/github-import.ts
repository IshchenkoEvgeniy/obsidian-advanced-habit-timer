import { App, TFile } from 'obsidian';
import type { GitHubItem } from './github-client';
import { localStatusForRemote } from './github-sync';
import { newTaskBlockId } from './engine/task-identity';
import { GITHUB_IMPORT_SECTION, type NativeChecklistNode } from './native-checklist';
import type { ProjectScopeDefinition, ProjectTask } from './types';

interface ImportResult {
    count: number;
    warnings: string[];
}

/** Add previously unknown Project items to the source checklist without changing their GitHub identity. */
export async function importGitHubChecklistItems(app: App, scope: ProjectScopeDefinition, tasks: ProjectTask[],
    nodes: NativeChecklistNode[], items: GitHubItem[], matched: Map<string, GitHubItem>,
    repositoryUrl: string): Promise<ImportResult> {
    const source = app.vault.getAbstractFileByPath(scope.sourceValue.trim());
    if (!(source instanceof TFile)) throw new Error(`Checklist source is missing: ${scope.sourceValue}`);
    const content = await app.vault.read(source);
    const lines = content.split('\n');
    const warnings: string[] = [];
    const alreadyImported = new Set([...content.matchAll(/<!-- github-project-item: ([^>]+) -->/g)]
        .map(match => match[1]!.trim()));
    const knownItemIds = new Set([
        ...[...matched.values()].map(item => item.id),
        ...Object.values(scope.githubNativeItems || {}).map(binding => binding.itemId),
        ...Object.values(scope.githubBindings || {}).map(binding => binding.itemId)
    ]);
    for (const item of items) {
        if (alreadyImported.has(item.id) && !knownItemIds.has(item.id)) {
            warnings.push(`GitHub item exists in Markdown outside a synchronized section: ${item.title}`);
        }
    }
    const candidates = items.filter(item => !item.archived &&
        (item.contentType === 'Issue' || item.contentType === 'DraftIssue') &&
        !knownItemIds.has(item.id) && !alreadyImported.has(item.id) &&
        !/<!-- obsidian-(?:checklist|project-task)/.test(item.body));
    // A Project can contain Issues from several repositories. The configured repository
    // is only the destination for newly created Issues, not a limit on existing items.
    const allowed = candidates;
    const issueIsInConfiguredRepository = (item: GitHubItem): boolean => !item.url ||
        item.url.toLowerCase().startsWith(`${repositoryUrl.toLowerCase()}/issues/`);
    const byIssueId = new Map(allowed.filter(item => item.contentType === 'Issue')
        .map(item => [item.contentId, item]));
    const depth = (item: GitHubItem, visited = new Set<string>()): number => {
        if (!item.parentIssueId || visited.has(item.contentId)) return 0;
        const parent = byIssueId.get(item.parentIssueId);
        if (!parent) return 0;
        visited.add(item.contentId);
        return 1 + depth(parent, visited);
    };
    allowed.sort((left, right) => depth(left) - depth(right));

    const positions = new Map<string, number>();
    const kinds = new Map<string, NativeChecklistNode['kind']>();
    const issueToKey = new Map<string, string>();
    for (const node of nodes) {
        kinds.set(node.key, node.kind);
        if (node.kind === 'stage') positions.set(node.key,
            lines.findIndex(line => line.trim() === `## ${node.title}`));
        else if (node.kind === 'leaf' && node.task?.sourceLine !== undefined) positions.set(node.key, node.task.sourceLine);
    }
    for (const task of tasks) {
        for (const ancestor of task.checklistAncestors || []) {
            positions.set(`group:${ancestor.id}`, ancestor.sourceLine);
        }
    }
    for (const node of nodes) {
        const item = matched.get(node.key);
        if (item?.contentType === 'Issue') issueToKey.set(item.contentId, node.key);
    }
    for (const [key, binding] of Object.entries(scope.githubNativeItems || {})) {
        issueToKey.set(binding.issueId, key);
    }
    const insert = (index: number, line: string, key: string): void => {
        lines.splice(index, 0, line);
        for (const [existingKey, position] of positions) {
            if (position >= index) positions.set(existingKey, position + 1);
        }
        positions.set(key, index);
    };

    const firstStatus = scope.statuses.split(',').map(status => status.trim()).filter(Boolean)[0] || 'Backlog';
    const doneStatus = scope.statuses.split(',').map(status => status.trim()).filter(Boolean).at(-1) || 'Done';
    let count = 0;
    for (const item of allowed) {
        const title = item.title.replace(/[\r\n]+/g, ' ').trim();
        if (!title) { warnings.push(`GitHub item has no title: ${item.id}`); continue; }
        let parentKey = item.parentIssueId ? issueToKey.get(item.parentIssueId) : undefined;
        // A Project stage field is not an Issue parent. Keep external repository
        // Issues at the import root unless GitHub already links them as sub-issues.
        if (!parentKey && issueIsInConfiguredRepository(item) && typeof item.fields['Этап'] === 'string') {
            parentKey = nodes.find(node => node.kind === 'stage' && node.title === item.fields['Этап'])?.key;
        }
        let index: number;
        let indent = 0;
        const parentPosition = parentKey ? positions.get(parentKey) : undefined;
        if (parentPosition !== undefined && parentPosition >= 0) {
            index = parentPosition + 1;
            if (kinds.get(parentKey!) !== 'stage') {
                indent = (lines[parentPosition]?.match(/^[ \t]*/)?.[0].length || 0) + 2;
            }
        } else {
            if (item.parentIssueId) warnings.push(`Parent Issue is outside this checklist: ${item.title}`);
            let heading = lines.findIndex(line => line.trim() === `## ${GITHUB_IMPORT_SECTION}`);
            if (heading < 0) {
                lines.push('', `## ${GITHUB_IMPORT_SECTION}`, '');
                heading = lines.length - 2;
            }
            index = heading + 1;
            while (index < lines.length && !/^#{1,2}[ \t]+/.test(lines[index] || '')) index++;
        }
        const localStatus = item.status ? localStatusForRemote(scope, item.status) : firstStatus;
        const checked = item.issueState === 'CLOSED' || localStatus === doneStatus;
        const statusMarker = !checked
            ? ` <!-- project-status: ${localStatus.replace(/-->/g, '')} -->` : '';
        const marker = `<!-- github-project-item: ${item.id} -->`;
        const blockId = newTaskBlockId(lines.join('\n'));
        const key = `imported:${item.contentId}`;
        insert(index, `${' '.repeat(indent)}- [${checked ? 'x' : ' '}] ${title}${statusMarker} ${marker} ^${blockId}`, key);
        kinds.set(key, 'leaf');
        if (item.contentType === 'Issue') issueToKey.set(item.contentId, key);
        count++;
    }
    if (count) await app.vault.modify(source, lines.join('\n'));
    return { count, warnings };
}
