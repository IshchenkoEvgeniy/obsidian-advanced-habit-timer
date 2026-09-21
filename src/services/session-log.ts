const SESSION_HEADING = /^###\s+(?:📝\s*)?Session Log\s*$/i;
const ANY_HEADING = /^#{1,6}\s+/;
const TABLE_HEADER = '| Time | Mode | Property | Duration | Progress | Task |';
const TABLE_SEPARATOR = '|---|---|---|---|---|---|';

function isDataRow(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) return false;
    if (/^\|[\s:|-]+\|$/.test(trimmed)) return false;
    return !/\|\s*Time\s*\|\s*Mode\s*\|\s*Property\s*\|\s*Duration\s*\|/i.test(trimmed);
}

export function upsertSessionLog(content: string, newRow?: string): string {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const sections: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < lines.length; index++) {
        if (!SESSION_HEADING.test(lines[index]?.trim() || '')) continue;
        let end = index + 1;
        while (end < lines.length && !ANY_HEADING.test(lines[end]?.trim() || '')) end++;
        sections.push({ start: index, end });
        index = end - 1;
    }

    const rows = sections.flatMap(section =>
        lines.slice(section.start + 1, section.end).filter(isDataRow)
    );
    if (newRow?.trim()) rows.push(newRow.trim());
    const canonical = [
        '### 📝 Session Log',
        TABLE_HEADER,
        TABLE_SEPARATOR,
        ...rows
    ];

    if (!sections.length) {
        if (!newRow?.trim()) return content;
        return `${content.trimEnd()}\n\n${canonical.join('\n')}\n`;
    }

    const output: string[] = [];
    let sectionIndex = 0;
    for (let index = 0; index < lines.length;) {
        const section = sections[sectionIndex];
        if (section && index === section.start) {
            if (sectionIndex === 0) output.push(...canonical);
            index = section.end;
            sectionIndex++;
            continue;
        }
        output.push(lines[index] || '');
        index++;
    }
    return `${output.join('\n').trimEnd()}\n`;
}
