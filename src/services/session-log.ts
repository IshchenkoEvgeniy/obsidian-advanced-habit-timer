const SESSION_HEADING = /^###\s+(?:📝\s*)?Session Log\s*$/i;
const ANY_HEADING = /^#{1,6}\s+/;
const TABLE_HEADER = '| Time | Mode | Property | Duration | Progress | Task |';
const TABLE_SEPARATOR = '|---|---|---|---|---|---|';
const TABLE_HEADER_PATTERN = /^\|\s*Time\s*\|\s*Mode\s*\|\s*Property\s*\|\s*Duration\s*\|/i;

function isDataRow(line: string): boolean {
    return /^\|\s*\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\s*\|/.test(line.trim());
}

export function upsertSessionLog(content: string, newRow?: string): string {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    // Headings and table examples inside fenced code are user content.
    const codeLines = new Set<number>();
    let fence = '';
    for (let index = 0; index < lines.length; index++) {
        const marker = lines[index]?.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (fence) {
            codeLines.add(index);
            if (marker && marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]?.trim()) fence = '';
        } else if (marker) {
            fence = marker[1]!;
            codeLines.add(index);
        }
    }
    const sections: Array<{ start: number; end: number }> = [];
    for (let index = 0; index < lines.length; index++) {
        if (codeLines.has(index) || !SESSION_HEADING.test(lines[index]?.trim() || '')) continue;
        let end = index + 1;
        while (end < lines.length && (codeLines.has(end) || !ANY_HEADING.test(lines[end]?.trim() || ''))) end++;
        sections.push({ start: index, end });
        index = end - 1;
    }

    const rows: string[] = [];
    const removedLines = new Set<number>();
    for (const section of sections) {
        for (let index = section.start + 1; index < section.end; index++) {
            if (codeLines.has(index)) continue;
            const line = lines[index] || '';
            if (TABLE_HEADER_PATTERN.test(line.trim())) {
                removedLines.add(index);
                if (/^\|[\s:|-]+\|$/.test(lines[index + 1]?.trim() || '')) removedLines.add(index + 1);
            } else if (isDataRow(line)) {
                rows.push(line);
                removedLines.add(index);
            }
        }
    }
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
            for (let preserved = section.start + 1; preserved < section.end; preserved++) {
                if (!removedLines.has(preserved)) output.push(lines[preserved] || '');
            }
            index = section.end;
            sectionIndex++;
            continue;
        }
        output.push(lines[index] || '');
        index++;
    }
    return `${output.join('\n').trimEnd()}\n`;
}
