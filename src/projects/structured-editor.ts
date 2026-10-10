import type { App, TFile } from 'obsidian';
import { newTaskBlockId, taskDisplayTitle, blockIdFromTaskLine, checklistNodeId } from './engine/task-identity';
import { findTaskBlockEnd } from './engine/task-block';
import { markdownContentLines, markdownIndent } from './engine/markdown-lines';
import { validateTaskData } from './task-validation';
import type { ProjectTask } from './types';

export async function addChecklistSubtask(app: App, parent: ProjectTask, tasks: ProjectTask[], title: string): Promise<string> {
    if (parent.sourceLine === undefined || parent.indent === undefined) throw new Error('The source checkbox was not found.');
    title = validateTaskData({ name: title }).name!;
    let createdId = '';
    await app.vault.process(parent.file, content => {
    const lines = content.split('\n');
    const contentLines = markdownContentLines(lines);
    const parentIndex = parent.blockId ? lines.findIndex((line, row) => contentLines[row] && blockIdFromTaskLine(line) === parent.blockId) : parent.sourceLine!;
    const parentLine = lines[parentIndex];
    const match = parentLine?.match(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*(.*)$/);
    if (!match || taskDisplayTitle(match[1] || '') !== parent.name) throw new Error('The parent checkbox moved. Refresh the table.');
    if (parent.sourceText !== undefined && parentLine !== parent.sourceText) throw new Error('The parent task changed. Refresh before adding a subtask.');
    const end = findTaskBlockEnd(lines, parentIndex, parent.indent!);
    const indent = ' '.repeat(parent.indent! + 2);
    const blockId = newTaskBlockId(content);
    if (parentLine && /\[[xX]\]/.test(parentLine)) lines[parentIndex] = parentLine.replace(/\[[xX]\]/, '[ ]');
    lines.splice(end, 0, `${indent}- [ ] ${title} ^${blockId}`);
    createdId = blockId;
    return lines.join('\n');
    });
    return createdId;
}

export async function addChecklistGroupChild(app: App, file: TFile, tasks: ProjectTask[],
    parent: { id: string; title: string; sourceLine: number }, title: string): Promise<string> {
    title = validateTaskData({ name: title }).name!;
    let createdId = '';
    await app.vault.process(file, content => {
    const lines = content.split('\n');
    const contentLines = markdownContentLines(lines);
    const located = lines.findIndex((line, row) => contentLines[row] && checklistNodeId(line) === `group:${parent.id}`);
    const parentIndex = located >= 0 ? located : parent.sourceLine;
    const heading = lines[parentIndex];
    const prefix = parent.title.match(/^(\d+(?:\.\d+)*)\.?\s/)?.[1];
    if (!heading || !prefix || taskDisplayTitle(heading.replace(/^[ \t]*-[ \t]+/, '')) !== parent.title) {
        throw new Error('The parent task moved. Refresh the table.');
    }
    const end = findTaskBlockEnd(lines, parentIndex, 0);
    const escaped = prefix.replace(/\./g, '\\.');
    const nextNumber = new RegExp(`^${escaped}\\.(\\d+)(?:[.\\s]|$)`);
    let maximum = 0;
    for (let row = parentIndex + 1; row < end; row++) {
        if (!contentLines[row]) continue;
        const line = lines[row]!;
        const title = taskDisplayTitle(line.replace(/^[ \t]*-[ \t]+(?:\[[ xX]\][ \t]*)?/, ''));
        const direct = title.match(nextNumber)?.[1];
        if (direct) maximum = Math.max(maximum, Number(direct));
    }
    const indent = markdownIndent(heading);
    const blockId = newTaskBlockId(content);
    lines.splice(end, 0, `${' '.repeat(indent + 3)}- [ ] **${prefix}.${maximum + 1}** ${title} ^${blockId}`);
    createdId = blockId;
    return lines.join('\n');
    });
    return createdId;
}
