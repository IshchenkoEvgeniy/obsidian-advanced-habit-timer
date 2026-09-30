export type ColumnWidths = Record<string, number>;

export function minimumColumnWidth(key: string): number {
    return key === 'title' ? 160 : key === 'field:subIssues' ? 130 : 72;
}

export function clampColumnWidth(key: string, width: number): number {
    return Math.round(Math.max(minimumColumnWidth(key), Math.min(1400, width)));
}

export function defaultColumnWidth(key: string): number {
    if (key === 'title') return 420;
    if (key === 'field:subIssues') return 230;
    if (key === 'field:status' || key === 'field:priority') return 120;
    if (key === 'field:linkedPrs') return 160;
    return 150;
}

export function normalizeColumnWidths(input: unknown): ColumnWidths {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return Object.fromEntries(Object.entries(input).filter(([key, value]) =>
        (key === 'title' || key.startsWith('field:') || key.startsWith('github:')) &&
        typeof value === 'number' && Number.isFinite(value))
        .map(([key, value]) => [key, clampColumnWidth(key, value as number)]));
}
