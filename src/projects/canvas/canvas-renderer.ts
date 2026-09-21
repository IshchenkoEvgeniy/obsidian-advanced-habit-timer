import { Component, MarkdownRenderer, setIcon } from 'obsidian';
import HabitTimerPlugin from '../../main';
import type { ProjectTask } from '../types';
import type { TimerView } from '../../timer/timer-view';
import type {
    CanvasData, CanvasNode, CanvasEdge,
    CanvasViewport, CanvasSide
} from './canvas-types';

// ── helpers ──────────────────────────────────────────────────────────────────

function svgNS(tag: string): SVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

/** Port position for an edge endpoint on a given side of a node. */
function port(node: CanvasNode, side: CanvasSide): [number, number] {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    switch (side) {
        case 'top':    return [cx, node.y];
        case 'bottom': return [cx, node.y + node.height];
        case 'left':   return [node.x, cy];
        case 'right':  return [node.x + node.width, cy];
    }
}

/** Best side for an edge based on relative positions of two nodes. */
function bestSides(a: CanvasNode, b: CanvasNode): [CanvasSide, CanvasSide] {
    const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
    const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    }
    return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

/** Cubic Bezier path between two side-ports. */
function edgePath(
    a: CanvasNode, b: CanvasNode,
    fromSide: CanvasSide, toSide: CanvasSide
): string {
    const [x1, y1] = port(a, fromSide);
    const [x2, y2] = port(b, toSide);
    const cp = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 0.5 + 60;
    const offset = (side: CanvasSide, d: number): [number, number] => {
        switch (side) {
            case 'right':  return [d, 0];
            case 'left':   return [-d, 0];
            case 'bottom': return [0, d];
            case 'top':    return [0, -d];
        }
    };
    const [c1x, c1y] = offset(fromSide, cp);
    const [c2x, c2y] = offset(toSide, cp);
    return `M${x1},${y1} C${x1 + c1x},${y1 + c1y} ${x2 + c2x},${y2 + c2y} ${x2},${y2}`;
}

/** Colour for edge type. */
function edgeColor(edge: CanvasEdge): string {
    if (edge.color) return edge.color;
    switch (edge.type) {
        case 'dependency': return 'var(--text-accent)';
        case 'blocks':     return '#ef4444';
        case 'related':    return '#a3a3a3';
        case 'flow':       return '#22c55e';
        default:           return 'var(--text-muted)';
    }
}

function formatDuration(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// ── CanvasRenderer ────────────────────────────────────────────────────────────

export class CanvasRenderer {
    readonly svg: SVGElement;
    private defs: SVGElement;
    private groupLayer: SVGElement;   // groups (behind)
    private edgeLayer: SVGElement;    // edges
    private nodeLayer: SVGElement;    // nodes (foreign objects + SVG shapes)
    private uiLayer: SVGElement;      // selection rect, connecting line

    /** Map nodeId → root DOM element for the node. */
    nodeEls = new Map<string, SVGElement>();
    /** Map edgeId → path element. */
    edgeEls = new Map<string, SVGElement>();
    private markdownComponents = new Map<HTMLElement, Component>();
    private timerIntervals = new Map<HTMLElement, ReturnType<typeof setInterval>>();

    viewport: CanvasViewport = { x: 0, y: 0, zoom: 1 };

    /** Live task data keyed by ProjectTask.id — refreshed by canvas-view. */
    taskMap = new Map<string, ProjectTask>();

    /** Callback fired when user clicks a node's ▶ timer button. */
    onStartTimer?: (node: CanvasNode) => void;
    /** Callback fired when user clicks a node card body to open/edit. */
    onOpenTask?: (node: CanvasNode) => void;

    constructor(
        private container: HTMLElement,
        private plugin: HabitTimerPlugin,
    ) {
        this.svg = svgNS('svg') as SVGSVGElement;
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.svg.setCssStyles({ display: 'block', overflow: 'hidden', userSelect: 'none' });

        this.defs = svgNS('defs');
        this.svg.appendChild(this.defs);
        this._addArrowMarker();

        this.groupLayer = svgNS('g'); this.groupLayer.setAttribute('class', 'canvas-groups');
        this.edgeLayer  = svgNS('g'); this.edgeLayer.setAttribute('class', 'canvas-edges');
        this.nodeLayer  = svgNS('g'); this.nodeLayer.setAttribute('class', 'canvas-nodes');
        this.uiLayer    = svgNS('g'); this.uiLayer.setAttribute('class', 'canvas-ui');

        this.svg.appendChild(this.groupLayer);
        this.svg.appendChild(this.edgeLayer);
        this.svg.appendChild(this.nodeLayer);
        this.svg.appendChild(this.uiLayer);

        container.appendChild(this.svg);
    }

    private _addArrowMarker() {
        const marker = svgNS('marker');
        marker.setAttribute('id', 'ht-arrow');
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto-start-reverse');
        const path = svgNS('path');
        path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
        path.setAttribute('fill', 'context-stroke');
        marker.appendChild(path);
        this.defs.appendChild(marker);
    }

    // ── viewport ─────────────────────────────────────────────────────────────

    applyViewport(): void {
        const { x, y, zoom } = this.viewport;
        const transform = `translate(${x}px,${y}px) scale(${zoom})`;
        [this.groupLayer, this.edgeLayer, this.nodeLayer, this.uiLayer]
            .forEach(g => g.setAttribute('style', `transform:${transform};transform-origin:0 0;`));
    }

    /** Fit viewport so all nodes are visible with 40px padding. */
    fitAll(data: CanvasData, containerW: number, containerH: number): void {
        if (data.nodes.length === 0) { this.viewport = { x: 0, y: 0, zoom: 1 }; return; }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of data.nodes) {
            minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
        }
        const pad = 40;
        const bW = maxX - minX + pad * 2;
        const bH = maxY - minY + pad * 2;
        const zoom = Math.min(containerW / bW, containerH / bH, 2);
        this.viewport = {
            zoom,
            x: (containerW - bW * zoom) / 2 - (minX - pad) * zoom,
            y: (containerH - bH * zoom) / 2 - (minY - pad) * zoom,
        };
        this.applyViewport();
    }

    screenToCanvas(sx: number, sy: number): { cx: number; cy: number } {
        const rect = this.svg.getBoundingClientRect();
        return {
            cx: (sx - rect.left - this.viewport.x) / this.viewport.zoom,
            cy: (sy - rect.top - this.viewport.y) / this.viewport.zoom,
        };
    }

    // ── full render ───────────────────────────────────────────────────────────

    render(data: CanvasData, selectedIds: Set<string>): void {
        this._renderGroups(data, selectedIds);
        this._renderEdges(data);
        this._renderNodes(data, selectedIds);
    }

    private _renderGroups(data: CanvasData, selected: Set<string>): void {
        this.groupLayer.innerHTML = '';
        for (const node of data.nodes) {
            if (node.type !== 'group') continue;
            const rect = svgNS('rect') as SVGRectElement;
            rect.setAttribute('x', String(node.x));
            rect.setAttribute('y', String(node.y));
            rect.setAttribute('width', String(node.width));
            rect.setAttribute('height', String(node.height));
            rect.setAttribute('rx', '10');
            rect.setAttribute('fill', node.background || 'rgba(100,100,200,0.07)');
            rect.setAttribute('stroke', selected.has(node.id)
                ? 'var(--text-accent)' : (node.color || 'rgba(100,100,200,0.3)'));
            rect.setAttribute('stroke-width', '2');
            rect.setAttribute('data-id', node.id);
            this.groupLayer.appendChild(rect);

            if (node.label) {
                const lbl = svgNS('text') as SVGTextElement;
                lbl.setAttribute('x', String(node.x + 12));
                lbl.setAttribute('y', String(node.y + 22));
                lbl.setAttribute('font-size', '13');
                lbl.setAttribute('fill', 'var(--text-muted)');
                lbl.setAttribute('font-weight', '600');
                lbl.textContent = node.label;
                this.groupLayer.appendChild(lbl);
            }
        }
    }

    private _renderEdges(data: CanvasData): void {
        this.edgeEls.clear();
        this.edgeLayer.innerHTML = '';

        const nodeMap = new Map(data.nodes.map(n => [n.id, n]));

        for (const edge of data.edges) {
            const a = nodeMap.get(edge.fromNode);
            const b = nodeMap.get(edge.toNode);
            if (!a || !b) continue;

            const [fs, ts] = bestSides(a, b);
            const fromSide: CanvasSide = edge.fromSide ?? fs;
            const toSide: CanvasSide = edge.toSide ?? ts;

            const g = svgNS('g');

            const path = svgNS('path') as SVGPathElement;
            path.setAttribute('d', edgePath(a, b, fromSide, toSide));
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', edgeColor(edge));
            path.setAttribute('stroke-width', '2');
            if (edge.style === 'dashed') path.setAttribute('stroke-dasharray', '8,4');
            if (edge.style === 'dotted') path.setAttribute('stroke-dasharray', '2,4');
            path.setAttribute('marker-end', 'url(#ht-arrow)');
            path.setAttribute('data-edge-id', edge.id);
            g.appendChild(path);

            // Invisible wider hit area
            const hitPath = svgNS('path') as SVGPathElement;
            hitPath.setAttribute('d', edgePath(a, b, fromSide, toSide));
            hitPath.setAttribute('fill', 'none');
            hitPath.setAttribute('stroke', 'transparent');
            hitPath.setAttribute('stroke-width', '12');
            hitPath.setAttribute('data-edge-id', edge.id);
            g.appendChild(hitPath);

            if (edge.label) {
                const [x1, y1] = port(a, fromSide);
                const [x2, y2] = port(b, toSide);
                const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                const bg = svgNS('rect') as SVGRectElement;
                bg.setAttribute('x', String(mx - 24)); bg.setAttribute('y', String(my - 10));
                bg.setAttribute('width', '48'); bg.setAttribute('height', '16');
                bg.setAttribute('rx', '4'); bg.setAttribute('fill', 'var(--background-primary)');
                g.appendChild(bg);
                const lbl = svgNS('text') as SVGTextElement;
                lbl.setAttribute('x', String(mx)); lbl.setAttribute('y', String(my + 3));
                lbl.setAttribute('text-anchor', 'middle');
                lbl.setAttribute('font-size', '10');
                lbl.setAttribute('fill', edgeColor(edge));
                lbl.textContent = edge.label;
                g.appendChild(lbl);
            }

            this.edgeLayer.appendChild(g);
            this.edgeEls.set(edge.id, g);
        }
    }

    private _renderNodes(data: CanvasData, selected: Set<string>): void {
        // Remove orphan DOM nodes
        const currentIds = new Set(data.nodes.map(n => n.id));
        for (const [id, el] of this.nodeEls) {
            if (!currentIds.has(id)) {
                this._cleanupNodeEl(el);
                el.remove();
                this.nodeEls.delete(id);
            }
        }

        for (const node of data.nodes) {
            if (node.type === 'group') continue;

            let el = this.nodeEls.get(node.id);
            if (!el) {
                el = this._createNodeEl(node);
                this.nodeLayer.appendChild(el);
                this.nodeEls.set(node.id, el);
            }
            this._updateNodeEl(el, node, selected.has(node.id));
        }
    }

    private _createNodeEl(node: CanvasNode): SVGElement {
        if (node.type === 'milestone') return this._createMilestoneEl(node);
        const fo = svgNS('foreignObject') as SVGForeignObjectElement;
        fo.setAttribute('data-id', node.id);
        const div = document.createElement('div');
        div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        fo.appendChild(div);
        return fo;
    }

    private _updateNodeEl(el: SVGElement, node: CanvasNode, selected: boolean): void {
        el.setAttribute('x', String(node.x));
        el.setAttribute('y', String(node.y));
        el.setAttribute('width', String(node.width));
        el.setAttribute('height', String(node.height));

        if (node.type === 'milestone') {
            this._updateMilestoneEl(el, node, selected);
            return;
        }

        const div = el.firstElementChild as HTMLElement;
        if (!div) return;
        div.setCssStyles({ width: `${node.width}px`, height: `${node.height}px`, boxSizing: `border-box` });
        this._renderNodeContent(div, node, selected);
    }

    private _renderNodeContent(div: HTMLElement, node: CanvasNode, selected: boolean): void {
        this._cleanupNodeDiv(div);
        div.empty();

        const border = selected ? 'var(--text-accent)' : (node.color || 'var(--background-modifier-border)');
        const baseStyle = `
            width:100%; height:100%; box-sizing:border-box;
            border:2px solid ${border}; border-radius:8px;
            background:var(--background-primary);
            display:flex; flex-direction:column; overflow:hidden;
            font-family:var(--font-interface); font-size:13px;
            box-shadow:${selected ? '0 0 0 2px var(--text-accent)' : '0 2px 8px rgba(0,0,0,0.15)'};
            transition: box-shadow 0.15s;
        `;

        switch (node.type) {
            case 'task':      this._renderTaskCard(div, node, selected, baseStyle); break;
            case 'text':      this._renderTextCard(div, node, selected, baseStyle); break;
            case 'timer':     this._renderTimerCard(div, node, selected, baseStyle); break;
            default:          this._renderTextCard(div, node, selected, baseStyle); break;
        }
    }

    private _renderTaskCard(div: HTMLElement, node: CanvasNode, _sel: boolean, baseStyle: string): void {
        div.setAttribute("style", baseStyle);

        const task = node.taskId ? this.taskMap.get(node.taskId) : undefined;
        const isOrphan = node.orphan;

        // Cover strip
        const cover = task?.cover || task?.images?.[0];
        if (cover) {
            const img = div.createEl('img');
            img.src = cover.startsWith('http') ? cover : this.plugin.app.vault.adapter.getResourcePath(cover);
            img.setCssStyles({ width: '100%', height: '48px', objectFit: 'cover', borderRadius: '6px 6px 0 0', flexShrink: '0' });
        }

        const body = div.createDiv({ attr: { style: 'padding:8px;flex:1;display:flex;flex-direction:column;gap:4px;overflow:hidden;' } });

        // Status badge
        const headerRow = body.createDiv({ attr: { style: 'display:flex;align-items:center;gap:6px;' } });
        const statusText = task?.status || '—';
        const statusBadge = headerRow.createSpan({ text: statusText });
        statusBadge.setAttribute("style", `
            font-size:10px;padding:1px 6px;border-radius:10px;
            background:${node.color || 'var(--text-accent)'};color:#fff;
            white-space:nowrap;flex-shrink:0;
        `);

        if (isOrphan) {
            headerRow.createSpan({ text: '⚠', attr: { style: 'color:#ef4444;font-size:12px;' } });
        }

        // Title
        const name = node.taskName || node.taskFile?.split('/').pop()?.replace('.md', '') || '—';
        const titleEl = body.createDiv({ text: isOrphan ? `⚠ ${name}` : name });
        titleEl.setAttribute("style", `
            font-weight:600; font-size:12px;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
            color:${isOrphan ? '#ef4444' : 'var(--text-normal)'};
        `);
        titleEl.title = name;

        // Progress bar (time spent vs estimated)
        if (task && task.timeEstimatedSec && task.timeEstimatedSec > 0) {
            const pct = Math.min((task.timeSpentSec / task.timeEstimatedSec) * 100, 100);
            const barWrap = body.createDiv({ attr: { style: 'width:100%;height:4px;background:var(--background-modifier-border);border-radius:2px;overflow:hidden;' } });
            barWrap.createDiv({ attr: { style: `width:${pct}%;height:100%;background:${node.color || 'var(--text-accent)'};` } });
        }

        // Time spent
        if (task && task.timeSpentSec > 0) {
            body.createDiv({
                text: `⏱ ${formatDuration(task.timeSpentSec)}${task.timeEstimatedSec ? ' / ' + formatDuration(task.timeEstimatedSec) : ''}`,
                attr: { style: 'font-size:10px;color:var(--text-muted);' }
            });
        }



        // Footer: tags + timer button
        const footer = body.createDiv({ attr: { style: 'display:flex;align-items:center;gap:4px;margin-top:auto;' } });

        if (task?.tags) {
            const tagsDiv = footer.createDiv({ attr: { style: 'display:flex;gap:3px;flex-wrap:wrap;flex:1;overflow:hidden;' } });
            task.tags.split(',').slice(0, 3).forEach(tag => {
                tag = tag.trim();
                if (tag) tagsDiv.createSpan({ text: `#${tag}`, attr: { style: 'font-size:9px;color:var(--text-muted);' } });
            });
        }

        // ▶ Timer button
        const activeTimer = this.plugin.settings.activeTimer;
        const isActive = activeTimer
            && activeTimer.path === node.taskFile
            && (!node.taskName || activeTimer.taskName === node.taskName);
        const timerBtn = footer.createEl('button', { text: isActive ? '⏹' : '▶' });
        timerBtn.title = isActive ? 'Stop timer' : 'Start timer';
        timerBtn.setAttribute("style", `
            background:${isActive ? '#ef4444' : 'var(--text-accent)'};
            color:#fff;border:none;border-radius:4px;padding:2px 6px;
            font-size:11px;cursor:pointer;flex-shrink:0;
        `);
        timerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onStartTimer?.(node);
        });

        // Click body → open task
        body.addEventListener('click', () => this.onOpenTask?.(node));
    }

    private _renderTextCard(div: HTMLElement, node: CanvasNode, _sel: boolean, baseStyle: string): void {
        div.setAttribute("style", baseStyle + 'padding:10px;overflow:auto;');
        const content = node.content || node.label || '';
        
        // Obsidian markdown postprocessors need an unloadable Component lifecycle.
        const comp = new Component();
        comp.load();
        this.markdownComponents.set(div, comp);
        
        void MarkdownRenderer.render(this.plugin.app, content, div, '', comp);
    }

    private _renderTimerCard(div: HTMLElement, node: CanvasNode, _sel: boolean, baseStyle: string): void {
        div.setAttribute("style", baseStyle + 'display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--background-secondary);');
        
        const active = this.plugin.settings.activeTimer;
        const title = div.createDiv({ attr: { style: 'font-weight:bold;font-size:14px;color:var(--text-normal);margin-bottom:8px;text-align:center;padding:0 10px;' } });
        title.textContent = active ? (active.taskName || active.habitName || 'Timer') : 'No Active Timer';

        const display = div.createDiv({ attr: { style: 'font-family:var(--font-monospace);font-size:24px;color:var(--text-accent);font-weight:bold;' } });
        
        if (active && active.startTime) {
            const start = new Date(active.startTime).getTime();
            const update = () => {
                const now = Date.now();
                const elapsedSec = Math.floor((now - start) / 1000);
                const h = Math.floor(elapsedSec / 3600);
                const m = Math.floor((elapsedSec % 3600) / 60);
                const s = elapsedSec % 60;
                display.textContent = `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            };
            update();
            const timerId = setInterval(update, 1000);
            this.timerIntervals.set(div, timerId);

            const stopBtn = div.createEl('button', { attr: { style: 'margin-top:12px;padding:6px 16px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;display:flex;align-items:center;gap:6px;' } });
            setIcon(stopBtn.createSpan(), 'square');
            stopBtn.createSpan({ text: 'Stop timer' });
            stopBtn.onclick = async () => {
                const leaf = this.plugin.app.workspace.getLeavesOfType('habit-timer-view')[0];
                if (leaf?.view) {
                    const timerView = leaf.view as TimerView;
                    await timerView.engine.reset();
                } else {
                    this.plugin.settings.activeTimer = undefined;
                    await this.plugin.saveSettings();
                }
            };
        } else {
            display.textContent = '00:00';
        }
    }

    private _createMilestoneEl(node: CanvasNode): SVGElement {
        const g = svgNS('g');
        g.setAttribute('data-id', node.id);
        const diamond = svgNS('polygon');
        diamond.setAttribute('class', 'milestone-shape');
        g.appendChild(diamond);
        const txt = svgNS('text') as SVGTextElement;
        txt.setAttribute('class', 'milestone-text');
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('dominant-baseline', 'middle');
        txt.setAttribute('font-size', '11');
        txt.setAttribute('fill', 'var(--text-normal)');
        g.appendChild(txt);
        return g;
    }

    private _updateMilestoneEl(el: SVGElement, node: CanvasNode, selected: boolean): void {
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;
        const diamond = el.querySelector('.milestone-shape') as SVGPolygonElement;
        if (diamond) {
            diamond.setAttribute('points', `${cx},${node.y} ${node.x + node.width},${cy} ${cx},${node.y + node.height} ${node.x},${cy}`);
            diamond.setAttribute('fill', node.color || 'var(--text-accent)');
            diamond.setAttribute('fill-opacity', '0.15');
            diamond.setAttribute('stroke', selected ? 'var(--text-accent)' : (node.color || 'var(--text-accent)'));
            diamond.setAttribute('stroke-width', '2');
        }
        const txt = el.querySelector('.milestone-text') as SVGTextElement;
        if (txt) {
            txt.setAttribute('x', String(cx));
            txt.setAttribute('y', String(cy));
            txt.textContent = node.label || node.content || 'Milestone';
        }
    }

    // ── selection rect ────────────────────────────────────────────────────────

    showSelectionRect(x: number, y: number, w: number, h: number): void {
        let rect = this.uiLayer.querySelector('.lasso-rect') as SVGRectElement;
        if (!rect) {
            rect = svgNS('rect') as SVGRectElement;
            rect.setAttribute('class', 'lasso-rect');
            rect.setAttribute('fill', 'rgba(99,102,241,0.08)');
            rect.setAttribute('stroke', 'var(--text-accent)');
            rect.setAttribute('stroke-width', '1');
            rect.setAttribute('stroke-dasharray', '4,2');
            this.uiLayer.appendChild(rect);
        }
        rect.setAttribute('x', String(Math.min(x, x + w)));
        rect.setAttribute('y', String(Math.min(y, y + h)));
        rect.setAttribute('width', String(Math.abs(w)));
        rect.setAttribute('height', String(Math.abs(h)));
    }

    hideSelectionRect(): void {
        this.uiLayer.querySelector('.lasso-rect')?.remove();
    }

    /** Show a dashed line while drawing a new edge. */
    showConnectLine(x1: number, y1: number, x2: number, y2: number): void {
        let line = this.uiLayer.querySelector('.connect-line') as SVGLineElement;
        if (!line) {
            line = svgNS('line') as SVGLineElement;
            line.setAttribute('class', 'connect-line');
            line.setAttribute('stroke', 'var(--text-accent)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-dasharray', '6,3');
            line.setAttribute('marker-end', 'url(#ht-arrow)');
            this.uiLayer.appendChild(line);
        }
        line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
    }

    hideConnectLine(): void {
        this.uiLayer.querySelector('.connect-line')?.remove();
    }

    /** Highlight connection port dots on a node. */
    showPorts(node: CanvasNode): void {
        this.hidePorts();
        const sides: CanvasSide[] = ['top', 'right', 'bottom', 'left'];
        for (const side of sides) {
            const [px, py] = port(node, side);
            const circle = svgNS('circle') as SVGCircleElement;
            circle.setAttribute('class', 'port-dot');
            circle.setAttribute('cx', String(px)); circle.setAttribute('cy', String(py));
            circle.setAttribute('r', '5');
            circle.setAttribute('fill', 'var(--text-accent)');
            circle.setAttribute('stroke', '#fff');
            circle.setAttribute('stroke-width', '1.5');
            circle.setAttribute('data-side', side);
            circle.setAttribute('data-node-id', node.id);
            circle.setCssStyles({ cursor: 'crosshair' });
            this.uiLayer.appendChild(circle);
        }
    }

    hidePorts(): void {
        this.uiLayer.querySelectorAll('.port-dot').forEach(e => e.remove());
    }

    private _cleanupNodeEl(el: SVGElement): void {
        const div = el.firstElementChild;
        if (div instanceof HTMLElement) this._cleanupNodeDiv(div);
    }

    private _cleanupNodeDiv(div: HTMLElement): void {
        const timerId = this.timerIntervals.get(div);
        if (timerId) {
            clearInterval(timerId);
            this.timerIntervals.delete(div);
        }

        const component = this.markdownComponents.get(div);
        if (component) {
            component.unload();
            this.markdownComponents.delete(div);
        }
    }

    destroy(): void {
        for (const el of this.nodeEls.values()) {
            this._cleanupNodeEl(el);
        }
        this.nodeEls.clear();
        this.edgeEls.clear();
        this.svg.remove();
    }
}
