import type { TableData } from './table';
export type FieldKind = 'text' | 'longtext' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'image' | 'entity' | 'task' | 'status';
export interface DesignField {
    id: string; name: string; kind: FieldKind; required?: boolean; card?: boolean;
    options?: { value: string; color: string; labelKey?: 'design_low' | 'design_medium' | 'design_high' }[]; min?: number; max?: number; step?: number; targetType?: string;
}
export interface DesignType { id: string; name: string; color: string; icon: string; folder: string; fields: DesignField[]; }
export interface DesignSettings { root: string; projectId: string; types: DesignType[]; }
export interface DesignEntity {
    id: string; type: string; path: string; title: string; values: Record<string, unknown>; body: string; raw: string;
}
export type ItemKind = 'entity' | 'sticky' | 'shape' | 'text' | 'image' | 'frame' | 'board' | 'stroke' | 'file' | 'anchor' | 'link' | 'todo' | 'table' | 'sketch' | 'world-view';
export const SHAPES = ['rect', 'round', 'ellipse', 'diamond', 'triangle', 'hexagon', 'star', 'arrow', 'cloud', 'cylinder', 'pill', 'parallelogram', 'document', 'predefined'] as const;
/** One freehand stroke drawn on a sketch card, in the card's local coordinates. */
export interface SketchStroke { points: [number, number][]; width: number; color?: string; opacity?: number; }
/** Image marks use normalized original-image coordinates and widths. Cropping never changes the original. */
export interface LinkPreview { title?: string; description?: string; image?: string; site?: string; }
export interface BoardTrashEntry { id: string; deletedAt: number; items: BoardItem[]; edges: BoardEdge[]; }
export interface TextStyle { fontSize?: number; color?: string; align?: 'left' | 'center' | 'right'; }
export interface BoardItem {
    id: string; kind: ItemKind; x: number; y: number; w: number; h: number; z: number;
    ref?: string; text?: string; title?: string; color?: string; shape?: typeof SHAPES[number];
    path?: string; points?: [number, number][]; width?: number; autoSize?: boolean;
    richText?: string; textStyle?: TextStyle; groupId?: string; locked?: boolean; rotation?: number;
    strokeColor?: string; strokeWidth?: number; strokeDash?: 'solid' | 'dash' | 'dot'; opacity?: number;
    crop?: { x: number; y: number; w: number; h: number }; mindParent?: string;
    /** Color band across the top of the card (L18). */
    band?: string;
    /** Frame used as a column (L5): children are hidden while collapsed. */
    column?: boolean; collapsed?: boolean;
    /** Table card data (L7). */
    table?: TableData;
    /** A reference to a saved world view. Removing the block never removes records. */
    worldView?: { typeId: string; viewId: string };
    /** Strokes drawn on a sketch card (L11). */
    sketch?: SketchStroke[];
    unsorted?: boolean;
    columnManaged?: boolean; columnId?: string; columnOrder?: number;
    preview?: LinkPreview; imageStrokes?: SketchStroke[];
}
export type AttachmentSide = 'top' | 'right' | 'bottom' | 'left' | 'center';
export interface EdgeLabel { id: string; text: string; x?: number; y?: number; t?: number; offsetX?: number; offsetY?: number; }
export interface BoardEdge {
    id: string; from: string; to: string; style: 'straight' | 'elbow' | 'curve'; label: string; arrow: 'end' | 'both' | 'none';
    fromSide?: AttachmentSide; toSide?: AttachmentSide;
    color?: string; width?: number; dash?: 'solid' | 'dash' | 'dot'; labels?: EdgeLabel[]; bends?: [number, number][];
    unsorted?: boolean;
}
export interface DesignBoard {
    format: 2; id: string; name: string; viewport: { x: number; y: number; zoom: number };
    items: BoardItem[]; edges: BoardEdge[]; grid?: boolean; snap?: boolean;
    background?: string; mindMap?: boolean;
    /** Read-only boards can be panned and viewed but not changed (L21). */
    readOnly?: boolean;
    /** Boards marked as templates can be copied by "New board from template". */
    template?: boolean;
    trash?: BoardTrashEntry[];
    cover?: string; icon?: string;
}
export interface BoardDocument { board: DesignBoard; path: string; raw: string; }
export const FIELD_KINDS: FieldKind[] = ['text', 'longtext', 'number', 'select', 'multiselect', 'checkbox', 'date', 'image', 'entity', 'task', 'status'];
export const ITEM_KINDS: ItemKind[] = ['entity', 'sticky', 'shape', 'text', 'image', 'frame', 'board', 'stroke', 'file', 'anchor', 'link', 'todo', 'table', 'sketch', 'world-view'];
export function uid(): string {
    const random = globalThis.crypto;
    if (typeof random?.randomUUID === 'function') return random.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof random?.getRandomValues === 'function') random.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export class DesignError extends Error {
    constructor(public key: 'design_invalid' | 'design_conflict' | 'design_required' | 'design_number' | 'design_duplicate' | 'design_future' | 'design_kind_locked', public detail = '') { super(key); }
}
