/** Explicit edits preserve identity and task-only fields alongside a Markdown checkbox. */
export interface ChecklistTaskMetadata {
    id?: string;
    cover?: string;
    color?: string;
    habitName?: string;
    completedAt?: string | null;
}

const MARKER = /\s*<!-- project-task: ([^>]*?) -->/g;

export function readTaskMetadata(text: string): ChecklistTaskMetadata {
    const encoded = text.match(/<!-- project-task: ([^>]*?) -->/)?.[1];
    if (!encoded) return {};
    try {
        const value: unknown = JSON.parse(decodeURIComponent(encoded));
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const data = value as Record<string, unknown>;
        const result: ChecklistTaskMetadata = {};
        for (const field of ['id', 'cover', 'color', 'habitName'] as const) {
            if (typeof data[field] === 'string') result[field] = data[field];
        }
        if (data.completedAt === null) result.completedAt = null;
        else if (typeof data.completedAt === 'string' && !Number.isNaN(Date.parse(data.completedAt))) {
            result.completedAt = data.completedAt;
        }
        return result;
    } catch { return {}; }
}

export function stripTaskMetadata(text: string): string { return text.replace(MARKER, ''); }

export function taskMetadataMarker(metadata: ChecklistTaskMetadata): string {
    return ` <!-- project-task: ${encodeURIComponent(JSON.stringify(metadata))} -->`;
}

export function replaceTaskMetadata(line: string, metadata: ChecklistTaskMetadata): string {
    const clean = stripTaskMetadata(line);
    const marker = taskMetadataMarker(metadata);
    return /\s+\^[A-Za-z0-9-]+\s*$/.test(clean)
        ? clean.replace(/(\s+\^[A-Za-z0-9-]+\s*)$/, `${marker}$1`)
        : `${clean.trimEnd()}${marker}`;
}
