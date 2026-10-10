import { stripTaskMetadata } from './task-metadata';
import { markdownContentLines, markdownIndent } from './markdown-lines';
import { projectMarkdownLinks } from '../image-utils';

export function checklistNodeId(line: string): string | undefined {
    const encoded = line.match(/<!-- project-node: ([^>]+) -->/)?.[1];
    try { return encoded ? decodeURIComponent(encoded) : undefined; } catch { return undefined; }
}

export function stripChecklistNodeId(line: string): string {
    return line.replace(/[ \t]*<!-- project-node: [^>]+ -->/g, '');
}

export function withChecklistNodeId(line: string, id: string): string {
    return `${stripChecklistNodeId(line).trimEnd()} <!-- project-node: ${encodeURIComponent(id)} -->`;
}

const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
const LEGACY_HABIT_RE = /🏷️[ \t]*([\s\S]*?)(?=[ \t]+(?:⏱️|⏳|📅|🏁|⏫|🔼|🔽|#|<!--|\^)|$)/;

export function checklistHabitName(text: string): string | undefined {
    return text.match(/\[\[Habits\/([^\]]+)\]\]/)?.[1]?.trim() || text.match(LEGACY_HABIT_RE)?.[1]?.trim();
}

export function stableHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

/** Initial identity for legacy checkboxes; reconciliation persists it before subsequent edits. */
export function virtualTaskId(filePath: string, section: string | undefined, text: string, occurrence: number): string {
    const numbered = text.match(/^\*{0,2}(\d+(?:\.\d+)+)\*{0,2}(?:\s|$)/)?.[1];
    const anchor = numbered ? `number:${numbered}` : `text:${text.replace(/\s+\^[A-Za-z0-9-]+\s*$/, '').trim().toLowerCase()}`;
    return `virtual:${filePath}:${stableHash(`${section || ''}\u0000${anchor}`)}:${occurrence}`;
}

/** Creates a physical block ID for new tasks and legacy identity migration. */
export function newTaskBlockId(content: string): string {
    let id = '';
    do { id = `ht-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
    while (content.includes(` ^${id}`));
    return id;
}

export function blockIdFromTaskLine(line: string): string | undefined {
    return line.match(BLOCK_ID_RE)?.[1];
}

export function stripTaskBlockId(text: string): string {
    return text.replace(BLOCK_ID_RE, '').trim();
}

/** Source title for a Markdown checkbox, preserving links and formatting. */
export function taskMarkdownTitle(text: string): string {
    const preserved: string[] = [];
    let tokenPrefix = '\uE000';
    while (text.includes(tokenPrefix)) tokenPrefix += '\uE000';
    // Field-like text inside a link or code span belongs to its title/destination.
    let protectedText = text;
    for (const link of projectMarkdownLinks(text).reverse()) {
        if (link.raw.startsWith('[[Habits/')) continue;
        preserved.push(link.raw);
        protectedText = protectedText.slice(0, link.start) + `${tokenPrefix}${preserved.length - 1}\uE001` + protectedText.slice(link.end);
    }
    protectedText = protectedText.replace(/(`+)[^`]*?\1/g,
        match => { preserved.push(match); return `${tokenPrefix}${preserved.length - 1}\uE001`; });
    return stripChecklistNodeId(stripTaskMetadata(stripTaskBlockId(protectedText)))
        .replace(/⏱️[ \t]*[\d:]+/g, '')
        .replace(/⏳[ \t]*[\d:]+/g, '')
        .replace(/🏷️[ \t]*\[\[Habits\/[^\]]+\]\]/g, '')
        .replace(LEGACY_HABIT_RE, '')
        .replace(/\[\[Habits\/[^\]]+\]\]/g, '')
        .replace(/(?:⏫|🔼|🔽)/g, '')
        .replace(/(?:📅|🏁)[ \t]*[\d-]{10}/g, '')
        .replace(/<!-- project-status: [^>]* -->/g, '')
        .replace(/<!-- github-project-item: [^>]* -->/g, '')
        .replace(/<!-- project-archived -->/g, '')
        .replace(/(^|\s)#([\p{L}\p{M}\p{N}_/-]+)(?=\s|$)/gu, (full, space: string, tag: string) => /^\d+$/.test(tag) ? full : space)
        .replace(new RegExp(`${tokenPrefix}(\\d+)\uE001`, 'g'), (_match, index: string) => preserved[Number(index)] || '')
        .trim();
}

export function taskDisplayTitle(text: string): string {
    return taskMarkdownTitle(text)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label || target)
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function ensureTaskBlockIds(content: string, filePath: string): { content: string; changed: boolean } {
    const lines = content.split('\n');
    const contentLines = markdownContentLines(lines);
    const used = new Set<string>();
    for (const line of lines) {
        const existing = blockIdFromTaskLine(line);
        if (existing) used.add(existing);
    }

    let changed = false;
    let hasParentTask = false;
    let parentIndent = 0;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!line || !contentLines[index]) continue;
        if (/^#{1,6}[ \t]+/.test(line)) {
            hasParentTask = false;
            continue;
        }
        const match = line.match(/^([ \t]*)-[ \t]+\[[ xX]\](.*)$/);
        if (!match) {
            if (/^[ \t]*-[ \t]+/.test(line)) hasParentTask = false;
            continue;
        }
        const indent = markdownIndent(line);
        const isParent = indent === 0 || !hasParentTask || indent <= parentIndent;
        if (!isParent) continue;
        hasParentTask = true;
        parentIndent = indent;
        if (blockIdFromTaskLine(line)) continue;

        const base = `ht-${stableHash(`${filePath}:${index}:${line}`)}`;
        let blockId = base;
        let suffix = 2;
        while (used.has(blockId)) blockId = `${base}-${suffix++}`;
        used.add(blockId);
        lines[index] = `${line.trimEnd()} ^${blockId}`;
        changed = true;
    }
    return { content: lines.join('\n'), changed };
}
