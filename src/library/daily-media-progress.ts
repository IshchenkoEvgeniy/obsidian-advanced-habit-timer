const PROGRESS_HEADING = /^###\s+(?:📖\s*)?Progress\s*$/i;
const ANY_HEADING = /^#{1,6}\s+/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Insert a progress entry before the next heading, so daily goal readers can find it. */
export function appendMediaProgressRow(content: string, row: string): string {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const heading = lines.findIndex(line => PROGRESS_HEADING.test(line.trim()));
    if (heading < 0) {
        return `${content.trimEnd()}\n\n---\n\n### 📖 Progress\n| Date | Time | Progress | % | Notes |\n|---|---|---|---|---|\n${row}\n`;
    }
    let insertAt = heading + 1;
    while (insertAt < lines.length && !ANY_HEADING.test(lines[insertAt]?.trim() || '')) insertAt++;
    while (insertAt > heading + 1 && !lines[insertAt - 1]?.trim()) insertAt--;
    lines.splice(insertAt, 0, row);
    return `${lines.join('\n').trimEnd()}\n`;
}

export function mediaProgressForDate(content: string, date: string): number {
    if (!DATE_KEY.test(date)) return 0;
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    let insideProgress = false;
    let total = 0;

    for (const line of lines) {
        const trimmed = line.trim();
        if (PROGRESS_HEADING.test(trimmed)) {
            insideProgress = true;
            continue;
        }
        if (insideProgress && ANY_HEADING.test(trimmed)) {
            insideProgress = false;
            continue;
        }
        if (!insideProgress || !trimmed.startsWith('|')) continue;

        const columns = trimmed.split('|');
        if (columns[1]?.trim() !== date) continue;
        const rawProgress = columns[3]?.trim().match(/^-?\d+(?:\.\d+)?/)?.[0];
        if (!rawProgress) continue;
        total += Math.max(0, Number(rawProgress));
    }

    return Math.round(total * 100) / 100;
}
