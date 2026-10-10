import { TFile } from 'obsidian';
import type { DesignService } from './service';
import type { BoardItem, DesignBoard } from './types';
import { itemsBounds, selectionBoard, strokePath } from './board';
import { edgeLabels, edgePath, labelPoint } from './geometry';
import { dashArray, shapePath } from './shapes';
import { plainHtml, sanitizeRichText } from './rich-text';
import { paperColor } from './card-appearance';
import { tableToMarkdown } from './table';
import { parseTodo } from './todo';
import { imageMarkPath } from './image-marks';
import { worldViewMarkdown } from './world-export';
const xml = (text: unknown) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const color = (value: string | undefined, fallback: string) => value && /^(#[\da-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(value) ? value : fallback;
async function assetHref(service: DesignService, path: string | undefined): Promise<string | undefined> {
    if (!path) return;
    const file = service.plugin.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return;
    const mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' } as Record<string, string>)[file.extension];
    if (!mime) return;
    return `data:${mime};base64,${bytesBase64(new Uint8Array(await service.plugin.app.vault.readBinary(file)))}`;
}
export function bytesBase64(bytes: Uint8Array): string { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); }
function textSvg(item: BoardItem, html: string): string {
    const body = new DOMParser().parseFromString(sanitizeRichText(html), 'text/html').body, size = item.textStyle?.fontSize || 18, padding = 14, maxWidth = Math.max(20, item.w - padding * 2);
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    type TextStyle = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; color: string; size: number; align?: string };
    const rows: (TextStyle & { text: string; width: number })[][] = [[]]; let lineWidth = 0;
    const newLine = () => { if (rows[rows.length - 1]!.length) rows.push([]); lineWidth = 0; };
    const visit = (node: Node, style: TextStyle) => {
        if (node.nodeType === Node.TEXT_NODE) { for (const word of (node.textContent || '').split(/(\s+)/)) { if (!word) continue; if (word.includes('\n')) { newLine(); continue; } if (context) context.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px Arial`; const width = context?.measureText(word).width ?? word.length * style.size * .55; if (lineWidth + width > maxWidth && lineWidth) newLine(); rows[rows.length - 1]!.push({ ...style, text: word, width }); lineWidth += width; } return; }
        if (!(node instanceof HTMLElement)) return;
        if (node.tagName === 'BR') { rows.push([]); lineWidth = 0; return; }
        const heading = ['H1', 'H2', 'H3'].includes(node.tagName);
        const block = heading || ['DIV', 'P', 'LI', 'BLOCKQUOTE', 'PRE'].includes(node.tagName); if (block) newLine();
        const next = { ...style, bold: style.bold || heading || ['B', 'STRONG'].includes(node.tagName) || node.style.fontWeight === 'bold', italic: style.italic || ['I', 'EM'].includes(node.tagName) || node.style.fontStyle === 'italic', underline: style.underline || node.tagName === 'U' || node.style.textDecoration.includes('underline'), strike: style.strike || ['S', 'STRIKE', 'DEL'].includes(node.tagName) || node.style.textDecoration.includes('line-through'), color: color(node.style.color, style.color), size: parseFloat(node.style.fontSize) || style.size * (heading ? ({ H1: 1.6, H2: 1.3, H3: 1.1 }[node.tagName] || 1) : 1), align: node.style.textAlign || style.align };
        if (node.tagName === 'LI') visit(document.createTextNode(node.parentElement?.tagName === 'OL' ? `${Array.from(node.parentElement.children).indexOf(node) + 1}. ` : '• '), next);
        node.childNodes.forEach(child => visit(child, next)); if (block) newLine();
    };
    body.childNodes.forEach(node => visit(node, { bold: false, italic: false, underline: false, strike: false, color: color(item.textStyle?.color, '#172b4d'), size, align: item.textStyle?.align || (item.kind === 'shape' ? 'center' : 'left') }));
    let y = padding; const output: string[] = [];
    for (const row of rows) { const height = Math.max(size, ...row.map(run => run.size)) * 1.3; y += height; let x = padding; const width = row.reduce((sum, run) => sum + run.width, 0), align = row[0]?.align; if (align === 'center') x += (maxWidth - width) / 2; if (align === 'right') x += maxWidth - width; for (const run of row) { const decoration = [run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'; output.push(`<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${run.size}" font-weight="${run.bold ? 'bold' : 'normal'}" font-style="${run.italic ? 'italic' : 'normal'}" text-decoration="${decoration}" fill="${xml(run.color)}" xml:space="preserve">${xml(run.text)}</text>`); x += run.width; } }
    return output.join('');
}
export async function boardSvg(service: DesignService, board: DesignBoard, selection?: Set<string>): Promise<{ svg: string; width: number; height: number }> {
    if (selection) board = selectionBoard(board, selection);
    const active = new Set(board.items.filter(item => !item.unsorted).map(item => item.id));
    board = { ...board, items: board.items.filter(item => active.has(item.id)), edges: board.edges.filter(edge => !edge.unsorted && active.has(edge.from) && active.has(edge.to)), trash: undefined };
    const items = board.items, byId = new Map(board.items.map(item => [item.id, item]));
    const box = items.length ? itemsBounds(items) : { x: 0, y: 0, w: 800, h: 600 };
    for (const edge of board.edges) for (const point of [...(edge.bends || []).map(([x, y]) => ({ x, y })), ...edgeLabels(edge).map(label => labelPoint(edge, label, byId))]) { const right = Math.max(box.x + box.w, point.x + 100), bottom = Math.max(box.y + box.h, point.y + 30); box.x = Math.min(box.x, point.x - 100); box.y = Math.min(box.y, point.y - 30); box.w = right - box.x; box.h = bottom - box.y; }
    const width = Math.ceil(box.w + 60), height = Math.ceil(box.h + 60), parts: string[] = [];
    for (const edge of board.edges) { const line = color(edge.color, '#475569'), marker = 'arrow-' + xml(edge.id); parts.push(`<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${xml(line)}"/></marker></defs><path d="${edgePath(edge, byId)}" fill="none" stroke="${xml(line)}" stroke-width="${edge.width || 2}" stroke-dasharray="${dashArray(edge.dash, edge.width) || ''}" ${edge.arrow !== 'none' ? `marker-end="url(#${marker})"` : ''} ${edge.arrow === 'both' ? `marker-start="url(#${marker})"` : ''}/>`); }
    for (const item of [...items].sort((a, b) => a.z - b.z)) {
        if (item.kind === 'anchor') continue;
        const fill = color(item.kind === 'sticky' ? paperColor(item.color) : item.color, '#bfdbfe'), outline = `stroke="${xml(color(item.strokeColor, item.kind === 'frame' ? '#94a3b8' : 'none'))}" stroke-width="${item.strokeWidth ?? (item.kind === 'frame' ? 2 : 0)}" stroke-dasharray="${dashArray(item.strokeDash, item.strokeWidth) || ''}"`;
        let inside = '';
        if (item.kind === 'image') { const file = service.plugin.app.vault.getAbstractFileByPath(item.path || ''); if (!(file instanceof TFile)) throw new Error(`${service.tr('design_no_image')}: ${item.path}`); const binary = await service.plugin.app.vault.readBinary(file), mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' } as Record<string, string>)[file.extension] || 'image/png'; const crop = item.crop || { x: 0, y: 0, w: 1, h: 1 }; inside = `<svg width="${item.w}" height="${item.h}" overflow="hidden"><image x="${-crop.x * item.w / crop.w}" y="${-crop.y * item.h / crop.h}" width="${item.w / crop.w}" height="${item.h / crop.h}" preserveAspectRatio="none" href="data:${mime};base64,${bytesBase64(new Uint8Array(binary))}"/></svg>`; }
        else if (item.kind === 'stroke') inside = `<path d="${strokePath(item.points || [])}" fill="none" stroke="${xml(fill)}" stroke-width="${item.width || 3}" stroke-linecap="round"/>`;
        else if (item.kind === 'sketch') inside = `<rect width="${item.w}" height="${item.h}" rx="8" fill="#ffffff" ${outline}/>` + (item.sketch || []).map(stroke => `<path d="${strokePath(stroke.points)}" fill="none" stroke="${xml(color(stroke.color, '#172b4d'))}" stroke-width="${stroke.width}" stroke-linecap="round" opacity="${stroke.opacity ?? 1}"/>`).join('');
        else { const entity = item.kind === 'entity' ? service.index.resolve(item.ref!) : undefined, type = entity && service.settings.types.find(type => type.id === entity.type); let html = item.richText || plainHtml(item.kind === 'frame' ? item.title || '' : item.text || ''); if (entity) html = `<b>${plainHtml(entity.title)}</b><br>${plainHtml(type?.name || '')}<br>` + (type?.fields.filter(field => field.card).map(field => plainHtml(field.name + ': ' + service.displayValue(entity, field.id))).join('<br>') || ''); if (item.kind === 'board') html = plainHtml(service.resolveBoard(item.ref!)?.board.name || service.tr('design_missing_board')); if (item.kind === 'file') html = plainHtml(item.path || ''); if (item.kind === 'table' && item.table) html = plainHtml(tableToMarkdown(item.table)); if (item.kind === 'world-view' && item.worldView) html = plainHtml(worldViewMarkdown(service, item.worldView)); if (item.kind === 'todo') html = plainHtml(parseTodo(item.text || '').map(line => `${line.done ? '☑' : '☐'} ${line.text}`).join('\n')); if (item.kind === 'link') html = plainHtml(`${item.title || item.preview?.title || ''}\n${item.preview?.description || ''}\n${item.text || ''}`.trim()); inside = item.kind === 'shape' ? `<svg width="${item.w}" height="${item.h}" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${shapePath(item.shape)}" fill="${xml(fill)}" ${outline} vector-effect="non-scaling-stroke"/></svg>` : `<rect width="${item.w}" height="${item.h}" rx="${item.kind === 'frame' ? 0 : 8}" fill="${item.kind === 'text' || item.kind === 'frame' ? 'none' : xml(item.kind === 'entity' || item.kind === 'board' || item.kind === 'file' ? '#ffffff' : fill)}" ${outline}/>`; inside += textSvg(item, html); }
        if (item.kind === 'image' && item.imageStrokes?.length) inside += `<svg width="${item.w}" height="${item.h}" overflow="hidden">` + item.imageStrokes.map(mark => `<path d="${imageMarkPath(mark, item.w, item.h, item.crop)}" fill="none" stroke="${xml(color(mark.color, '#ef4444'))}" stroke-width="${mark.width * item.w / (item.crop?.w || 1)}" stroke-linecap="round" stroke-linejoin="round"/>`).join('') + '</svg>';
        if (item.kind === 'link') {
            const image = await assetHref(service, item.preview?.image), head = image ? item.h * .44 : 40;
            inside = `<svg width="${item.w}" height="${item.h}" overflow="hidden"><rect width="${item.w}" height="${item.h}" rx="8" fill="#ffffff" ${outline}/>` +
                (image ? `<svg width="${item.w}" height="${head}" overflow="hidden"><image href="${image}" width="${item.w}" height="${head}" preserveAspectRatio="xMidYMid slice"/></svg>` : `<rect width="${item.w}" height="${head}" fill="#f1f5f9"/>`) +
                `<g transform="translate(0 ${head})">${textSvg({ ...item, textStyle: { ...item.textStyle, fontSize: 13 } }, `<b>${plainHtml(item.title || item.preview?.title || item.text || '')}</b><br>${plainHtml(item.preview?.description || '')}<br>${plainHtml(item.text || '')}`)}</g></svg>`;
        }
        if (item.kind === 'board') {
            const nested = service.resolveBoard(item.ref || '')?.board, image = await assetHref(service, nested?.cover), head = Math.min(104, Math.max(20, item.h - 62));
            inside = `<svg width="${item.w}" height="${item.h}" overflow="hidden"><rect width="${item.w}" height="${item.h}" rx="8" fill="#ffffff" ${outline}/><rect width="${item.w}" height="${head}" fill="${xml(paperColor(fill))}"/>` +
                (image ? `<svg width="${item.w}" height="${head}" overflow="hidden"><image href="${image}" width="${item.w}" height="${head}" preserveAspectRatio="xMidYMid slice"/></svg>` : '') +
                `<text x="14" y="${head - 12}" font-size="24">${xml(nested?.icon || '▦')}</text><g transform="translate(0 ${head})">${textSvg({ ...item, textStyle: { fontSize: 14 } }, `<b>${plainHtml(nested?.name || service.tr('design_missing_board'))}</b>`)}</g></svg>`;
        }
        if (item.band) inside += `<rect width="${item.w}" height="8" fill="${xml(color(item.band, '#ffffff'))}"/>`;
        parts.push(`<g transform="translate(${item.x} ${item.y}) rotate(${item.rotation || 0} ${item.w / 2} ${item.h / 2})" opacity="${item.opacity ?? 1}">${inside}</g>`);
    }
    for (const edge of board.edges) for (const label of edgeLabels(edge)) { const p = labelPoint(edge, label, byId); parts.push(`<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="14" font-family="Arial, sans-serif" fill="${xml(color(edge.color, '#475569'))}">${xml(label.text)}</text>`); }
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${box.x - 30} ${box.y - 30} ${width} ${height}"><rect x="${box.x - 30}" y="${box.y - 30}" width="${width}" height="${height}" fill="${xml(color(board.background, '#ffffff'))}"/>${parts.join('')}</svg>`, width, height };
}
export function jpegPdf(jpeg: Uint8Array, width: number, height: number): ArrayBuffer {
    const encode = (text: string) => new TextEncoder().encode(text), pieces: Uint8Array[] = [], offsets = [0]; let length = 0;
    const push = (value: Uint8Array) => { pieces.push(value); length += value.length; }, object = (id: number, data: string) => { offsets[id] = length; push(encode(`${id} 0 obj\n${data}\nendobj\n`)); };
    push(encode('%PDF-1.4\n')); object(1, '<< /Type /Catalog /Pages 2 0 R >>'); object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); const scale = Math.min(1, 14400 / Math.max(width, height)), w = width * scale, h = height * scale; object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Img 4 0 R >> >> /Contents 5 0 R >>`); offsets[4] = length; push(encode(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)); push(jpeg); push(encode('\nendstream\nendobj\n')); const command = `q ${w} 0 0 ${h} 0 0 cm /Img Do Q\n`; object(5, `<< /Length ${encode(command).length} >>\nstream\n${command}endstream`); const xref = length; push(encode(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)); const result = new Uint8Array(length); let position = 0; for (const piece of pieces) { result.set(piece, position); position += piece.length; } return result.buffer;
}
export async function exportBoard(service: DesignService, board: DesignBoard, format: 'svg' | 'png' | 'pdf', selection?: Set<string>): Promise<string> {
    const { svg, width, height } = await boardSvg(service, board, selection);
    if (format === 'svg') return service.writeExport(board.name, format, svg);
    // Bound raster memory on desktop and mobile; vector SVG remains at full resolution.
    const scale = Math.min(2, 8192 / Math.max(width, height), Math.sqrt(16000000 / (width * height))), canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale)); const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable'); const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('SVG rasterization failed')); image.src = 'data:image/svg+xml;base64,' + bytesBase64(new TextEncoder().encode(svg)); }); context.drawImage(image, 0, 0, canvas.width, canvas.height); const mime = format === 'pdf' ? 'image/jpeg' : 'image/png'; const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Raster export failed')), mime, .95)); const binary = await blob.arrayBuffer(); return service.writeExport(board.name, format, format === 'pdf' ? jpegPdf(new Uint8Array(binary), canvas.width, canvas.height) : binary);
}
