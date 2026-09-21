import { TFile, Notice } from 'obsidian';
import HabitTimerPlugin from '../../main';
import type { CanvasData, CanvasNode, CanvasNodeType } from './canvas-types';
import type { ProjectScopeDefinition } from '../types';

/** Export the canvas as PNG by rendering to an offscreen HTML5 Canvas. */
export async function exportPNG(
    canvasArea: HTMLElement,
    data: CanvasData,
    plugin: HabitTimerPlugin,
): Promise<void> {
    if (data.nodes.length === 0) { new Notice('Nothing to export.'); return; }

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of data.nodes) {
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
    }
    const pad = 40;
    const W = maxX - minX + pad * 2;
    const H = maxY - minY + pad * 2;

    // Use the live SVG element — serialize it and draw via Image
    const svgEl = canvasArea.querySelector('svg');
    if (!svgEl) { new Notice('Canvas SVG not found.'); return; }

    const offscreen = document.createElement('canvas');
    const scale = Math.min(2, 4000 / Math.max(W, H));
    offscreen.width  = W * scale;
    offscreen.height = H * scale;
    const ctx = offscreen.getContext('2d')!;
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    // Clone SVG, adjust viewBox for export
    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${W} ${H}`);
    clone.setAttribute('width',  String(W * scale));
    clone.setAttribute('height', String(H * scale));
    // Reset group transforms (they used absolute px translations)
    clone.querySelectorAll('g').forEach(g => g.removeAttribute('style'));

    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        offscreen.toBlob(pngBlob => {
            if (!pngBlob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(pngBlob);
            a.download = 'canvas-export.png';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            new Notice('✅ PNG exported!');
        }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); new Notice('Export failed.'); };
    img.src = url;
}

interface ObsidianCanvasNode {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    file?: string;
    text?: string;
    label?: string;
    background?: string;
    color?: string;
    obsidian_ht_type?: CanvasNodeType;
}

interface ObsidianCanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide: string;
    toSide: string;
    label?: string;
    color?: string;
}

interface ObsidianCanvasData {
    nodes?: ObsidianCanvasNode[];
    edges?: ObsidianCanvasEdge[];
}

/** Export canvas as SVG string and trigger download. */
export async function exportSVG(
    canvasArea: HTMLElement,
    data: CanvasData,
): Promise<void> {
    if (data.nodes.length === 0) { new Notice('Nothing to export.'); return; }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of data.nodes) {
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
    }
    const pad = 40;

    const svgEl = canvasArea.querySelector('svg');
    if (!svgEl) { new Notice('Canvas SVG not found.'); return; }

    const clone = svgEl.cloneNode(true) as SVGElement;
    clone.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.querySelectorAll('g').forEach(g => g.removeAttribute('style'));

    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'canvas-export.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    new Notice('✅ SVG exported!');
}

/** Convert our .htcanvas data to Obsidian's JSON Canvas format and save as .canvas file. */
export async function exportToObsidianCanvas(
    data: CanvasData,
    scope: ProjectScopeDefinition,
    plugin: HabitTimerPlugin,
): Promise<void> {
    // JSON Canvas spec (https://jsoncanvas.org)
    const obsNodes: ObsidianCanvasNode[] = data.nodes.map(n => {
        if (n.type === 'task' && n.taskFile) {
            return { id: n.id, type: 'file', file: n.taskFile, x: Math.round(n.x), y: Math.round(n.y), width: n.width, height: n.height, color: n.color };
        }
        if (n.type === 'group') {
            return { id: n.id, type: 'group', label: n.label || '', x: Math.round(n.x), y: Math.round(n.y), width: n.width, height: n.height, background: n.background, color: n.color };
        }
        // text / milestone / timer / link → text node
        return { id: n.id, type: 'text', text: n.content || n.label || n.taskName || '', x: Math.round(n.x), y: Math.round(n.y), width: n.width, height: n.height, color: n.color, obsidian_ht_type: n.type };
    });

    const obsEdges: ObsidianCanvasEdge[] = data.edges.map(e => ({
        id: e.id, fromNode: e.fromNode, toNode: e.toNode,
        fromSide: (e.fromSide as "top"|"bottom"|"left"|"right") || "right", toSide: (e.toSide as "top"|"bottom"|"left"|"right") || "left",
        label: e.label, color: e.color,
    }));

    const obsCanvas = JSON.stringify({ nodes: obsNodes, edges: obsEdges }, null, 2);
    const outPath = `${scope.sourceValue.replace(/\/$/, '')}/${scope.name}.canvas`;

    const existing = plugin.app.vault.getAbstractFileByPath(outPath);
    if (existing instanceof TFile) {
        await plugin.app.vault.modify(existing, obsCanvas);
    } else {
        // Ensure folder
        const parts = outPath.split('/'); parts.pop();
        const dir = parts.join('/');
        if (dir) { try { await plugin.app.vault.createFolder(dir); } catch { /* exists */ } }
        try {
            await plugin.app.vault.create(outPath, obsCanvas);
        } catch (err) {
            const e = err as Error;
            if (e.message && e.message.includes('already exists')) {
                const retry = plugin.app.vault.getAbstractFileByPath(outPath);
                if (retry instanceof TFile) await plugin.app.vault.modify(retry, obsCanvas);
                else await plugin.app.vault.adapter.write(outPath, obsCanvas);
            } else {
                console.error('Failed to export canvas:', err);
            }
        }
    }

    // Open the newly created canvas
    const f = plugin.app.vault.getAbstractFileByPath(outPath);
    if (f instanceof TFile) await plugin.app.workspace.openLinkText(outPath, '', false);

    new Notice(`✅ Opened in Obsidian Canvas: ${outPath}`);
}

/** Import an existing .canvas file and merge its nodes/edges into our data. */
export async function importFromObsidianCanvas(
    canvasPath: string,
    data: CanvasData,
    plugin: HabitTimerPlugin,
): Promise<boolean> {
    const file = plugin.app.vault.getAbstractFileByPath(canvasPath);
    if (!(file instanceof TFile)) { new Notice(`File not found: ${canvasPath}`); return false; }

    let obsData: ObsidianCanvasData;
    try {
        obsData = JSON.parse(await plugin.app.vault.read(file)) as ObsidianCanvasData;
    } catch { new Notice('Could not parse .canvas file.'); return false; }

    const existingIds = new Set(data.nodes.map(n => n.id));
    let added = 0;

    for (const n of (obsData.nodes ?? [])) {
        if (existingIds.has(n.id)) continue;
        const node: CanvasNode = {
            id: n.id,
            type: n.obsidian_ht_type ?? (n.type === 'file' ? 'task' : n.type === 'group' ? 'group' : 'text'),
            x: n.x ?? 0, y: n.y ?? 0,
            width: n.width ?? 200, height: n.height ?? 120,
            taskFile: n.type === 'file' ? n.file : undefined,
            content: n.text ?? undefined,
            label: n.label ?? undefined,
            background: n.background ?? undefined,
            color: n.color ?? undefined,
        };
        data.nodes.push(node);
        existingIds.add(node.id);
        added++;
    }

    for (const e of (obsData.edges ?? [])) {
        if (data.edges.some(ex => ex.id === e.id)) continue;
        data.edges.push({
            id: e.id, fromNode: e.fromNode, toNode: e.toNode,
            fromSide: (e.fromSide as "top"|"bottom"|"left"|"right") || "right", toSide: (e.toSide as "top"|"bottom"|"left"|"right") || "left",
            label: e.label, color: e.color,
        });
    }

    new Notice(`✅ Imported ${added} nodes from ${file.name}`);
    return true;
}
