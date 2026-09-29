import type { ProjectTask } from './types';

export interface ChecklistGroup {
    id: string;
    title: string;
    stage: string;
    tasks: ProjectTask[];
}

export function checklistGroups(tasks: ProjectTask[]): ChecklistGroup[] {
    const groups = new Map<string, ChecklistGroup>();
    for (const task of tasks) {
        const parent = task.checklistAncestors?.[0];
        if (!parent || !task.section) continue;
        let group = groups.get(parent.id);
        if (!group) {
            group = { id: parent.id, title: parent.title, stage: task.section, tasks: [] };
            groups.set(parent.id, group);
        }
        group.tasks.push(task);
    }
    return [...groups.values()].map(group => ({ ...group, tasks: group.tasks.sort((a, b) => (a.sourceLine || 0) - (b.sourceLine || 0)) }));
}

export function checklistMarker(scopeId: string, groupId: string): string {
    return `<!-- obsidian-checklist-group: ${scopeId}/${groupId} -->`;
}

export function checklistChecks(group: ChecklistGroup, doneStatus: string): Record<string, boolean> {
    return Object.fromEntries(group.tasks.map(task => [task.id, task.status === doneStatus]));
}

export function remoteChecklistChecks(body: string): Record<string, boolean> {
    const checks: Record<string, boolean> = {};
    for (const line of body.split('\n')) {
        const match = line.match(/^\s*-[ \t]+\[([ xX])\].*?<!-- obsidian-checklist-task: ([^>]+) -->/);
        if (match?.[2]) checks[match[2]] = match[1] !== ' ';
    }
    return checks;
}

export function renderChecklistBody(scopeId: string, group: ChecklistGroup, checks: Record<string, boolean>): string {
    const lines = [`<!-- obsidian-checklist-start: ${scopeId}/${group.id} -->`, `**${group.stage}**`, ''];
    let nested = '';
    for (const task of group.tasks) {
        const parent = task.checklistAncestors?.[1];
        if (parent && parent.id !== nested) {
            lines.push(`- **${parent.title}**`);
            nested = parent.id;
        } else if (!parent) nested = '';
        const prefix = parent ? '  ' : '';
        lines.push(`${prefix}- [${checks[task.id] ? 'x' : ' '}] ${task.name} <!-- obsidian-checklist-task: ${task.id} -->`);
    }
    lines.push('', `<!-- obsidian-checklist-end: ${scopeId}/${group.id} -->`, checklistMarker(scopeId, group.id));
    return lines.join('\n');
}

export function replaceManagedChecklist(existing: string, updated: string, scopeId: string, groupId: string): string | null {
    const start = `<!-- obsidian-checklist-start: ${scopeId}/${groupId} -->`;
    const end = `<!-- obsidian-checklist-end: ${scopeId}/${groupId} -->`;
    const from = existing.indexOf(start);
    const to = existing.indexOf(end, from + start.length);
    if (from < 0 || to < 0) return null;
    const updatedEnd = updated.indexOf(end);
    return existing.slice(0, from) + updated.slice(0, updatedEnd + end.length) + existing.slice(to + end.length);
}
