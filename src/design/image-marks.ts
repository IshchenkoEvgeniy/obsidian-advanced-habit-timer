import type { BoardItem, SketchStroke } from './types';
export function imageMarkPath(stroke: SketchStroke, w: number, h: number, crop: BoardItem['crop'] = { x: 0, y: 0, w: 1, h: 1 }): string {
    return stroke.points.map(([x, y], index) => `${index ? 'L' : 'M'} ${(x - crop!.x) * w / crop!.w} ${(y - crop!.y) * h / crop!.h}`).join(' ');
}
export function imageStrokeHit(stroke: SketchStroke, point: { x: number; y: number }, w: number, h: number, radius = 18): boolean {
    const p = { x: point.x * w, y: point.y * h };
    return stroke.points.some(([x, y], index) => {
        const previous = stroke.points[Math.max(0, index - 1)]!, a = { x: previous[0] * w, y: previous[1] * h }, b = { x: x * w, y: y * h };
        const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= radius + stroke.width * w / 2;
    });
}
