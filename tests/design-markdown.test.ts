import { describe, expect, it } from 'vitest';
import { boardToMarkdown } from '../src/design/markdown-board';
import { tableToMarkdown } from '../src/design/table';
import type { DesignBoard } from '../src/design/types';

const board = (items: unknown[], edges: unknown[] = []): DesignBoard => ({ format: 2, id: 'b', name: 'Plan', viewport: { x: 0, y: 0, zoom: 1 }, items, edges } as unknown as DesignBoard);

describe('board to Markdown', () => {
    it('keeps nested frame contents under the innermost heading and exports all line labels', () => {
        const doc = board([
            { id: 'outer', kind: 'frame', x: 0, y: 0, w: 600, h: 600, z: -2, title: 'Outer' },
            { id: 'inner', kind: 'frame', x: 50, y: 50, w: 300, h: 300, z: -1, title: 'Inner' },
            { id: 'a', kind: 'sticky', x: 80, y: 80, w: 50, h: 50, z: 1, text: 'A' },
            { id: 'b', kind: 'sticky', x: 400, y: 80, w: 50, h: 50, z: 1, text: 'B' },
        ], [{ id: 'edge', from: 'a', to: 'b', style: 'straight', arrow: 'end', label: 'Old', labels: [{ id: 'one', text: 'First' }, { id: 'two', text: 'Second' }] }]);
        const text = boardToMarkdown(doc, item => item.text || ''); expect(text).toContain('## Outer\n\n- B'); expect(text).toContain('### Inner\n\n- A'); expect(text).toContain('- A → B (First; Second)'); expect(text).not.toContain('(Old)');
    });
    it('turns frames into headings and lists the objects inside them', () => {
        const doc = board([
            { id: 'f', kind: 'frame', x: 0, y: 0, w: 300, h: 300, z: 0, title: 'Goals' },
            { id: 's', kind: 'sticky', x: 10, y: 40, w: 50, h: 50, z: 1, text: 'Win' },
            { id: 'e', kind: 'entity', x: 500, y: 0, w: 50, h: 50, z: 1, ref: 'r1' },
        ]);
        const text = boardToMarkdown(doc, item => item.kind === 'entity' ? '[[Hero]]' : item.text || '');
        expect(text.startsWith('# Plan\n\n## Goals\n\n- Win\n')).toBe(true);
        expect(text).toContain('- [[Hero]]');
    });

    it('keeps task blocks as they are and labels links by the first line of each object', () => {
        const doc = board([
            { id: 'a', kind: 'sticky', x: 0, y: 0, w: 10, h: 10, z: 1, text: 'A' },
            { id: 'b', kind: 'todo', x: 100, y: 0, w: 10, h: 10, z: 1, text: '- [ ] one\n- [x] two' },
        ], [{ id: 'e', from: 'a', to: 'b', style: 'straight', label: 'then', arrow: 'end' }]);
        const text = boardToMarkdown(doc, item => item.text || '');
        expect(text).toContain('- [ ] one\n- [x] two');
        expect(text).toContain('## Связи');
        expect(text).toContain('- A → one (then)');
    });

    it('marks links without an arrowhead with a dash', () => {
        const doc = board([
            { id: 'a', kind: 'sticky', x: 0, y: 0, w: 10, h: 10, z: 1, text: 'A' },
            { id: 'b', kind: 'sticky', x: 100, y: 0, w: 10, h: 10, z: 1, text: 'B' },
        ], [{ id: 'e', from: 'a', to: 'b', style: 'straight', label: '', arrow: 'none' }]);
        expect(boardToMarkdown(doc, item => item.text || '')).toContain('- A — B');
    });
});

describe('table to Markdown', () => {
    it('writes the header, separator and the values the card shows, with formulas evaluated', () => {
        const table = { columns: [{ name: 'Item', type: 'text' }, { name: 'Cost', type: 'number' }], rows: [['Bread', '2'], ['Total', '=SUM(B1)']] };
        expect(tableToMarkdown(table as never)).toBe('| Item | Cost |\n| --- | --- |\n| Bread | 2 |\n| Total | 2 |');
    });

    it('escapes pipes inside cells', () => {
        const table = { columns: [{ name: 'Note', type: 'text' }], rows: [['a|b']] };
        expect(tableToMarkdown(table as never)).toContain('| a\\|b |');
    });
});
