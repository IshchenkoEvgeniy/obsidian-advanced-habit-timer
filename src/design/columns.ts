/**
 * Column rows (Milanote-style). Pure geometry: the board decides what to draw, this file decides where columns land
 * while one of them is dragged along a row.
 */
export interface Box { id: string; x: number; y: number; w: number; h: number }
export interface RowMember { id: string; x: number; w: number; base: number }
export interface Slot { id: string; x: number }

/** Columns that share a horizontal band with the dragged column: the overlap is at least 40 % of the shorter height. */
export function columnRowMembers(columns: Box[], dragged: Box): Box[] {
    return columns.filter(column => {
        const overlap = Math.min(column.y + column.h, dragged.y + dragged.h) - Math.max(column.y, dragged.y);
        return overlap >= 0.4 * Math.min(column.h, dragged.h);
    });
}

/**
 * Slots for a row of columns while one of them is dragged. `x` is where a column is now (the dragged one moves with
 * the pointer), `base` is where it stood when the drag started. Order follows the current centres; the slots are built
 * from the start positions and the average gap, so the row does not jitter while the pointer moves.
 * A single column has nothing to reorder, so it returns no slots.
 */
export function planColumnRow(members: RowMember[]): Slot[] {
    if (members.length < 2) return [];
    const order = [...members].sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2) || a.base - b.base);
    const left = Math.min(...members.map(member => member.base));
    const right = Math.max(...members.map(member => member.base + member.w));
    const width = members.reduce((sum, member) => sum + member.w, 0);
    const gap = Math.max(8, (right - left - width) / (members.length - 1));
    let cursor = left;
    return order.map(member => {
        const slot = { id: member.id, x: cursor };
        cursor += member.w + gap;
        return slot;
    });
}
