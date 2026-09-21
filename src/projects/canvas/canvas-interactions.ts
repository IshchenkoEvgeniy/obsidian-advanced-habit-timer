import type { CanvasData, CanvasNode, CanvasViewport, CanvasSide } from './canvas-types';
import { CanvasRenderer } from './canvas-renderer';
import { CanvasEngine } from './canvas-engine';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4.0;
const SNAP_GRID = 20;

export interface InteractionCallbacks {
    onNodeMoved(nodeId: string, x: number, y: number): void;
    onEdgeCreated(fromNodeId: string, toNodeId: string, fromSide: CanvasSide, toSide: CanvasSide): void;
    onNodeSelected(ids: Set<string>): void;
    onNodeDoubleClick(node: CanvasNode): void;
    onEdgeDoubleClick(edgeId: string): void;
    onRightClick(e: MouseEvent, nodeId?: string, edgeId?: string): void;
    onViewportChange(vp: CanvasViewport): void;
    onRequestRender(): void;
}

export class CanvasInteractions {
    private snapToGrid = false;

    // drag state
    private draggingNodeId: string | null = null;
    private dragStartCanvasX = 0;
    private dragStartCanvasY = 0;
    private dragStartNodeX = 0;
    private dragStartNodeY = 0;

    // pan state
    private panning = false;
    private panStartX = 0;
    private panStartY = 0;
    private panStartVpX = 0;
    private panStartVpY = 0;

    // lasso state
    private lassoing = false;
    private lassoStartCX = 0;
    private lassoStartCY = 0;

    // connect state
    private connecting = false;
    private connectFromNodeId: string | null = null;
    private connectFromSide: CanvasSide = 'right';

    // hover
    private hoveredNodeId: string | null = null;

    // multi-select
    selectedIds: Set<string> = new Set();

    constructor(
        private svg: SVGElement,
        private renderer: CanvasRenderer,
        private engine: CanvasEngine,
        private data: CanvasData,
        private cb: InteractionCallbacks,
    ) {
        this._bind();
    }

    setSnapToGrid(v: boolean) { this.snapToGrid = v; }

    updateData(data: CanvasData) { this.data = data; }

    private snap(v: number): number {
        return this.snapToGrid ? Math.round(v / SNAP_GRID) * SNAP_GRID : v;
    }

    // ── event binding ─────────────────────────────────────────────────────────

    private _bind() {
        this.svg.addEventListener('mousedown', this._onMouseDown);
        this.svg.addEventListener('mousemove', this._onMouseMove);
        this.svg.addEventListener('mouseup', this._onMouseUp);
        this.svg.addEventListener('mouseleave', this._onMouseUp);
        this.svg.addEventListener('wheel', this._onWheel, { passive: false });
        this.svg.addEventListener('dblclick', this._onDblClick);
        this.svg.addEventListener('contextmenu', this._onContextMenu);
    }

    destroy() {
        this.svg.removeEventListener('mousedown', this._onMouseDown);
        this.svg.removeEventListener('mousemove', this._onMouseMove);
        this.svg.removeEventListener('mouseup', this._onMouseUp);
        this.svg.removeEventListener('mouseleave', this._onMouseUp);
        this.svg.removeEventListener('wheel', this._onWheel);
        this.svg.removeEventListener('dblclick', this._onDblClick);
        this.svg.removeEventListener('contextmenu', this._onContextMenu);
    }

    // ── mouse down ────────────────────────────────────────────────────────────

    private _onMouseDown = (e: MouseEvent) => {
        if (e.button === 1 || (e.button === 0 && e.getModifierState('Space'))) {
            // Middle button or Space+drag → pan
            this._startPan(e);
            return;
        }
        if (e.button !== 0) return;

        const portDot = (e.target as Element).closest('.port-dot');
        if (portDot) {
            // Start edge connection
            const nodeId = portDot.getAttribute('data-node-id')!;
            const side = portDot.getAttribute('data-side') as CanvasSide;
            this._startConnect(e, nodeId, side);
            return;
        }

        const nodeEl = (e.target as Element).closest('[data-id]');
        if (nodeEl) {
            const nodeId = nodeEl.getAttribute('data-id')!;
            this._startNodeDrag(e, nodeId);
            return;
        }

        // Clicked empty space → start lasso or deselect
        if (!e.shiftKey) this.selectedIds.clear();
        this._startLasso(e);
    };

    // ── pan ───────────────────────────────────────────────────────────────────

    private _startPan(e: MouseEvent) {
        this.panning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.panStartVpX = this.renderer.viewport.x;
        this.panStartVpY = this.renderer.viewport.y;
        this.svg.setCssStyles({ cursor: 'grabbing' });
        e.preventDefault();
    }

    private _updatePan(e: MouseEvent) {
        if (!this.panning) return;
        this.renderer.viewport.x = this.panStartVpX + (e.clientX - this.panStartX);
        this.renderer.viewport.y = this.panStartVpY + (e.clientY - this.panStartY);
        this.renderer.applyViewport();
        this.cb.onViewportChange(this.renderer.viewport);
    }

    // ── node drag ─────────────────────────────────────────────────────────────

    private _startNodeDrag(e: MouseEvent, nodeId: string) {
        const node = this.engine.getNode(this.data, nodeId);
        if (!node || node.pinned) return;

        if (!e.shiftKey && !this.selectedIds.has(nodeId)) {
            this.selectedIds.clear();
        }
        this.selectedIds.add(nodeId);
        this.cb.onNodeSelected(new Set(this.selectedIds));

        const { cx, cy } = this.renderer.screenToCanvas(e.clientX, e.clientY);
        this.draggingNodeId = nodeId;
        this.dragStartCanvasX = cx;
        this.dragStartCanvasY = cy;
        this.dragStartNodeX = node.x;
        this.dragStartNodeY = node.y;
        this.svg.setCssStyles({ cursor: 'grabbing' });
        e.preventDefault();
    }

    private _updateNodeDrag(e: MouseEvent) {
        if (!this.draggingNodeId) return;
        const node = this.engine.getNode(this.data, this.draggingNodeId);
        if (!node) return;

        const { cx, cy } = this.renderer.screenToCanvas(e.clientX, e.clientY);
        const dx = cx - this.dragStartCanvasX;
        const dy = cy - this.dragStartCanvasY;

        const newX = this.snap(this.dragStartNodeX + dx);
        const newY = this.snap(this.dragStartNodeY + dy);
        node.x = newX;
        node.y = newY;

        this.cb.onRequestRender();
    }

    private _endNodeDrag() {
        if (!this.draggingNodeId) return;
        const node = this.engine.getNode(this.data, this.draggingNodeId);
        if (node) this.cb.onNodeMoved(this.draggingNodeId, node.x, node.y);
        this.draggingNodeId = null;
    }

    // ── lasso select ─────────────────────────────────────────────────────────

    private _startLasso(e: MouseEvent) {
        const { cx, cy } = this.renderer.screenToCanvas(e.clientX, e.clientY);
        this.lassoing = true;
        this.lassoStartCX = cx;
        this.lassoStartCY = cy;
    }

    private _updateLasso(e: MouseEvent) {
        if (!this.lassoing) return;
        const { cx, cy } = this.renderer.screenToCanvas(e.clientX, e.clientY);
        const x = Math.min(this.lassoStartCX, cx);
        const y = Math.min(this.lassoStartCY, cy);
        const w = Math.abs(cx - this.lassoStartCX);
        const h = Math.abs(cy - this.lassoStartCY);
        this.renderer.showSelectionRect(x, y, w, h);
    }

    private _endLasso(e: MouseEvent) {
        if (!this.lassoing) return;
        this.lassoing = false;
        this.renderer.hideSelectionRect();

        const { cx, cy } = this.renderer.screenToCanvas(e.clientX, e.clientY);
        const rx = Math.min(this.lassoStartCX, cx);
        const ry = Math.min(this.lassoStartCY, cy);
        const rw = Math.abs(cx - this.lassoStartCX);
        const rh = Math.abs(cy - this.lassoStartCY);

        if (rw < 4 && rh < 4) return; // treat as click

        for (const node of this.data.nodes) {
            const nx = node.x + node.width / 2;
            const ny = node.y + node.height / 2;
            if (nx >= rx && nx <= rx + rw && ny >= ry && ny <= ry + rh) {
                this.selectedIds.add(node.id);
            }
        }
        this.cb.onNodeSelected(new Set(this.selectedIds));
        this.cb.onRequestRender();
    }

    // ── connect (draw edge) ───────────────────────────────────────────────────

    private _startConnect(e: MouseEvent, nodeId: string, side: CanvasSide) {
        this.connecting = true;
        this.connectFromNodeId = nodeId;
        this.connectFromSide = side;
        e.stopPropagation();
    }

    private _updateConnect(e: MouseEvent) {
        if (!this.connecting || !this.connectFromNodeId) return;
        const fromNode = this.engine.getNode(this.data, this.connectFromNodeId);
        if (!fromNode) return;

        const [px, py] = portXY(fromNode, this.connectFromSide);
        const { cx, cy } = this.renderer.screenToCanvas(e.clientX, e.clientY);
        this.renderer.showConnectLine(px, py, cx, cy);
    }

    private _endConnect(e: MouseEvent) {
        if (!this.connecting || !this.connectFromNodeId) return;
        this.connecting = false;
        this.renderer.hideConnectLine();

        // Find the node under cursor
        const { cx, cy } = this.renderer.screenToCanvas(e.clientX, e.clientY);
        const toNode = this.data.nodes.find(n =>
            cx >= n.x && cx <= n.x + n.width &&
            cy >= n.y && cy <= n.y + n.height
        );

        if (toNode && toNode.id !== this.connectFromNodeId) {
            this.cb.onEdgeCreated(
                this.connectFromNodeId, toNode.id,
                this.connectFromSide, 'left'
            );
        }
        this.connectFromNodeId = null;
    }

    // ── mouse move ────────────────────────────────────────────────────────────

    private _onMouseMove = (e: MouseEvent) => {
        if (this.panning) { this._updatePan(e); return; }
        if (this.draggingNodeId) { this._updateNodeDrag(e); return; }
        if (this.connecting) { this._updateConnect(e); return; }
        if (this.lassoing) { this._updateLasso(e); return; }

        // Hover: show/hide port dots
        const nodeEl = (e.target as Element).closest('[data-id]');
        const nodeId = nodeEl?.getAttribute('data-id') ?? null;

        if (nodeId !== this.hoveredNodeId) {
            this.hoveredNodeId = nodeId;
            if (nodeId) {
                const node = this.engine.getNode(this.data, nodeId);
                if (node) this.renderer.showPorts(node);
            } else {
                this.renderer.hidePorts();
            }
        }
    };

    // ── mouse up ──────────────────────────────────────────────────────────────

    private _onMouseUp = (e: MouseEvent) => {
        if (this.panning) {
            this.panning = false;
            this.svg.setCssStyles({ cursor: '' });
            return;
        }
        if (this.draggingNodeId) { this._endNodeDrag(); this.svg.setCssStyles({ cursor: '' }); return; }
        if (this.connecting) { this._endConnect(e); return; }
        if (this.lassoing) { this._endLasso(e); return; }
    };

    // ── wheel (zoom) ──────────────────────────────────────────────────────────

    private _onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return; // only ctrl+wheel zooms
        e.preventDefault();

        const rect = this.svg.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const oldZoom = this.renderer.viewport.zoom;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * delta));

        // Zoom toward cursor
        this.renderer.viewport.x = mx - (mx - this.renderer.viewport.x) * (newZoom / oldZoom);
        this.renderer.viewport.y = my - (my - this.renderer.viewport.y) * (newZoom / oldZoom);
        this.renderer.viewport.zoom = newZoom;
        this.renderer.applyViewport();
        this.cb.onViewportChange(this.renderer.viewport);
    };

    // ── double click ──────────────────────────────────────────────────────────

    private _onDblClick = (e: MouseEvent) => {
        const nodeEl = (e.target as Element).closest('[data-id]');
        if (nodeEl) {
            const nodeId = nodeEl.getAttribute('data-id')!;
            const node = this.engine.getNode(this.data, nodeId);
            if (node) this.cb.onNodeDoubleClick(node);
            return;
        }
        const edgeEl = (e.target as Element).closest('[data-edge-id]');
        if (edgeEl) {
            this.cb.onEdgeDoubleClick(edgeEl.getAttribute('data-edge-id')!);
        }
    };

    // ── right click ───────────────────────────────────────────────────────────

    private _onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const nodeEl = (e.target as Element).closest('[data-id]');
        const edgeEl = (e.target as Element).closest('[data-edge-id]');
        this.cb.onRightClick(
            e,
            nodeEl?.getAttribute('data-id') ?? undefined,
            edgeEl?.getAttribute('data-edge-id') ?? undefined,
        );
    };

    // ── keyboard ──────────────────────────────────────────────────────────────

    onKeyDown(e: KeyboardEvent): boolean {
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedIds.size > 0) {
            return true; // signal to view to handle deletion
        }
        if (e.key === 'Escape') {
            this.selectedIds.clear();
            this.cb.onNodeSelected(new Set());
            this.cb.onRequestRender();
        }
        return false;
    }
}

function portXY(node: CanvasNode, side: CanvasSide): [number, number] {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    switch (side) {
        case 'top':    return [cx, node.y];
        case 'bottom': return [cx, node.y + node.height];
        case 'left':   return [node.x, cy];
        case 'right':  return [node.x + node.width, cy];
    }
}
