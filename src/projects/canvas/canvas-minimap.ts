import type { CanvasData, CanvasViewport } from './canvas-types';

const MINIMAP_W = 180;
const MINIMAP_H = 120;
const MINIMAP_PAD = 8;

export class CanvasMinimap {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private isDragging = false;
    private onViewportChange: (x: number, y: number) => void;

    private _scale = 1;
    private _offsetX = 0;
    private _offsetY = 0;
    private _minX = 0;
    private _minY = 0;
    private _containerW = 0;
    private _containerH = 0;

    constructor(
        container: HTMLElement,
        onViewportChange: (canvasX: number, canvasY: number) => void,
    ) {
        this.onViewportChange = onViewportChange;

        const wrap = container.createDiv({ attr: {
            style: `
                position:absolute; bottom:12px; right:12px;
                width:${MINIMAP_W}px; height:${MINIMAP_H}px;
                background:var(--background-secondary);
                border:1px solid var(--background-modifier-border);
                border-radius:8px; overflow:hidden;
                box-shadow:0 2px 12px rgba(0,0,0,0.25);
                z-index:10; cursor:crosshair;
            `
        }});

        this.canvas = wrap.createEl('canvas');
        this.canvas.width  = MINIMAP_W;
        this.canvas.height = MINIMAP_H;
        this.canvas.setCssStyles({ display: 'block', width: '100%', height: '100%' });

        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        this.ctx = ctx;

        // Drag on minimap → move main viewport
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('mouseup',   this._onMouseUp);
    }

    render(data: CanvasData, viewport: CanvasViewport, containerW: number, containerH: number): void {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

        // Dark background
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--background-secondary') || '#1e1e2e';
        ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

        if (data.nodes.length === 0) return;

        // Compute bounding box of all canvas nodes
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of data.nodes) {
            minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
        }

        const bW = maxX - minX || 1;
        const bH = maxY - minY || 1;

        // Scale to fit minimap (with padding)
        const aw = MINIMAP_W - MINIMAP_PAD * 2;
        const ah = MINIMAP_H - MINIMAP_PAD * 2;
        const scale = Math.min(aw / bW, ah / bH);

        const offsetX = MINIMAP_PAD + (aw - bW * scale) / 2;
        const offsetY = MINIMAP_PAD + (ah - bH * scale) / 2;

        const toMX = (cx: number) => offsetX + (cx - minX) * scale;
        const toMY = (cy: number) => offsetY + (cy - minY) * scale;

        // Draw node rectangles
        for (const node of data.nodes) {
            ctx.fillStyle = node.type === 'group'
                ? 'rgba(100,100,200,0.15)'
                : (node.color || (node.orphan ? '#ef4444' : '#6366f1'));
            ctx.globalAlpha = node.type === 'group' ? 0.5 : 0.75;
            ctx.fillRect(
                toMX(node.x), toMY(node.y),
                Math.max(node.width * scale, 2),
                Math.max(node.height * scale, 2),
            );
        }
        ctx.globalAlpha = 1;

        // Draw viewport indicator
        // viewport.x/y are the SVG translation offsets, zoom is scale
        // The visible area in canvas-space: top-left = (-vp.x / vp.zoom, -vp.y / vp.zoom)
        //                                  size = (containerW / vp.zoom, containerH / vp.zoom)
        const vpL = -viewport.x / viewport.zoom;
        const vpT = -viewport.y / viewport.zoom;
        const vpW =  containerW / viewport.zoom;
        const vpH =  containerH / viewport.zoom;

        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.rect(
            toMX(vpL), toMY(vpT),
            vpW * scale, vpH * scale,
        );
        ctx.fill();
        ctx.stroke();

        // Store scale/offset for click→viewport conversion
        this._scale = scale;
        this._offsetX = offsetX;
        this._offsetY = offsetY;
        this._minX = minX;
        this._minY = minY;
        this._containerW = containerW;
        this._containerH = containerH;
    }

    private _toCanvasCoords(mx: number, my: number): { cx: number; cy: number } {
        const scale   = this._scale;
        const offsetX = this._offsetX;
        const offsetY = this._offsetY;
        const minX    = this._minX;
        const minY    = this._minY;
        return {
            cx: (mx - offsetX) / scale + minX,
            cy: (my - offsetY) / scale + minY,
        };
    }

    private _onMouseDown = (e: MouseEvent) => {
        this.isDragging = true;
        this._seek(e);
    };

    private _onMouseMove = (e: MouseEvent) => {
        if (this.isDragging) this._seek(e);
    };

    private _onMouseUp = () => { this.isDragging = false; };

    private _seek(e: MouseEvent) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const { cx, cy } = this._toCanvasCoords(mx, my);
        this.onViewportChange(cx, cy);
    }

    destroy(): void {
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mouseup',   this._onMouseUp);
    }
}
