/** All data types for the Project Canvas feature. */

export type CanvasNodeType = 'task' | 'text' | 'group' | 'milestone' | 'timer' | 'link';
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEdgeType = 'dependency' | 'blocks' | 'related' | 'flow';
export type CanvasLayoutType = 'kanban' | 'dagre' | 'force' | 'grid';

export interface CanvasNode {
    id: string;
    type: CanvasNodeType;
    x: number;
    y: number;
    width: number;
    height: number;

    // --- task node ---
    taskId?: string;       // ProjectTask.id; distinguishes checklist tasks sharing one file
    taskFile?: string;     // path to .md file (folder/tag/dataview scopes)
    taskName?: string;     // task name for single-file scopes

    // --- text / milestone ---
    content?: string;

    // --- group ---
    label?: string;
    background?: string;   // rgba or hex with opacity

    // --- timer ---
    habitName?: string;

    // --- link ---
    url?: string;

    // --- visual ---
    color?: string;
    pinned?: boolean;      // excluded from auto-layout
    collapsed?: boolean;
    zIndex?: number;
    orphan?: boolean;      // task file was deleted

    /** Live status used by layout; attached as a non-enumerable runtime value. */
    runtimeStatus?: string;
}

export interface CanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: CanvasSide;
    toSide?: CanvasSide;
    label?: string;
    color?: string;
    style?: 'solid' | 'dashed' | 'dotted';
    type?: CanvasEdgeType;
}

export interface CanvasViewport {
    x: number;
    y: number;
    zoom: number;
}

export interface CanvasData {
    version: 1;
    scopeId: string;
    viewport: CanvasViewport;
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    lastModified: string;
}

// ---- Event types passed between modules ----

export interface NodeDragEvent {
    nodeId: string;
    dx: number;
    dy: number;
}

export interface EdgeCreateEvent {
    fromNodeId: string;
    toNodeId: string;
    fromSide: CanvasSide;
    toSide: CanvasSide;
}

export interface CanvasPointerPos {
    /** Canvas-space coordinates (after applying inverse viewport transform). */
    cx: number;
    cy: number;
    /** Screen-space coordinates. */
    sx: number;
    sy: number;
}

// ---- Default sizes ----
export const NODE_DEFAULT_W = 220;
export const NODE_DEFAULT_H = 130;
export const NODE_TEXT_W = 200;
export const NODE_TEXT_H = 100;
export const NODE_GROUP_W = 400;
export const NODE_GROUP_H = 300;
export const NODE_MILESTONE_W = 180;
export const NODE_MILESTONE_H = 80;
export const LAYOUT_H_GAP = 40;
export const LAYOUT_V_GAP = 30;
export const LAYOUT_COL_W = NODE_DEFAULT_W + LAYOUT_H_GAP;
