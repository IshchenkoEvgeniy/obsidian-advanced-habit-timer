import { markdownContentLines, markdownIndent } from './markdown-lines';

export function isStructuredChecklist(lines: string[]): boolean {
    const contentLines = markdownContentLines(lines);
    return lines.some((line, row) => contentLines[row] && (/^##[ \t]+Этап\s+/.test(line) || /^#[ \t]+Задачи проекта\s*$/.test(line) ||
        /^[ \t]+-[ \t]+\[[ xX]\]/.test(line)));
}

export function findTaskBlockEnd(lines: string[], taskLineIdx: number, parentIndent: number): number {
    parentIndent = lines[taskLineIdx] !== undefined ? markdownIndent(lines[taskLineIdx]) : parentIndent;
    let index = taskLineIdx + 1;
    while (index < lines.length) {
        const line = lines[index];
        if (!line || line.trim() === '') {
            index++;
            continue;
        }
        // Paragraphs, quotes and fenced code belong to the list item too.
        const indentation = markdownIndent(line);
        if (indentation > parentIndent) {
            index++;
            continue;
        }
        break;
    }
    return index;
}
