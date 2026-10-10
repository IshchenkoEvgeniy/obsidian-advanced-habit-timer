import { describe, expect, it } from 'vitest';
import { columnRowMembers, planColumnRow } from '../src/design/columns';

describe('column row slots', () => {
    it('slides the neighbour into the start slot when the dragged column passes it', () => {
        // The dragged column is centred at 350, its neighbour at 200: the dragged column now sits on the right.
        expect(planColumnRow([
            { id: 'a', x: 300, w: 100, base: 0 },
            { id: 'b', x: 150, w: 100, base: 150 },
        ])).toEqual([{ id: 'b', x: 0 }, { id: 'a', x: 150 }]);
    });

    it('keeps the order when the dragged column stays on its own side', () => {
        expect(planColumnRow([
            { id: 'a', x: 40, w: 100, base: 0 },
            { id: 'b', x: 150, w: 100, base: 150 },
        ])).toEqual([{ id: 'a', x: 0 }, { id: 'b', x: 150 }]);
    });

    it('builds the slots from start positions, so the layout does not change while the pointer moves', () => {
        const near = planColumnRow([{ id: 'a', x: 260, w: 100, base: 0 }, { id: 'b', x: 150, w: 100, base: 150 }]);
        const far = planColumnRow([{ id: 'a', x: 500, w: 100, base: 0 }, { id: 'b', x: 150, w: 100, base: 150 }]);
        expect(near).toEqual(far);
    });

    it('keeps the widths and an average gap across three columns', () => {
        expect(planColumnRow([
            { id: 'a', x: 0, w: 100, base: 0 },
            { id: 'b', x: 200, w: 60, base: 200 },
            { id: 'c', x: -300, w: 80, base: 400 },
        ])).toEqual([{ id: 'c', x: 0 }, { id: 'a', x: 200 }, { id: 'b', x: 420 }]);
    });

    it('has nothing to reorder for a single column', () => {
        expect(planColumnRow([{ id: 'a', x: 0, w: 100, base: 0 }])).toEqual([]);
    });
});

describe('column row members', () => {
    it('takes columns that share at least 40 % of the shorter height', () => {
        const dragged = { id: 'd', x: 0, y: 100, w: 100, h: 300 };
        const columns = [
            { id: 'same', x: 200, y: 120, w: 100, h: 300 },
            { id: 'below', x: 200, y: 600, w: 100, h: 300 },
            { id: 'short', x: 200, y: 380, w: 100, h: 100 },
        ];
        expect(columnRowMembers(columns, dragged).map(column => column.id)).toEqual(['same']);
    });
});
