export interface StraightBox { x: number; y: number; w: number; h: number }

/**
 * Snaps the direction from the center of `start` to `p` to the nearest 45° step (horizontal, vertical or diagonal).
 * Without a start object the point is returned unchanged.
 */
export function straightPoint(start: StraightBox | undefined, p: { x: number; y: number }): { x: number; y: number } {
    if (!start) return p;
    const x = start.x + start.w / 2, y = start.y + start.h / 2;
    const angle = Math.round(Math.atan2(p.y - y, p.x - x) / (Math.PI / 4)) * Math.PI / 4;
    const length = Math.hypot(p.x - x, p.y - y);
    return { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length };
}

export type FacingSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Shift-linking between two objects: the sides that face each other along the dominant axis of the
 * centers, so the link runs straight across the gap instead of picking the nearest corner-side.
 */
export function straightSides(from: StraightBox | undefined, to: StraightBox | undefined): { from: FacingSide; to: FacingSide } | undefined {
    if (!from || !to) return undefined;
    const dx = (to.x + to.w / 2) - (from.x + from.w / 2), dy = (to.y + to.h / 2) - (from.y + from.h / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
    return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}
