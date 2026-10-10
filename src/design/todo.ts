/**
 * To-do card text: one task per line, optional markdown checkbox prefix.
 * Stored in the item's `text` field, so no new board field is needed.
 */
export interface TodoLine { text: string; done: boolean }

const LINE = /^\s*(?:[-*]\s*)?(?:\[( |x|X)\]\s*)?(.*)$/;

export function parseTodo(source: string): TodoLine[] {
    return source.split(/\r?\n/).map(line => LINE.exec(line.trim())).filter((match): match is RegExpExecArray => Boolean(match)).map(match => ({ text: (match[2] || '').trim(), done: (match[1] || '').toLowerCase() === 'x' })).filter(item => item.text);
}

export function serializeTodo(lines: TodoLine[]): string {
    return lines.map(line => `- [${line.done ? 'x' : ' '}] ${line.text.replace(/[\r\n]+/g, ' ').trim()}`).join('\n');
}

/** Flips the checkbox of the line at `index` (in parsed order) and returns the normalized text. */
export function toggleTodo(source: string, index: number): string {
    const lines = parseTodo(source);
    const line = lines[index];
    if (line) line.done = !line.done;
    return serializeTodo(lines);
}

export function editTodo(source: string, index: number, value: string): string {
    const lines = parseTodo(source);
    if (lines[index] && value.trim()) lines[index]!.text = value.replace(/[\r\n]+/g, ' ').trim();
    return serializeTodo(lines);
}

export function insertTodo(source: string, index: number, value: string): string {
    const lines = parseTodo(source), added = parseTodo(value);
    lines.splice(Math.max(0, Math.min(lines.length, index)), 0, ...added);
    return serializeTodo(lines);
}

export function removeTodo(source: string, index: number): string {
    const lines = parseTodo(source);
    if (index >= 0 && index < lines.length) lines.splice(index, 1);
    return serializeTodo(lines);
}

export function moveTodo(source: string, index: number, offset: number): string {
    const lines = parseTodo(source), next = index + offset;
    if (lines[index] && next >= 0 && next < lines.length) [lines[index], lines[next]] = [lines[next]!, lines[index]!];
    return serializeTodo(lines);
}
