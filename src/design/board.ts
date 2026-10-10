import { DesignError, ITEM_KINDS, SHAPES, clone, uid, type BoardItem, type DesignBoard } from './types';
import { CELL_TYPES } from './table';
import { edgePoints } from './geometry';

export function newBoard(name: string): DesignBoard { return { format: 2, id: uid(), name, viewport: { x: 0, y: 0, zoom: 1 }, items: [], edges: [], grid: true, snap: false }; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
/** Table data: named, typed columns and rows of text whose length matches the column count. */
function validTable(table: unknown): boolean {
    if (!table || typeof table !== 'object') return false;
    const { columns, rows } = table as { columns?: unknown; rows?: unknown };
    if (!Array.isArray(columns) || !Array.isArray(rows) || columns.length > 50 || rows.length > 500) return false;
    const columnsValid = columns.every(column => typeof column === 'object' && column !== null && typeof (column as { name?: unknown }).name === 'string' && CELL_TYPES.some(type => type === (column as { type?: unknown }).type));
    return columnsValid && rows.every(row => Array.isArray(row) && row.length === columns.length && row.every(cell => typeof cell === 'string'));
}
/** Sketch strokes: points inside the card, positive width, optional color and opacity. */
function validSketch(sketch: unknown): boolean {
    return Array.isArray(sketch) && sketch.every(stroke => stroke && typeof stroke === 'object' && Array.isArray(stroke.points) && stroke.points.every((point: unknown) => Array.isArray(point) && point.length === 2 && point.every(finite)) &&
        finite(stroke.width) && stroke.width > 0 && stroke.width <= 100 && (stroke.color === undefined || typeof stroke.color === 'string') && (stroke.opacity === undefined || (finite(stroke.opacity) && stroke.opacity >= 0 && stroke.opacity <= 1)));
}
export function parseBoard(raw: string): DesignBoard {
    let value: DesignBoard;
    try { value = JSON.parse(raw) as DesignBoard; } catch { throw new DesignError('design_invalid'); }
    if (!value || typeof value !== 'object') throw new DesignError('design_invalid');
    if (value.format !== 2) {
        if (![0, 1].includes(value.format as number)) throw new DesignError('design_future');
        // Version 0 prototype lacked viewport and explicit item dimensions/layers.
        value.format = 2; value.viewport ??= { x: 0, y: 0, zoom: 1 };
    }
    if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.items) || !Array.isArray(value.edges) ||
        !value.viewport || !finite(value.viewport.x) || !finite(value.viewport.y) || !finite(value.viewport.zoom) || value.viewport.zoom < .08 || value.viewport.zoom > 4) throw new DesignError('design_invalid');
    const ids = new Set<string>();
    for (const item of value.items) {
        if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !ITEM_KINDS.includes(item.kind) || !finite(item.x) || !finite(item.y)) throw new DesignError('design_invalid');
        ids.add(item.id);
        if (item.kind === 'world-view' && (!item.worldView || typeof item.worldView.typeId !== 'string' || !item.worldView.typeId || typeof item.worldView.viewId !== 'string' || !item.worldView.viewId)) throw new DesignError('design_invalid');
        item.w ??= 220; item.h ??= 140; item.z ??= 1;
        if (!finite(item.w) || !finite(item.h) || item.w <= 0 || item.h <= 0 || !finite(item.z) ||
            (['entity', 'board'].includes(item.kind) && (typeof item.ref !== 'string' || !item.ref)) ||
            (item.points && (!Array.isArray(item.points) || item.points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(finite))))) throw new DesignError('design_invalid');
        for (const key of ['text', 'title', 'color', 'path', 'ref', 'richText', 'groupId', 'mindParent', 'strokeColor', 'band'] as const) if (item[key] !== undefined && typeof item[key] !== 'string') throw new DesignError('design_invalid');
        if (item.shape && !SHAPES.includes(item.shape)) throw new DesignError('design_invalid');
        if (item.width !== undefined && (!finite(item.width) || item.width <= 0 || item.width > 100)) throw new DesignError('design_invalid');
        if ((item.locked !== undefined && typeof item.locked !== 'boolean') || (item.autoSize !== undefined && typeof item.autoSize !== 'boolean') || (item.rotation !== undefined && !finite(item.rotation)) || (item.opacity !== undefined && (!finite(item.opacity) || item.opacity < 0 || item.opacity > 1)) || (item.strokeWidth !== undefined && (!finite(item.strokeWidth) || item.strokeWidth < 0 || item.strokeWidth > 100)) || (item.strokeDash && !['solid', 'dash', 'dot'].includes(item.strokeDash))) throw new DesignError('design_invalid');
        if (item.textStyle && ((item.textStyle.fontSize !== undefined && (!finite(item.textStyle.fontSize) || item.textStyle.fontSize < 6 || item.textStyle.fontSize > 200)) || (item.textStyle.color !== undefined && typeof item.textStyle.color !== 'string') || (item.textStyle.align && !['left', 'center', 'right'].includes(item.textStyle.align)))) throw new DesignError('design_invalid');
        if (item.crop && (![item.crop.x, item.crop.y, item.crop.w, item.crop.h].every(finite) || item.crop.x < 0 || item.crop.y < 0 || item.crop.w <= 0 || item.crop.h <= 0 || item.crop.x + item.crop.w > 1.000001 || item.crop.y + item.crop.h > 1.000001)) throw new DesignError('design_invalid');
        if ((item.column !== undefined && typeof item.column !== 'boolean') || (item.collapsed !== undefined && typeof item.collapsed !== 'boolean')) throw new DesignError('design_invalid');
        if ((item.table !== undefined && !validTable(item.table)) || (item.sketch !== undefined && !validSketch(item.sketch))) throw new DesignError('design_invalid');
        if (['unsorted', 'columnManaged'].some(key => item[key as 'unsorted'] !== undefined && typeof item[key as 'unsorted'] !== 'boolean') ||
            (item.columnId !== undefined && typeof item.columnId !== 'string') || (item.columnOrder !== undefined && !finite(item.columnOrder)) ||
            (item.imageStrokes !== undefined && (!validSketch(item.imageStrokes) || item.imageStrokes.some(stroke => stroke.width > 1 || stroke.points.some(point => point.some(value => value < 0 || value > 1))))) ||
            (item.preview !== undefined && (!item.preview || typeof item.preview !== 'object' || Object.values(item.preview).some(value => typeof value !== 'string')))) throw new DesignError('design_invalid');
    }
    const edgeIds = new Set<string>();
    for (const edge of value.edges) {
        if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id) || !ids.has(edge.from) || !ids.has(edge.to) ||
            !['straight', 'elbow', 'curve'].includes(edge.style) || !['end', 'both', 'none'].includes(edge.arrow) || typeof edge.label !== 'string') throw new DesignError('design_invalid');
        for (const side of [edge.fromSide, edge.toSide]) if (side && !['top', 'right', 'bottom', 'left', 'center'].includes(side)) throw new DesignError('design_invalid');
        if ((edge.color !== undefined && typeof edge.color !== 'string') || (edge.width !== undefined && (!finite(edge.width) || edge.width <= 0 || edge.width > 100)) || (edge.dash && !['solid', 'dash', 'dot'].includes(edge.dash)) || (edge.bends && (!Array.isArray(edge.bends) || edge.bends.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite))))) throw new DesignError('design_invalid');
        const labels = new Set<string>();
        if (edge.labels !== undefined && (!Array.isArray(edge.labels) || edge.labels.some(label => { if (!label || typeof label.id !== 'string' || !label.id || labels.has(label.id) || typeof label.text !== 'string' || (label.x !== undefined && !finite(label.x)) || (label.y !== undefined && !finite(label.y)) || (label.offsetX !== undefined && !finite(label.offsetX)) || (label.offsetY !== undefined && !finite(label.offsetY)) || (label.t !== undefined && (!finite(label.t) || label.t < 0 || label.t > 1))) return true; labels.add(label.id); return false; }))) throw new DesignError('design_invalid');
        edgeIds.add(edge.id);
        if (edge.unsorted !== undefined && typeof edge.unsorted !== 'boolean') throw new DesignError('design_invalid');
    }
    if ((value.background !== undefined && typeof value.background !== 'string') || (value.mindMap !== undefined && typeof value.mindMap !== 'boolean') || (value.readOnly !== undefined && typeof value.readOnly !== 'boolean') || (value.template !== undefined && typeof value.template !== 'boolean')) throw new DesignError('design_invalid');
    if ((value.cover !== undefined && typeof value.cover !== 'string') || (value.icon !== undefined && typeof value.icon !== 'string')) throw new DesignError('design_invalid');
    if (value.trash !== undefined) {
        if (!Array.isArray(value.trash)) throw new DesignError('design_invalid');
        const trashIds = new Set<string>();
        for (const entry of value.trash) {
            if (!entry || typeof entry.id !== 'string' || !entry.id || trashIds.has(entry.id) || !finite(entry.deletedAt) || !Array.isArray(entry.items) || !Array.isArray(entry.edges)) throw new DesignError('design_invalid');
            trashIds.add(entry.id);
            if (entry.items.some(item => !item || typeof item.id !== 'string')) throw new DesignError('design_invalid');
            const entryIds = new Set(entry.items.map(item => item.id));
            if (entryIds.size !== entry.items.length) throw new DesignError('design_invalid');
            // Validate the deleted graph only. Revalidating every live card for each trash entry made saves quadratic.
            const graph = new Map(entry.items.map(item => [item.id, item]));
            for (const edge of entry.edges) for (const id of [edge?.from, edge?.to]) if (typeof id === 'string' && !graph.has(id)) graph.set(id, { id, kind: 'anchor', x: 0, y: 0, w: 1, h: 1, z: -1 });
            parseBoard(JSON.stringify({ format: 2, id: value.id, name: value.name, viewport: value.viewport, items: [...graph.values()], edges: entry.edges }));
        }
    }
    return value;
}
export function serializeBoard(board: DesignBoard): string { return JSON.stringify(parseBoard(JSON.stringify(board)), null, 2) + '\n'; }
export function contained(frame: BoardItem, item: BoardItem): boolean {
    if (frame.column && frame.columnManaged) return frame.id !== item.id && item.columnId === frame.id;
    return frame.id !== item.id && item.x >= frame.x && item.y >= frame.y && item.x + item.w <= frame.x + frame.w && item.y + item.h <= frame.y + frame.h;
}
export function visible(item: BoardItem, view: DesignBoard['viewport'], width: number, height: number): boolean {
    item = { ...item, ...itemBounds(item) };
    return (item.x + item.w) * view.zoom + view.x >= -80 && item.x * view.zoom + view.x <= width + 80 &&
        (item.y + item.h) * view.zoom + view.y >= -80 && item.y * view.zoom + view.y <= height + 80;
}
export function zoomAt(view: DesignBoard['viewport'], zoom: number, x: number, y: number): DesignBoard['viewport'] {
    zoom = Math.max(.08, Math.min(4, zoom));
    return { x: x - (x - view.x) * zoom / view.zoom, y: y - (y - view.y) * zoom / view.zoom, zoom };
}
export class BoardHistory {
    private undoStack: DesignBoard[] = []; private redoStack: DesignBoard[] = [];
    get canUndo(): boolean { return this.undoStack.length > 0; }
    get canRedo(): boolean { return this.redoStack.length > 0; }
    push(board: DesignBoard): void { this.undoStack.push(clone(board)); if (this.undoStack.length > 120) this.undoStack.shift(); this.redoStack = []; }
    undo(board: DesignBoard): DesignBoard { const previous = this.undoStack.pop(); if (!previous) return board; this.redoStack.push(clone(board)); return clone(previous); }
    redo(board: DesignBoard): DesignBoard { const next = this.redoStack.pop(); if (!next) return board; this.undoStack.push(clone(board)); return clone(next); }
}
export function duplicateItems(board: DesignBoard, ids: Set<string>, source = board, offset = { x: 30, y: 30 }): string[] {
    const graph = selectionBoard(source, ids);
    const mapping = new Map<string, string>();
    const groups = new Map<string, string>();
    let nextZ = board.items.reduce((max, item) => Math.max(max, item.z), 0);
    for (const item of graph.items) {
        const id = uid(); mapping.set(item.id, id); if (item.groupId && !groups.has(item.groupId)) groups.set(item.groupId, uid()); board.items.push({ ...clone(item), id, groupId: item.groupId ? groups.get(item.groupId) : undefined, x: item.x + offset.x, y: item.y + offset.y, z: ++nextZ });
    }
    const copiedIds = new Set(mapping.values());
    for (const item of board.items.filter(item => copiedIds.has(item.id))) { if (item.mindParent) item.mindParent = mapping.get(item.mindParent); if (item.columnId) item.columnId = mapping.get(item.columnId); }
    const copiedEdges: string[] = [];
    for (const edge of graph.edges) { const id = uid(); board.edges.push({ ...clone(edge), id, from: mapping.get(edge.from)!, to: mapping.get(edge.to)!, labels: edge.labels?.map(label => ({ ...label, id: uid(), x: label.x === undefined ? undefined : label.x + offset.x, y: label.y === undefined ? undefined : label.y + offset.y })), bends: edge.bends?.map(([x, y]) => [x + offset.x, y + offset.y]) }); if (ids.has(edge.id)) copiedEdges.push(id); }
    return [...graph.items.filter(item => item.kind !== 'anchor').map(item => mapping.get(item.id)!), ...copiedEdges];
}
/** Copy a complete selection, including frame contents and the invisible ends of free lines. */
export function selectionBoard(source: DesignBoard, ids: Set<string>): DesignBoard {
    ids = expandSelection(source, ids);
    for (const frame of source.items.filter(item => item.kind === 'frame' && ids.has(item.id))) for (const child of source.items) if (contained(frame, child)) ids.add(child.id);
    const { items: _items, edges: _edges, trash: _trash, ...metadata } = source;
    const result = { ...clone(metadata), trash: undefined, items: clone(source.items.filter(item => ids.has(item.id))), edges: [] as DesignBoard['edges'] };
    const byId = new Map(source.items.map(item => [item.id, item]));
    for (const edge of source.edges) {
        if (!ids.has(edge.id) && !(ids.has(edge.from) && ids.has(edge.to))) continue;
        const copy = clone(edge), points = edgePoints(edge, byId);
        for (const end of ['from', 'to'] as const) if (!ids.has(edge[end])) {
            const item = byId.get(edge[end])!;
            const point = points[end === 'from' ? 'a' : 'b'];
            const anchor = item.kind === 'anchor' ? clone(item) : { id: uid(), kind: 'anchor' as const, x: point.x - .5, y: point.y - .5, w: 1, h: 1, z: -1 };
            if (!result.items.some(item => item.id === anchor.id)) result.items.push(anchor);
            copy[end] = anchor.id; copy[end === 'from' ? 'fromSide' : 'toSide'] = 'center';
        }
        result.edges.push(copy);
    }
    return result;
}
/** Hit tests use the same rotation and collapsed height as the rendered card. */
export function itemLocalPoint(item: BoardItem, point: { x: number; y: number }) {
    const h = item.column && item.collapsed ? Math.min(item.h, 44) : item.h;
    const dx = point.x - item.x - item.w / 2, dy = point.y - item.y - h / 2, angle = -(item.rotation || 0) * Math.PI / 180;
    return { x: dx * Math.cos(angle) - dy * Math.sin(angle) + item.w / 2, y: dx * Math.sin(angle) + dy * Math.cos(angle) + h / 2 };
}
export function hitItem(item: BoardItem, point: { x: number; y: number }): boolean {
    const local = itemLocalPoint(item, point);
    return local.x >= 0 && local.y >= 0 && local.x <= item.w && local.y <= (item.column && item.collapsed ? Math.min(item.h, 44) : item.h);
}
/** Move frame contents and free ends without moving an attached, unselected card. */
export function movingIds(board: DesignBoard, selected: Set<string>): Set<string> {
    const ids = expandSelection(board, selected);
    for (const frame of board.items.filter(item => selected.has(item.id) && item.kind === 'frame')) for (const child of board.items) if (contained(frame, child)) ids.add(child.id);
    for (const edge of board.edges.filter(edge => selected.has(edge.id))) for (const end of [edge.from, edge.to]) if (board.items.find(item => item.id === end)?.kind === 'anchor') ids.add(end);
    return ids;
}
export function deleteItems(board: DesignBoard, ids: Set<string>): void {
    ids = new Set([...ids].filter(id => !board.items.find(item => item.id === id)?.locked));
    board.items = board.items.filter(item => !ids.has(item.id)); board.edges = board.edges.filter(edge => !ids.has(edge.from) && !ids.has(edge.to) && !ids.has(edge.id));
    board.items = board.items.filter(item => item.kind !== 'anchor' || board.edges.some(edge => edge.from === item.id || edge.to === item.id));
}
export function itemBounds(item: BoardItem): { x: number; y: number; w: number; h: number } {
    const angle = (item.rotation || 0) * Math.PI / 180, w = Math.abs(Math.cos(angle) * item.w) + Math.abs(Math.sin(angle) * item.h), h = Math.abs(Math.sin(angle) * item.w) + Math.abs(Math.cos(angle) * item.h);
    return { x: item.x + (item.w - w) / 2, y: item.y + (item.h - h) / 2, w, h };
}
export function itemsBounds(items: BoardItem[]) { const values = items.map(itemBounds); const x = Math.min(...values.map(item => item.x)), y = Math.min(...values.map(item => item.y)); return { x, y, w: Math.max(...values.map(item => item.x + item.w)) - x, h: Math.max(...values.map(item => item.y + item.h)) - y }; }
export function expandSelection(board: DesignBoard, ids: Set<string>): Set<string> { const groups = new Set(board.items.filter(item => ids.has(item.id) && item.groupId).map(item => item.groupId)); return new Set([...ids, ...board.items.filter(item => item.groupId && groups.has(item.groupId)).map(item => item.id)]); }
export function groupItems(board: DesignBoard, ids: Set<string>, ungroup = false): void { const group = uid(); for (const item of board.items.filter(item => expandSelection(board, ids).has(item.id) && !item.locked)) item.groupId = ungroup ? undefined : group; }
export function followConnections(before: DesignBoard, after: DesignBoard): void { const oldItems = new Map(before.items.map(item => [item.id, item])), items = new Map(after.items.map(item => [item.id, item])); for (const edge of before.edges) { const current = after.edges.find(candidate => candidate.id === edge.id), a = oldItems.get(edge.from), b = oldItems.get(edge.to), nextA = items.get(edge.from), nextB = items.get(edge.to); if (!current || !a || !b || !nextA || !nextB) continue; const dx = nextA.x - a.x, dy = nextA.y - a.y; if ((!dx && !dy) || Math.abs(nextB.x - b.x - dx) > .001 || Math.abs(nextB.y - b.y - dy) > .001) continue; if (edge.bends) current.bends = edge.bends.map(([x, y]) => [x + dx, y + dy]); if (edge.labels) current.labels = edge.labels.map(label => ({ ...label, x: label.x === undefined ? undefined : label.x + dx, y: label.y === undefined ? undefined : label.y + dy })); } }
export function alignItems(board: DesignBoard, ids: Set<string>, mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical'): void {
    const selected = board.items.filter(item => ids.has(item.id)), groups = new Map<string, BoardItem[]>();
    for (const item of selected) { const key = item.groupId || item.id; groups.set(key, [...(groups.get(key) || []), item]); }
    const units = [...groups.values()].filter(items => !items.some(item => item.locked)); if (units.length < 2) return;
    const bounds = itemsBounds(selected);
    if (mode === 'horizontal' || mode === 'vertical') { const axis = mode === 'horizontal' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h'; units.sort((a, b) => itemsBounds(a)[axis] - itemsBounds(b)[axis]); const start = itemsBounds(units[0]!)[axis], end = itemsBounds(units[units.length - 1]!); const gap = (end[axis] + end[size] - start - units.reduce((sum, unit) => sum + itemsBounds(unit)[size], 0)) / (units.length - 1); let position = start; for (const unit of units) { const box = itemsBounds(unit), delta = position - box[axis]; for (const item of unit) item[axis] += delta; position += box[size] + gap; } return; }
    for (const unit of units) { const box = itemsBounds(unit); const dx = mode === 'left' ? bounds.x - box.x : mode === 'center' ? bounds.x + bounds.w / 2 - box.x - box.w / 2 : mode === 'right' ? bounds.x + bounds.w - box.x - box.w : 0; const dy = mode === 'top' ? bounds.y - box.y : mode === 'middle' ? bounds.y + bounds.h / 2 - box.y - box.h / 2 : mode === 'bottom' ? bounds.y + bounds.h - box.y - box.h : 0; for (const item of unit) { item.x += dx; item.y += dy; } }
}
export function mindBranch(board: DesignBoard, parentId: string, sibling = false): BoardItem | undefined { const selected = board.items.find(item => item.id === parentId); if (!selected || selected.locked) return; const parent = sibling && selected.mindParent ? board.items.find(item => item.id === selected.mindParent) || selected : selected; const peers = board.items.filter(item => item.mindParent === parent.id); const item: BoardItem = { id: uid(), kind: 'shape', shape: 'round', text: '', color: selected.color || '#bfdbfe', x: parent.x + parent.w + 90, y: peers.length ? Math.max(...peers.map(item => item.y + item.h)) + 30 : parent.y, w: 200, h: 90, z: Math.max(0, ...board.items.map(item => item.z)) + 1, mindParent: parent.id }; board.items.push(item); board.edges.push({ id: uid(), from: parent.id, to: item.id, style: 'curve', arrow: 'none', label: '' }); return item; }
export function autoLayout(board: DesignBoard): void { const placed = new Set<string>(); let row = 0; const visit = (item: BoardItem, depth: number) => { if (placed.has(item.id)) return; placed.add(item.id); if (!item.locked) { item.x = depth * 320; item.y = row++ * 180; } for (const child of board.items.filter(child => child.mindParent === item.id)) visit(child, depth + 1); }; for (const item of board.items.filter(item => item.kind !== 'frame' && (!item.mindParent || !board.items.some(parent => parent.id === item.mindParent)))) visit(item, 0); for (const item of board.items.filter(item => item.kind !== 'frame')) visit(item, 0); }
export function strokePath(points: [number, number][]): string {
    if (!points.length) return '';
    let path = `M ${points[0]![0]} ${points[0]![1]}`;
    for (let i = 1; i < points.length - 1; i++) { const p = points[i]!, next = points[i + 1]!; path += ` Q ${p[0]} ${p[1]} ${(p[0] + next[0]) / 2} ${(p[1] + next[1]) / 2}`; }
    const last = points[points.length - 1]!; return `${path} L ${last[0]} ${last[1]}`;
}

/** SVG viewBox that frames a board's objects with a margin, for board thumbnails. */
export function thumbnailBox(board: DesignBoard): string {
    const items = board.items.filter(item => item.kind !== 'anchor' && !item.unsorted);
    const x = Math.min(0, ...items.map(item => item.x)) - 40, y = Math.min(0, ...items.map(item => item.y)) - 40;
    return `${x} ${y} ${Math.max(400, ...items.map(item => item.x + item.w)) - x + 40} ${Math.max(300, ...items.map(item => item.y + item.h)) - y + 40}`;
}
