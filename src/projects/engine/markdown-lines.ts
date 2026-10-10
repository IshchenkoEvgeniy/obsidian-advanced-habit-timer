/** Markdown tabs advance to the next four-column stop. */
export function markdownIndent(line: string): number {
    let width = 0;
    for (const character of line.match(/^[ \t]*/)?.[0] || '') width += character === '\t' ? 4 - width % 4 : 1;
    return width;
}

/** Blank code spans while retaining every source offset and newline. */
export function maskMarkdownCodeSpans(source: string): string {
    const characters = source.split('');
    for (let at = 0; at < source.length; at++) {
        if (source[at] !== '`') continue;
        let slashes = 0;
        for (let index = at - 1; index >= 0 && source[index] === '\\'; index--) slashes++;
        if (slashes % 2) continue;
        let end = at;
        while (source[end] === '`') end++;
        const delimiter = source.slice(at, end);
        let close = source.indexOf(delimiter, end);
        while (close >= 0 && (source[close - 1] === '`' || source[close + delimiter.length] === '`')) {
            close = source.indexOf(delimiter, close + delimiter.length);
        }
        if (close < 0) { at = end - 1; continue; }
        for (let index = at; index < close + delimiter.length; index++) if (characters[index] !== '\n') characters[index] = ' ';
        at = close + delimiter.length - 1;
    }
    return characters.join('');
}

/** Lines that may contain checklist structure, excluding YAML, fenced code and HTML comments. */
export function markdownContentLines(lines: string[]): boolean[] {
    const result: boolean[] = [];
    let yaml = lines[0]?.replace(/^\uFEFF/, '').trim() === '---';
    let fence: { character: string; length: number } | undefined;
    let comment = false;
    for (const [index, line] of lines.entries()) {
        if (yaml) {
            result.push(false);
            if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) yaml = false;
            continue;
        }
        if (fence) {
            result.push(false);
            const close = line.match(/^[ \t]*(`+|~+)[ \t]*$/)?.[1];
            if (close && close[0] === fence.character && close.length >= fence.length) fence = undefined;
            continue;
        }
        const opening = !comment && line.match(/^[ \t]*(?:[-+*][ \t]+)?(`{3,}|~{3,})(.*)$/);
        if (opening && !(opening[1]![0] === '`' && opening[2]?.includes('`'))) {
            fence = { character: opening[1]![0]!, length: opening[1]!.length };
            result.push(false);
            continue;
        }
        result.push(!comment && !/^[ \t]*<!--/.test(line));
        const comments = /<!--|-->/g;
        for (const token of line.matchAll(comments)) comment = token[0] === '<!--';
    }
    return result;
}
