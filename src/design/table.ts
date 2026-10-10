/**
 * Table card model and a small formula evaluator (L7 table, L19 formulas).
 * Supported: numbers, cell references (A1), ranges (A1:B3), + - * / with parentheses,
 * and SUM, AVG, MIN, MAX, COUNT over ranges or values. Errors show as #ERR.
 */
export type CellType = 'text' | 'number' | 'currency' | 'percent' | 'checkbox' | 'date';
export const CELL_TYPES: CellType[] = ['text', 'number', 'currency', 'percent', 'checkbox', 'date'];
export interface TableColumn { name: string; type: CellType }
export interface TableData { columns: TableColumn[]; rows: string[][] }

export function columnLetter(index: number): string {
    let letters = '', n = index;
    do { letters = String.fromCharCode(65 + (n % 26)) + letters; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return letters;
}

export function columnIndex(letters: string): number {
    let n = 0;
    for (const char of letters.toUpperCase()) n = n * 26 + (char.charCodeAt(0) - 64);
    return n - 1;
}

export function emptyTable(columns = 3, rows = 3): TableData {
    return { columns: Array.from({ length: columns }, (_, index) => ({ name: columnLetter(index), type: 'text' as CellType })), rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => '')) };
}

type Token = { t: 'num' | 'ref' | 'name' | 'op'; v: string };

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let pos = 0;
    while (pos < source.length) {
        const rest = source.slice(pos);
        if (!rest.trim()) break;
        const match = /^\s*(?:(\d+(?:\.\d+)?)|([A-Za-z]+\d+)|([A-Za-z]+)|([+\-*/(),:]))/.exec(rest);
        if (!match) throw new Error('bad token');
        pos += match[0].length;
        if (match[1]) tokens.push({ t: 'num', v: match[1] });
        else if (match[2]) tokens.push({ t: 'ref', v: match[2].toUpperCase() });
        else if (match[3]) tokens.push({ t: 'name', v: match[3].toUpperCase() });
        else tokens.push({ t: 'op', v: match[4]! });
    }
    return tokens;
}

function parseRef(ref: string): { row: number; col: number } {
    const match = /^([A-Z]+)(\d+)$/i.exec(ref);
    if (!match) throw new Error('bad ref');
    const row = Number(match[2]) - 1;
    const col = columnIndex(match[1]!);
    if (row < 0 || !Number.isSafeInteger(row) || !Number.isSafeInteger(col)) throw new Error('bad ref');
    return { row, col };
}

/** Plain cell text as a number: spaces, currency signs and % are ignored. NaN when not numeric. */
export function toNumber(raw: string): number {
    const cleaned = raw.replace(/[%\s₴$€£]/g, '').replace(',', '.');
    if (!cleaned) return NaN;
    return Number(cleaned);
}

interface Evaluation { steps: number; cache: Map<string, number> }
function spend(context: Evaluation) { if (++context.steps > 100000) throw new Error('formula too complex'); }
function cellNumber(table: TableData, row: number, col: number, visiting: Set<string>, context: Evaluation): number {
    spend(context);
    const raw = (table.rows[row]?.[col] ?? '').trim();
    if (!raw) return NaN;
    if (!raw.startsWith('=')) return toNumber(raw);
    const key = `${row},${col}`;
    if (visiting.has(key)) throw new Error('cycle');
    if (context.cache.has(key)) return context.cache.get(key)!;
    visiting.add(key);
    try { const value = evaluateNumber(table, raw, visiting, context); context.cache.set(key, value); return value; } finally { visiting.delete(key); }
}

/** Evaluates a formula (with or without the leading =) to a number; throws on any error. */
export function evaluateNumber(table: TableData, source: string, visiting: Set<string> = new Set(), context: Evaluation = { steps: 0, cache: new Map() }): number {
    spend(context);
    if (source.length > 4096 || visiting.size > 128) throw new Error('formula too complex');
    const tokens = tokenize(source.trim().replace(/^=/, ''));
    if (tokens.length > 1024) throw new Error('formula too complex');
    let pos = 0;
    const peek = (): Token | undefined => tokens[pos];
    const take = (): Token => { const token = tokens[pos++]; if (!token) throw new Error('unexpected end'); return token; };
    const expectOp = (value: string) => { const token = take(); if (token.t !== 'op' || token.v !== value) throw new Error(`expected ${value}`); };

    function range(): number[] {
        const from = take(), colon = take(), to = take();
        if (from.t !== 'ref' || colon.v !== ':' || to.t !== 'ref') throw new Error('bad range');
        const a = parseRef(from.v), b = parseRef(to.v);
        const values: number[] = [];
        // Ranges may name very large coordinates; only existing cells can contribute.
        for (let row = Math.min(a.row, b.row); row <= Math.min(table.rows.length - 1, Math.max(a.row, b.row)); row++) for (let col = Math.min(a.col, b.col); col <= Math.min(table.columns.length - 1, Math.max(a.col, b.col)); col++) {
            const value = cellNumber(table, row, col, visiting, context);
            if (Number.isFinite(value)) values.push(value);
        }
        return values;
    }

    function args(): number[] {
        const values: number[] = [];
        expectOp('(');
        if (peek()?.v === ')') { take(); return values; }
        for (;;) {
            if (peek()?.t === 'ref' && tokens[pos + 1]?.v === ':') values.push(...range());
            else values.push(expression());
            const token = take();
            if (token.v === ')') return values;
            if (token.v !== ',') throw new Error('bad arguments');
        }
    }

    function primary(): number {
        spend(context);
        const token = take();
        if (token.t === 'num') return Number(token.v);
        if (token.t === 'ref') {
            const { row, col } = parseRef(token.v);
            const value = cellNumber(table, row, col, visiting, context);
            if (!Number.isFinite(value)) throw new Error('not a number');
            return value;
        }
        if (token.t === 'name') {
            const values = args();
            switch (token.v) {
                case 'SUM': return values.reduce((sum, value) => sum + value, 0);
                case 'AVG': if (!values.length) throw new Error('empty'); return values.reduce((sum, value) => sum + value, 0) / values.length;
                case 'MIN': if (!values.length) throw new Error('empty'); return Math.min(...values);
                case 'MAX': if (!values.length) throw new Error('empty'); return Math.max(...values);
                case 'COUNT': return values.length;
                default: throw new Error('unknown function');
            }
        }
        if (token.v === '(') { const value = expression(); expectOp(')'); return value; }
        if (token.v === '-') return -primary();
        throw new Error('unexpected token');
    }

    function term(): number {
        let value = primary();
        while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
            const op = take().v;
            const right = primary();
            value = op === '*' ? value * right : value / right;
        }
        return value;
    }

    function expression(): number {
        let value = term();
        while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
            const op = take().v;
            const right = term();
            value = op === '+' ? value + right : value - right;
        }
        return value;
    }

    const value = expression();
    if (pos !== tokens.length) throw new Error('trailing tokens');
    return value;
}

function formatNumber(value: number, type?: CellType): string {
    const text = String(Math.round(value * 100) / 100);
    return type === 'percent' ? `${text}%` : text;
}

/** A table card as a Markdown table, with the values the card shows (formulas evaluated). */
export function tableToMarkdown(table: TableData): string {
    const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const header = table.columns.map(column => cell(column.name));
    const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
    table.rows.forEach((_, row) => lines.push(`| ${table.columns.map((_, col) => cell(displayValue(table, row, col))).join(' | ')} |`));
    return lines.join('\n');
}

/** What the card shows for a cell: formulas are evaluated, checkboxes become a glyph. */
export function displayValue(table: TableData, row: number, col: number): string {
    const raw = table.rows[row]?.[col] ?? '';
    const type = table.columns[col]?.type;
    if (type === 'checkbox') return raw === 'true' ? '☑' : '☐';
    if (!raw.trim().startsWith('=')) return raw;
    try {
        const value = evaluateNumber(table, raw, new Set([`${row},${col}`]));
        return Number.isFinite(value) ? formatNumber(value, type) : '#ERR';
    } catch {
        return '#ERR';
    }
}
