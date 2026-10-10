export type Corner = 'nw' | 'ne' | 'se' | 'sw';
export const CORNERS: Corner[] = ['nw', 'ne', 'se', 'sw'];
export interface CornerBox { x: number; y: number; w: number; h: number; rotation?: number }

/**
 * Position of a corner on the canvas, following the object's rotation around its center.
 * Rotation is in degrees, clockwise on screen (y grows downward), as the board stores it.
 */
export function cornerPoint(box: CornerBox, corner: Corner): { x: number; y: number } {
    const x = corner.includes('e') ? box.x + box.w : box.x, y = corner.includes('s') ? box.y + box.h : box.y;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, angle = (box.rotation || 0) * Math.PI / 180;
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
}
