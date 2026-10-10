import { contained } from './board';
import type { BoardItem, DesignBoard } from './types';

export const COLUMN_PADDING = 16, COLUMN_HEADER = 60, COLUMN_GAP = 12;
export function columnMembers(board: DesignBoard, column: BoardItem): BoardItem[] {
    return board.items.filter(item => !item.unsorted && item.kind !== 'anchor' && item.kind !== 'stroke' && item.kind !== 'frame' &&
        (column.columnManaged ? item.columnId === column.id : contained(column, item)))
        .sort((a, b) => (a.columnOrder ?? a.y) - (b.columnOrder ?? b.y) || a.x - b.x);
}
/** Legacy geometric columns are adopted only when their layout is explicitly edited. */
export function manageColumn(board: DesignBoard, column: BoardItem): void {
    if (column.columnManaged) return;
    const members = columnMembers(board, column); column.columnManaged = true;
    members.forEach((item, index) => { item.columnId = column.id; item.columnOrder = index; });
}
export function layoutColumn(board: DesignBoard, column: BoardItem): void {
    if (!column.column || column.locked || column.unsorted) return;
    manageColumn(board, column);
    let y = column.y + COLUMN_HEADER;
    const width = Math.max(80, column.w - COLUMN_PADDING * 2);
    columnMembers(board, column).forEach(item => {
        if (!item.locked) {
            if (item.kind === 'image') item.h *= width / item.w;
            if (item.kind === 'sketch' && Math.abs(width - item.w) > .001) {
                const scale = width / item.w; item.h *= scale;
                item.sketch = item.sketch?.map(stroke => ({ ...stroke, width: Math.min(100, stroke.width * scale), points: stroke.points.map(([x, y]) => [x * scale, y * scale] as [number, number]) }));
            }
            item.x = column.x + COLUMN_PADDING; item.y = y; item.w = width;
        }
        y = Math.max(y, item.y) + item.h + COLUMN_GAP;
    });
    column.h = Math.max(180, y - column.y + COLUMN_PADDING - COLUMN_GAP);
}
export function reflowColumns(board: DesignBoard): void {
    for (const column of board.items.filter(item => item.column && item.columnManaged)) layoutColumn(board, column);
}
export interface ColumnDrop { id: string; index: number; x: number; y: number; w: number; }
export function columnDrop(board: DesignBoard, point: { x: number; y: number }, moving: Set<string>): ColumnDrop | undefined {
    const column = board.items.filter(item => item.column && !item.locked && !item.unsorted && !item.rotation && !moving.has(item.id) &&
        point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + (item.collapsed ? 44 : item.h) + 24)
        .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (!column) return;
    const members = columnMembers(board, column).filter(item => !moving.has(item.id));
    let index = members.findIndex(item => point.y < item.y + item.h / 2); if (index < 0) index = members.length;
    const previous = members[index - 1];
    return { id: column.id, index, x: column.x + COLUMN_PADDING, y: previous ? previous.y + previous.h + COLUMN_GAP / 2 : column.y + COLUMN_HEADER - COLUMN_GAP / 2, w: column.w - COLUMN_PADDING * 2 };
}
/** Detach from the old column before inserting, so moving a card never leaves two owners. */
export function placeInColumn(board: DesignBoard, ids: Set<string>, target?: ColumnDrop): void {
    const moving = board.items.filter(item => ids.has(item.id) && !item.locked && !['frame', 'anchor', 'stroke'].includes(item.kind));
    if (!moving.length) return;
    const affected = new Set(moving.map(item => item.columnId).filter((id): id is string => Boolean(id)));
    for (const column of board.items.filter(item => item.column && !item.columnManaged)) {
        if (columnMembers(board, column).some(item => ids.has(item.id))) { manageColumn(board, column); affected.add(column.id); }
    }
    moving.forEach(item => { item.columnId = undefined; item.columnOrder = undefined; });
    const column = target && board.items.find(item => item.id === target.id && item.column && !item.locked);
    if (column && target) {
        manageColumn(board, column);
        const members = columnMembers(board, column).filter(item => !ids.has(item.id));
        members.splice(target.index, 0, ...moving.sort((a, b) => a.y - b.y || a.x - b.x));
        members.forEach((item, index) => { item.unsorted = undefined; item.columnId = column.id; item.columnOrder = index; });
        column.collapsed = false; affected.add(column.id);
    }
    for (const id of affected) { const parent = board.items.find(item => item.id === id); if (parent) layoutColumn(board, parent); }
}
