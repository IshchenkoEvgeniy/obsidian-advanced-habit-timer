import { describe, expect, it } from 'vitest';
import { codeCommand, letterCommand } from '../src/design/commands';
import { parseTodo, serializeTodo, toggleTodo } from '../src/design/todo';
import { columnIndex, columnLetter, displayValue, emptyTable, evaluateNumber, toNumber, type TableData } from '../src/design/table';
import { safeLink } from '../src/design/links';
import { straightSides } from '../src/design/straight';
import { parseBoard } from '../src/design/board';

describe('board commands', () => {
    it('maps letters to commands and brackets by physical code', () => {
        expect(letterCommand('z', true, false)).toBe('undo');
        expect(letterCommand('z', true, true)).toBe('redo');
        expect(letterCommand('y', true, false)).toBe('redo');
        expect(letterCommand('u', true, false)).toBe('parent');
        expect(letterCommand('g', true, true)).toBe('ungroup');
        expect(letterCommand('z', false, false)).toBeUndefined();
        expect(codeCommand('BracketLeft', true)).toBe('back');
        expect(codeCommand('BracketRight', true)).toBe('forward');
        expect(codeCommand('BracketLeft', false)).toBeUndefined();
    });
});

describe('to-do text', () => {
    it('parses checkbox lines and plain lines', () => {
        expect(parseTodo('- [ ] milk\n- [x] bread\nplain\n\n')).toEqual([
            { text: 'milk', done: false },
            { text: 'bread', done: true },
            { text: 'plain', done: false },
        ]);
    });

    it('serializes and toggles one line', () => {
        expect(serializeTodo([{ text: 'a', done: true }, { text: 'b', done: false }])).toBe('- [x] a\n- [ ] b');
        expect(toggleTodo('- [ ] a\n- [ ] b', 1)).toBe('- [ ] a\n- [x] b');
    });
});

describe('table cards and formulas', () => {
    const table: TableData = {
        columns: [{ name: 'A', type: 'number' }, { name: 'B', type: 'number' }, { name: 'C', type: 'text' }],
        rows: [['1', '2', '=SUM(A1:B1)'], ['3', '4', '=A1*B2'], ['', '', '=AVG(A1:B2)']],
    };

    it('converts column letters both ways', () => {
        expect([columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(27)]).toEqual(['A', 'Z', 'AA', 'AB']);
        expect([columnIndex('A'), columnIndex('AA')]).toEqual([0, 26]);
    });

    it('evaluates references, ranges and functions', () => {
        expect(displayValue(table, 0, 2)).toBe('3');
        expect(displayValue(table, 1, 2)).toBe('4');
        expect(displayValue(table, 2, 2)).toBe('2.5');
        expect(evaluateNumber(table, '=(A1+B1)*2-4/2')).toBe(4);
        expect(evaluateNumber(table, '=-A1+B1')).toBe(1);
        expect(evaluateNumber(table, '=COUNT(A1:B2)')).toBe(4);
        expect(evaluateNumber(table, '=MIN(A1:B2)')).toBe(1);
        expect(evaluateNumber(table, '=MAX(A1,B2,10)')).toBe(10);
        expect(evaluateNumber(table, '=SUM(A3:B3)')).toBe(0);
    });

    it('shows errors for cycles, bad syntax and division by zero', () => {
        expect(displayValue({ columns: [{ name: 'A', type: 'text' }], rows: [['=A2'], ['=A1']] }, 0, 0)).toBe('#ERR');
        expect(displayValue({ columns: [{ name: 'A', type: 'text' }], rows: [['=1+']] }, 0, 0)).toBe('#ERR');
        expect(displayValue({ columns: [{ name: 'A', type: 'text' }], rows: [['=1/0']] }, 0, 0)).toBe('#ERR');
    });
    it('bounds enormous ranges to existing cells and memoizes repeated dependencies', () => {
        expect(evaluateNumber(table, '=SUM(A1:B999999999)')).toBe(10);
        const chain = emptyTable(1, 24); chain.rows[0]![0] = '1'; for (let i = 1; i < chain.rows.length; i++) chain.rows[i]![0] = `=A${i}+A${i}`;
        expect(displayValue(chain, 23, 0)).toBe('8388608');
        chain.rows[23]![0] = '=' + '('.repeat(1500) + '1' + ')'.repeat(1500); expect(displayValue(chain, 23, 0)).toBe('#ERR');
    });

    it('formats percent cells and checkboxes', () => {
        expect(displayValue({ columns: [{ name: 'A', type: 'percent' }], rows: [['=50*2']] }, 0, 0)).toBe('100%');
        expect(displayValue({ columns: [{ name: 'A', type: 'checkbox' }], rows: [['true']] }, 0, 0)).toBe('☑');
        expect(displayValue({ columns: [{ name: 'A', type: 'text' }], rows: [['hello']] }, 0, 0)).toBe('hello');
    });

    it('reads numbers with currency signs, spaces and decimal commas', () => {
        expect(toNumber('1 500,5 ₴')).toBe(1500.5);
        expect(Number.isNaN(toNumber('abc'))).toBe(true);
        expect(emptyTable(2, 1)).toEqual({ columns: [{ name: 'A', type: 'text' }, { name: 'B', type: 'text' }], rows: [['', '']] });
    });
});

describe('link safety', () => {
    it('opens web and mail links only', () => {
        expect(safeLink('https://example.com/a')).toBe('https://example.com/a');
        expect(safeLink('example.com')).toBe('https://example.com/');
        expect(safeLink('mailto:a@b.c')).toBe('mailto:a@b.c');
        expect(safeLink('javascript:alert(1)')).toBeUndefined();
        expect(safeLink('file:///etc/passwd')).toBeUndefined();
        expect(safeLink('   ')).toBeUndefined();
    });
});

describe('facing sides for shift-links', () => {
    it('uses horizontal sides when the horizontal distance dominates', () => {
        expect(straightSides({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 40, w: 100, h: 100 })).toEqual({ from: 'right', to: 'left' });
        expect(straightSides({ x: 300, y: 0, w: 100, h: 100 }, { x: 0, y: 40, w: 100, h: 100 })).toEqual({ from: 'left', to: 'right' });
    });

    it('uses vertical sides when the vertical distance dominates', () => {
        expect(straightSides({ x: 0, y: 0, w: 100, h: 100 }, { x: 20, y: 300, w: 100, h: 100 })).toEqual({ from: 'bottom', to: 'top' });
        expect(straightSides({ x: 0, y: 300, w: 100, h: 100 }, { x: 20, y: 0, w: 100, h: 100 })).toEqual({ from: 'top', to: 'bottom' });
    });

    it('returns nothing without both objects', () => {
        expect(straightSides(undefined, { x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
    });
});

describe('new item kinds and board flags', () => {
    const base = (extra: Record<string, unknown>) => JSON.stringify({ format: 2, id: 'b', name: 'B', viewport: { x: 0, y: 0, zoom: 1 }, edges: [], items: [{ id: 'i', kind: 'table', x: 0, y: 0, w: 100, h: 100, z: 1, ...extra }] });

    it('accepts valid table, sketch, todo, link and band data', () => {
        expect(() => parseBoard(base({ table: emptyTable(2, 2) }))).not.toThrow();
        expect(() => parseBoard(base({ kind: 'sketch', sketch: [{ points: [[1, 2], [3, 4]], width: 2 }] }))).not.toThrow();
        expect(() => parseBoard(base({ kind: 'todo', text: '- [ ] a' }))).not.toThrow();
        expect(() => parseBoard(base({ kind: 'link', text: 'https://e.com', title: 'E' }))).not.toThrow();
        expect(() => parseBoard(base({ kind: 'frame', column: true, collapsed: false, band: '#ff0000' }))).not.toThrow();
        expect(() => parseBoard(base({ kind: 'shape', shape: 'pill' }))).not.toThrow();
    });

    it('rejects malformed table rows, sketch points and flags', () => {
        expect(() => parseBoard(base({ table: { columns: [{ name: 'A', type: 'text' }], rows: [['a', 'b']] } }))).toThrow();
        expect(() => parseBoard(base({ table: { columns: [{ name: 'A', type: 'bogus' }], rows: [['a']] } }))).toThrow();
        expect(() => parseBoard(base({ kind: 'sketch', sketch: [{ points: [[1]], width: 2 }] }))).toThrow();
        expect(() => parseBoard(base({ kind: 'frame', column: 'yes' }))).toThrow();
        expect(() => parseBoard(base({ kind: 'shape', shape: 'nonsense' }))).toThrow();
        expect(() => parseBoard(JSON.stringify({ format: 2, id: 'b', name: 'B', viewport: { x: 0, y: 0, zoom: 1 }, edges: [], items: [], readOnly: 'yes' }))).toThrow();
    });
});
