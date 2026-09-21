export function findTaskBlockEnd(lines: string[], taskLineIdx: number, parentIndent: number): number {
    let index = taskLineIdx + 1;
    while (index < lines.length) {
        const line = lines[index];
        if (!line || line.trim() === '') {
            index++;
            continue;
        }
        const listMatch = line.match(/^([ \t]*)-/);
        if (listMatch && (listMatch[1]?.length || 0) > parentIndent) {
            index++;
            continue;
        }
        break;
    }
    return index;
}
