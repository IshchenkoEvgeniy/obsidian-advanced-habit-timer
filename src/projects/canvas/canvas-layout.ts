import {
    type CanvasData, type CanvasNode, type CanvasLayoutType,
    NODE_DEFAULT_W, NODE_DEFAULT_H,
    LAYOUT_H_GAP, LAYOUT_V_GAP, LAYOUT_COL_W,
} from './canvas-types';

// ============================================================
// Public API
// ============================================================

/**
 * Applies an auto-layout algorithm to all non-pinned nodes.
 * Mutates node positions in-place.
 */
export function applyLayout(
    data: CanvasData,
    type: CanvasLayoutType,
    columns: string[],
): void {
    const movable = data.nodes.filter(n => !n.pinned && n.type !== 'group');

    switch (type) {
        case 'kanban': layoutKanban(movable, data, columns); break;
        case 'dagre': layoutDagre(movable, data); break;
        case 'force': layoutForce(movable, data); break;
        case 'grid': layoutGrid(movable); break;
    }
}

// ============================================================
// 1. Kanban Layout
//    Tasks arranged in vertical columns by their status field.
// ============================================================

function layoutKanban(
    nodes: CanvasNode[],
    data: CanvasData,
    columns: string[],
): void {
    // Build a status → column-index map
    const colIndex = new Map<string, number>(
        columns.map((c, i) => [c.toLowerCase(), i])
    );

    // Group nodes by column
    const cols: Map<number, CanvasNode[]> = new Map();
    const fallbackCol = 0;

    for (const node of nodes) {
        // Determine which column this node belongs to
        let ci = fallbackCol;
        if (node.type === 'task') {
            // Look up status from canvas data nodes (we may have stored it)
            // Status is resolved by the view from the live task, so we use
            // a best-effort approach: find the edge-connected column or use position
            const taskStatus = getNodeStatus(node, data);
            if (taskStatus) {
                ci = colIndex.get(taskStatus.toLowerCase()) ?? fallbackCol;
            }
        }
        if (!cols.has(ci)) cols.set(ci, []);
        cols.get(ci)!.push(node);
    }

    // Position each column
    for (const [ci, colNodes] of cols) {
        const x = ci * LAYOUT_COL_W + 20;
        let y = 20;
        for (const node of colNodes) {
            node.x = x;
            node.y = y;
            y += (node.height || NODE_DEFAULT_H) + LAYOUT_V_GAP;
        }
    }
}

/** Helper: try to read status from the node's stored content or edges. */
function getNodeStatus(node: CanvasNode, _data: CanvasData): string | null {
    // For task nodes the status is stored externally (in the live task).
    // We use the node's stored column hint if available, or null.
    return node.runtimeStatus ?? null;
}

// ============================================================
// 2. Dagre-inspired Hierarchical Layout
//    Builds a DAG from dependency/blocks edges and levels nodes.
// ============================================================

function layoutDagre(nodes: CanvasNode[], data: CanvasData): void {
    if (nodes.length === 0) return;

    const idSet = new Set(nodes.map(n => n.id));
    const inDegree = new Map<string, number>(nodes.map(n => [n.id, 0]));
    const adjacency = new Map<string, string[]>(nodes.map(n => [n.id, []]));

    // Build graph from dependency / flow edges only
    for (const edge of data.edges) {
        if (!idSet.has(edge.fromNode) || !idSet.has(edge.toNode)) continue;
        if (edge.type && edge.type !== 'dependency' && edge.type !== 'flow') continue;
        adjacency.get(edge.fromNode)!.push(edge.toNode);
        inDegree.set(edge.toNode, (inDegree.get(edge.toNode) ?? 0) + 1);
    }

    // BFS topological sort → assign levels
    const level = new Map<string, number>();
    const queue: string[] = [];

    for (const [id, deg] of inDegree) {
        if (deg === 0) { queue.push(id); level.set(id, 0); }
    }

    while (queue.length > 0) {
        const id = queue.shift()!;
        const lvl = level.get(id)!;
        for (const neighbour of adjacency.get(id) ?? []) {
            const newLvl = lvl + 1;
            if ((level.get(neighbour) ?? -1) < newLvl) {
                level.set(neighbour, newLvl);
            }
            inDegree.set(neighbour, (inDegree.get(neighbour) ?? 1) - 1);
            if (inDegree.get(neighbour) === 0) queue.push(neighbour);
        }
    }

    // Nodes with no edges — assign to level 0
    for (const node of nodes) {
        if (!level.has(node.id)) level.set(node.id, 0);
    }

    // Group by level → position
    const byLevel = new Map<number, CanvasNode[]>();
    for (const node of nodes) {
        const lvl = level.get(node.id) ?? 0;
        if (!byLevel.has(lvl)) byLevel.set(lvl, []);
        byLevel.get(lvl)!.push(node);
    }

    const hGap = NODE_DEFAULT_W + LAYOUT_H_GAP;
    const vGap = NODE_DEFAULT_H + LAYOUT_V_GAP;

    for (const [lvl, lvlNodes] of byLevel) {
        const x = lvl * hGap + 20;
        const totalH = lvlNodes.length * vGap - LAYOUT_V_GAP;
        let y = -totalH / 2;
        for (const node of lvlNodes) {
            node.x = x;
            node.y = y;
            y += vGap;
        }
    }
}

// ============================================================
// 3. Force-directed Layout
//    Simple spring simulation without external dependencies.
// ============================================================

const FORCE_REPULSION = 8000;
const FORCE_SPRING = 0.02;
const FORCE_SPRING_LEN = NODE_DEFAULT_W * 2;
const FORCE_GRAVITY = 0.01;
const FORCE_ITERATIONS = 120;
const FORCE_DAMPING = 0.85;

function layoutForce(nodes: CanvasNode[], data: CanvasData): void {
    if (nodes.length === 0) return;

    const idSet = new Set(nodes.map(n => n.id));

    // velocity vectors
    const vx = new Map<string, number>(nodes.map(n => [n.id, 0]));
    const vy = new Map<string, number>(nodes.map(n => [n.id, 0]));

    for (let iter = 0; iter < FORCE_ITERATIONS; iter++) {
        const fx = new Map<string, number>(nodes.map(n => [n.id, 0]));
        const fy = new Map<string, number>(nodes.map(n => [n.id, 0]));

        // Repulsion between all pairs
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i], b = nodes[j];
                if (!a || !b) continue;
                const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
                const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = FORCE_REPULSION / (dist * dist);
                const nx = (dx / dist) * force;
                const ny = (dy / dist) * force;
                fx.set(a.id, (fx.get(a.id) ?? 0) + nx);
                fy.set(a.id, (fy.get(a.id) ?? 0) + ny);
                fx.set(b.id, (fx.get(b.id) ?? 0) - nx);
                fy.set(b.id, (fy.get(b.id) ?? 0) - ny);
            }
        }

        // Spring attraction along edges
        for (const edge of data.edges) {
            if (!idSet.has(edge.fromNode) || !idSet.has(edge.toNode)) continue;
            const a = nodes.find(n => n.id === edge.fromNode);
            const b = nodes.find(n => n.id === edge.toNode);
            if (!a || !b) continue;
            const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
            const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = FORCE_SPRING * (dist - FORCE_SPRING_LEN);
            const nx = (dx / dist) * force;
            const ny = (dy / dist) * force;
            fx.set(a.id, (fx.get(a.id) ?? 0) + nx);
            fy.set(a.id, (fy.get(a.id) ?? 0) + ny);
            fx.set(b.id, (fx.get(b.id) ?? 0) - nx);
            fy.set(b.id, (fy.get(b.id) ?? 0) - ny);
        }

        // Gravity toward centre (0, 0)
        for (const node of nodes) {
            fx.set(node.id, (fx.get(node.id) ?? 0) - node.x * FORCE_GRAVITY);
            fy.set(node.id, (fy.get(node.id) ?? 0) - node.y * FORCE_GRAVITY);
        }

        // Integrate
        for (const node of nodes) {
            const newVx = ((vx.get(node.id) ?? 0) + (fx.get(node.id) ?? 0)) * FORCE_DAMPING;
            const newVy = ((vy.get(node.id) ?? 0) + (fy.get(node.id) ?? 0)) * FORCE_DAMPING;
            vx.set(node.id, newVx);
            vy.set(node.id, newVy);
            node.x += newVx;
            node.y += newVy;
        }
    }

    // Translate so min point is at (20, 20)
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    for (const node of nodes) {
        node.x = node.x - minX + 20;
        node.y = node.y - minY + 20;
    }
}

// ============================================================
// 4. Grid Layout
// ============================================================

function layoutGrid(nodes: CanvasNode[]): void {
    if (nodes.length === 0) return;
    const cols = Math.ceil(Math.sqrt(nodes.length));
    const hGap = NODE_DEFAULT_W + LAYOUT_H_GAP;
    const vGap = NODE_DEFAULT_H + LAYOUT_V_GAP;

    nodes.forEach((node, i) => {
        node.x = (i % cols) * hGap + 20;
        node.y = Math.floor(i / cols) * vGap + 20;
    });
}
