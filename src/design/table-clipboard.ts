import { columnLetter, type TableData } from './table';

/** Spreadsheet clipboard cells can contain quoted tabs/newlines and doubled quotes. */
export function parseTableClipboard(text: string): string[][] {
    if (text.length > 1_000_000) throw new Error('Clipboard table is too large');
    const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
    const source = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < source.length; i++) {
        const char = source[i]!;
        if (char === '"' && (quoted || !cell)) {
            if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
            else quoted = !quoted;
        } else if (!quoted && (char === '\t' || char === '\n')) {
            row.push(cell); cell = '';
            if (row.length > 50) throw new Error('Table limit: 50 columns');
            if (char === '\n') { rows.push(row); row = []; }
            if (rows.length > 500) throw new Error('Table limit: 500 rows');
        } else cell += char;
    }
    if (quoted) throw new Error('Unclosed clipboard quote');
    if (cell || row.length || !rows.length || !source.endsWith('\n')) { row.push(cell); rows.push(row); }
    if (rows.length > 500 || rows.some(row => row.length > 50)) throw new Error('Table limit: 500 rows × 50 columns');
    return rows;
}
/** One board patch/undo step; dimensions are checked before any existing cell is touched. */
export function pasteTableCells(table: TableData, row: number, col: number, text: string): TableData {
    const pasted = parseTableClipboard(text), height = Math.max(table.rows.length, row + pasted.length), width = Math.max(table.columns.length, col + Math.max(...pasted.map(row => row.length)));
    if (row < 0 || col < 0 || !Number.isInteger(row) || !Number.isInteger(col) || height > 500 || width > 50) throw new Error('Table limit: 500 rows × 50 columns');
    const columns = Array.from({ length: width }, (_, index) => table.columns[index] ? { ...table.columns[index]! } : { name: columnLetter(index), type: 'text' as const });
    const rows = Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => table.rows[r]?.[c] ?? ''));
    pasted.forEach((cells, r) => cells.forEach((value, c) => rows[row + r]![col + c] = value));
    return { columns, rows };
}
