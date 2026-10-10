import { describe, expect, it } from 'vitest';
import { straightPoint } from '../src/design/straight';

describe('straightPoint', () => {
    const start = { x: 0, y: 0, w: 20, h: 20 };

    it('returns the point unchanged without a start object', () => {
        expect(straightPoint(undefined, { x: 5, y: 7 })).toEqual({ x: 5, y: 7 });
    });

    it('snaps a nearly horizontal drag to a horizontal line through the start center', () => {
        const p = straightPoint(start, { x: 100, y: 12 });
        expect(p.y).toBeCloseTo(10, 6);
        expect(p.x).toBeCloseTo(10 + Math.hypot(90, 2), 6);
    });

    it('snaps a nearly vertical drag to a vertical line through the start center', () => {
        const p = straightPoint(start, { x: 12, y: 80 });
        expect(p.x).toBeCloseTo(10, 6);
        expect(p.y).toBeCloseTo(10 + Math.hypot(2, 70), 6);
    });

    it('snaps a nearly diagonal drag to a 45° line', () => {
        const p = straightPoint(start, { x: 60, y: 62 });
        expect(p.x).toBeCloseTo(p.y, 6);
    });

    it('keeps the distance from the start center', () => {
        const p = straightPoint(start, { x: 60, y: 62 });
        expect(Math.hypot(p.x - 10, p.y - 10)).toBeCloseTo(Math.hypot(50, 52), 6);
    });
});
