const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;

function stableHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

export function blockIdFromTaskLine(line: string): string | undefined {
    return line.match(BLOCK_ID_RE)?.[1];
}

export function stripTaskBlockId(text: string): string {
    return text.replace(BLOCK_ID_RE, '').trim();
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
        if (!match) continue;
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
