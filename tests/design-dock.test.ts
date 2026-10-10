import { describe, expect, it } from 'vitest';
import { clampDock, parseDock, serializeDock, snapDock } from '../src/design/dock';

const area = { w: 800, h: 600 }, panel = { w: 76, h: 500 };

describe('board menu position', () => {
    it('keeps the menu inside the area with an 8 px margin', () => {
        expect(clampDock({ x: -50, y: -10 }, area, panel)).toEqual({ x: 8, y: 8 });
        expect(clampDock({ x: 900, y: 700 }, area, panel)).toEqual({ x: 716, y: 92 });
    });

    it('keeps a menu taller than the area at the top margin', () => {
        expect(clampDock({ x: 100, y: 100 }, { w: 800, h: 300 }, panel)).toEqual({ x: 100, y: 8 });
    });

    // A taller area, so a menu at y = 200 fits (the 500 px panel can only reach y = 392 here).
    const tall = { w: 800, h: 900 };

    it('snaps to the left, right and top margins when released close to them', () => {
        expect(snapDock({ x: 14, y: 200 }, tall, panel)).toEqual({ x: 8, y: 200 });
        expect(snapDock({ x: 700, y: 200 }, tall, panel)).toEqual({ x: 716, y: 200 });
        expect(snapDock({ x: 30, y: 5 }, tall, panel)).toEqual({ x: 8, y: 8 });
    });

    it('does not snap when the menu is in the middle', () => {
        expect(snapDock({ x: 400, y: 200 }, tall, panel)).toEqual({ x: 400, y: 200 });
    });
});

describe('board menu storage', () => {
    it('round-trips a rounded position', () => {
        expect(parseDock(serializeDock({ x: 12.4, y: 99.6 }))).toEqual({ x: 12, y: 100 });
    });

    it('ignores missing or damaged values', () => {
        expect(parseDock(undefined)).toBeUndefined();
        expect(parseDock('')).toBeUndefined();
        expect(parseDock('nope')).toBeUndefined();
        expect(parseDock('null')).toBeUndefined();
        expect(parseDock('{"x":"1","y":2}')).toBeUndefined();
    });
});
