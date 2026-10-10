import { describe, expect, it } from 'vitest';
import { cornerPoint } from '../src/design/corners';

describe('cornerPoint', () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };

    it('returns the plain corners of an unrotated box', () => {
        expect(cornerPoint(box, 'nw')).toEqual({ x: 0, y: 0 });
        expect(cornerPoint(box, 'ne')).toEqual({ x: 10, y: 0 });
        expect(cornerPoint(box, 'se')).toEqual({ x: 10, y: 10 });
        expect(cornerPoint(box, 'sw')).toEqual({ x: 0, y: 10 });
    });

    it('moves the corners with a 90° clockwise rotation around the center', () => {
        const p = cornerPoint({ ...box, rotation: 90 }, 'nw');
        expect(p.x).toBeCloseTo(10, 6);
        expect(p.y).toBeCloseTo(0, 6);
    });

    it('keeps the corner distance from the center when rotated', () => {
        const p = cornerPoint({ ...box, rotation: 37 }, 'se');
        expect(Math.hypot(p.x - 5, p.y - 5)).toBeCloseTo(Math.hypot(5, 5), 6);
    });
});
