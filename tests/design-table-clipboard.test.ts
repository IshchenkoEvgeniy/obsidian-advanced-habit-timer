import { describe, expect, it } from 'vitest';
import { emptyTable, displayValue } from '../src/design/table';
import { parseTableClipboard, pasteTableCells } from '../src/design/table-clipboard';
import { paperColor } from '../src/design/card-appearance';
describe('canvas table clipboard', () => {
    it('reads spreadsheet tabs, quoted multiline cells, quotes and empty trailing cells', () => {
        expect(parseTableClipboard('A\t"B\nC"\t"a""b"\r\n1\t2\t\r\n')).toEqual([['A', 'B\nC', 'a"b'], ['1', '2', '']]);
        expect(() => parseTableClipboard('"unfinished')).toThrow();
    });
    it('pastes a rectangle in one immutable update and preserves formulas/column types', () => {
        const previous = emptyTable(2, 2); previous.columns[0]!.type = 'number'; previous.rows[0]![0] = '8';
        const next = pasteTableCells(previous, 1, 0, '3\t=A1+A2\n4\t5');
        expect(next.rows).toEqual([['8', ''], ['3', '=A1+A2'], ['4', '5']]);
        expect(next.columns[0]!.type).toBe('number'); expect(displayValue(next, 1, 1)).toBe('11');
        expect(previous.rows).toEqual([['8', ''], ['', '']]);
    });
    it('rejects oversized ranges before changing existing data', () => {
        const previous = emptyTable(1, 1);
        expect(() => pasteTableCells(previous, 499, 0, '1\n2')).toThrow();
        expect(() => pasteTableCells(previous, 0, 49, '1\t2')).toThrow();
        expect(previous).toEqual(emptyTable(1, 1));
    });
    it('tints bright notes consistently without changing their saved color', () => {
        expect(paperColor('#00ffff')).toBe('#a6ffff'); expect(paperColor('#facc15')).toBe('#fdedad');
        expect(paperColor('#fff')).toBe('#ffffff'); expect(paperColor('red')).toBe('red');
    });
});
