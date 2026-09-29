const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;

export function stableHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

/** An in-memory identity for an existing checkbox. Reading a project never edits its source file. */
export function virtualTaskId(filePath: string, section: string | undefined, text: string, occurrence: number): string {
    const numbered = text.match(/^\*{0,2}(\d+(?:\.\d+)+)\*{0,2}(?:\s|$)/)?.[1];
    const anchor = numbered ? `number:${numbered}` : `text:${text.replace(/\s+\^[A-Za-z0-9-]+\s*$/, '').trim().toLowerCase()}`;
    return `virtual:${filePath}:${stableHash(`${section || ''}\u0000${anchor}`)}:${occurrence}`;
}

/** Creates a physical block ID only for a task the user explicitly creates or edits. */
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

/** Plain display title for a Markdown checkbox, without touching its source text or identity. */
export function taskDisplayTitle(text: string): string {
    return stripTaskBlockId(text)
        .replace(/⏱️[ \t]*[\d:]+/g, '')
        .replace(/⏳[ \t]*[\d:]+/g, '')
        .replace(/🏷️[ \t]*(?:(?!\s|,|⏱️|⏳|📅|🏁).)+/g, '')
        .replace(/\[\[Habits\/[^\]]+\]\]/g, '')
        .replace(/(?:⏫|🔼|🔽)/g, '')
        .replace(/(?:📅|🏁)[ \t]*[\d-]{10}/g, '')
        .replace(/<!-- project-status: [^>]* -->/g, '')
        .replace(/<!-- project-archived -->/g, '')
        .replace(/(^|\s)#[a-zA-Z0-9_-]+(?=\s|$)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label || target)
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function ensureTaskBlockIds(content: string, filePath: string): { content: string; changed: boolean } {
    const lines = content.split('\n');
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
        if (!line) continue;
        if (/^#{1,6}[ \t]+/.test(line)) {
            hasParentTask = false;
            continue;
        }
        const match = line.match(/^([ \t]*)-[ \t]+\[[ xX]\](.*)$/);
        if (!match) {
            if (/^[ \t]*-[ \t]+/.test(line)) hasParentTask = false;
            continue;
        }
        const indent = match[1]?.length || 0;
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
