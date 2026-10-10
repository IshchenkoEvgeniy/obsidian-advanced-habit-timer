import { deleteItems, movingIds } from './board';
import { clone, uid, type DesignBoard } from './types';
import { reflowColumns } from './column-layout';

export function stashItems(board: DesignBoard, selected: Set<string>): string[] {
    if (board.readOnly) return [];
    const ids = movingIds(board, selected), stashed: string[] = [];
    for (const item of board.items) if (ids.has(item.id) && !item.locked) { item.unsorted = true; if (item.columnId && !ids.has(item.columnId)) { item.columnId = undefined; item.columnOrder = undefined; } stashed.push(item.id); }
    for (const edge of board.edges) if (ids.has(edge.id)) edge.unsorted = true;
    reflowColumns(board); return stashed;
}
export function placeFromShelf(board: DesignBoard, id: string, point: { x: number; y: number }): Set<string> {
    if (board.readOnly) return new Set();
    const edge = board.edges.find(edge => edge.id === id);
    const item = board.items.find(item => (item.id === id || item.id === edge?.from || item.id === edge?.to) && item.unsorted && !item.locked);
    if (edge?.unsorted) edge.unsorted = undefined;
    if (!item) return edge ? new Set([id]) : new Set();
    const ids = movingIds(board, new Set([id])), dx = point.x - item.x, dy = point.y - item.y;
    for (const child of board.items) if (ids.has(child.id) && !child.locked) { child.unsorted = undefined; if (!child.columnId || !ids.has(child.columnId)) { child.columnId = undefined; child.columnOrder = undefined; } child.x += dx; child.y += dy; }
    reflowColumns(board); return ids;
}
export function trashItems(board: DesignBoard, selected: Set<string>): void {
    if (board.readOnly) return;
    const before = { items: board.items, edges: board.edges }; deleteItems(board, selected);
    const itemIds = new Set(board.items.map(item => item.id)), edgeIds = new Set(board.edges.map(edge => edge.id));
    const items = clone(before.items.filter(item => !itemIds.has(item.id))), edges = clone(before.edges.filter(edge => !edgeIds.has(edge.id)));
    if (!items.length && !edges.length) return;
    (board.trash ??= []).unshift({ id: uid(), deletedAt: Date.now(), items, edges });
    reflowColumns(board);
}
/** Restore original IDs and boundary connections where possible; never overwrite an existing object. */
export function restoreTrash(board: DesignBoard, id: string): Set<string> {
    if (board.readOnly) return new Set();
    const entry = board.trash?.find(entry => entry.id === id); if (!entry) return new Set();
    const items = new Set(board.items.map(item => item.id)), edges = new Set(board.edges.map(edge => edge.id));
    const mapping = new Map(entry.items.map(item => [item.id, items.has(item.id) ? uid() : item.id]));
    const restored = clone(entry.items).map(item => ({ ...item, id: mapping.get(item.id)!, columnId: mapping.get(item.columnId || '') || item.columnId, mindParent: mapping.get(item.mindParent || '') || item.mindParent }));
    board.items.push(...restored); restored.forEach(item => items.add(item.id));
    const waiting = [] as typeof entry.edges;
    for (const edge of clone(entry.edges)) {
        edge.from = mapping.get(edge.from) || edge.from; edge.to = mapping.get(edge.to) || edge.to;
        if (!items.has(edge.from) || !items.has(edge.to)) { waiting.push(edge); continue; }
        if (edges.has(edge.id)) edge.id = uid(); board.edges.push(edge); edges.add(edge.id);
    }
    // If a parent column was deleted later, recovered cards remain usable on the canvas.
    for (const item of restored) if (item.columnId && !board.items.some(parent => parent.id === item.columnId && parent.column)) item.columnId = undefined;
    board.trash = board.trash!.filter(entry => entry.id !== id);
    if (waiting.length) board.trash.push({ ...entry, items: [], edges: waiting });
    // Reconnect previously restored cards when their other endpoint has just returned.
    board.trash = board.trash.filter(pending => {
        if (pending.items.length) return true;
        pending.edges = pending.edges.filter(edge => {
            if (!items.has(edge.from) || !items.has(edge.to)) return true;
            const copy = clone(edge); if (edges.has(copy.id)) copy.id = uid(); board.edges.push(copy); edges.add(copy.id); return false;
        });
        return pending.edges.length > 0;
    });
    reflowColumns(board);
    return new Set(restored.filter(item => item.kind !== 'anchor' && !item.unsorted).map(item => item.id));
}
