import type { App, TFile } from 'obsidian';
import { newTaskBlockId, taskDisplayTitle } from './engine/task-identity';
import type { ProjectTask } from './types';

function descendants(tasks: ProjectTask[], parentId: string): ProjectTask[] {
    const found = new Set([parentId]);
    for (const task of tasks) {
        if (task.parentId && found.has(task.parentId)) found.add(task.id);
    }
    return tasks.filter(task => task.parentId && found.has(task.parentId));
}

export async function addChecklistSubtask(app: App, parent: ProjectTask, tasks: ProjectTask[], title: string): Promise<void> {
    if (parent.sourceLine === undefined || parent.indent === undefined) throw new Error('The source checkbox was not found.');
    const content = await app.vault.read(parent.file);
    const lines = content.split('\n');
    const parentLine = lines[parent.sourceLine];
    const match = parentLine?.match(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*(.*)$/);
    if (!match || taskDisplayTitle(match[1] || '') !== parent.name) throw new Error('The parent checkbox moved. Refresh the table.');
    const lastLine = descendants(tasks, parent.id).reduce((last, task) => Math.max(last, task.sourceLine ?? last), parent.sourceLine);
    const indent = ' '.repeat(parent.indent + 2);
    const blockId = newTaskBlockId(content);
    if (parentLine && /\[[xX]\]/.test(parentLine)) lines[parent.sourceLine] = parentLine.replace(/\[[xX]\]/, '[ ]');
    lines.splice(lastLine + 1, 0, `${indent}- [ ] ${title} ^${blockId}`);
    await app.vault.modify(parent.file, lines.join('\n'));
}

export async function addChecklistGroupChild(app: App, file: TFile, tasks: ProjectTask[],
    parent: { id: string; title: string; sourceLine: number }, title: string): Promise<void> {
    const content = await app.vault.read(file);
    const lines = content.split('\n');
    const heading = lines[parent.sourceLine];
    const prefix = parent.title.match(/^(\d+(?:\.\d+)*)\.?\s/)?.[1];
    if (!heading || !prefix || taskDisplayTitle(heading.replace(/^[ \t]*-[ \t]+/, '')) !== parent.title) {
        throw new Error('The parent task moved. Refresh the table.');
    }
    const children = tasks.filter(task => task.checklistAncestors?.some(ancestor => ancestor.id === parent.id));
    if (!children.length) throw new Error('The parent task is no longer in this view. Refresh the table.');
    const escaped = prefix.replace(/\./g, '\\.');
    const nextNumber = new RegExp(`^${escaped}\\.(\\d+)(?:\\s|$)`);
    let maximum = 0;
    for (const child of children) {
        const direct = child.name.match(nextNumber)?.[1];
        if (direct) maximum = Math.max(maximum, Number(direct));
        for (const ancestor of child.checklistAncestors || []) {
            if (ancestor.id === parent.id) continue;
            const nested = ancestor.title.match(nextNumber)?.[1];
            if (nested) maximum = Math.max(maximum, Number(nested));
        }
    }
    const lastLine = Math.max(...children.map(child => child.sourceLine ?? parent.sourceLine));
    const indent = heading.match(/^[ \t]*/)?.[0].length || 0;
    lines.splice(lastLine + 1, 0, `${' '.repeat(indent + 3)}- [ ] **${prefix}.${maximum + 1}** ${title}`);
    await app.vault.modify(file, lines.join('\n'));
}

export async function addChecklistStageChild(app: App, file: TFile, stage: string, title: string): Promise<void> {
    const content = await app.vault.read(file);
    const lines = content.split('\n');
    const stageLine = lines.findIndex(line => line.trim() === `## ${stage}`);
    if (stageLine < 0) throw new Error('The stage heading moved. Refresh the table.');
    const blockId = newTaskBlockId(content);
    lines.splice(stageLine + 1, 0, `- [ ] ${title} ^${blockId}`);
    await app.vault.modify(file, lines.join('\n'));
}
