import { contained } from './board';
import { edgeLabels } from './geometry';
import type { BoardItem, DesignBoard } from './types';

/**
 * Board to Markdown (L13). Frames become headings, and the objects inside a frame become a list under it.
 * Loose objects follow, then the links between objects. `describe` gives the text for one object: wiki-links for
 * records, task lines for to-do cards, table markdown for tables. An empty string skips the object.
 */
export function boardToMarkdown(board: DesignBoard, describe: (item: BoardItem) => string): string {
    const visible = board.items.filter(item => item.kind !== 'anchor' && !item.unsorted);
    const byPosition = (a: BoardItem, b: BoardItem) => a.y - b.y || a.x - b.x;
    const frames = visible.filter(item => item.kind === 'frame');
    const parents = new Map(visible.map(item => [item.id, frames.filter(frame => contained(frame, item) && (item.kind !== 'frame' || frame.w * frame.h > item.w * item.h)).sort((a, b) => a.w * a.h - b.w * b.h)[0]?.id]));
    const out: string[] = [`# ${board.name}`, ''];
    const push = (text: string) => {
        // Multi-line blocks (task lists, tables) are written as they are; a single line becomes a list item.
        if (text.includes('\n') || /^(- |\||#)/.test(text)) out.push(text);
        else out.push(`- ${text}`);
    };
    const writeFrame = (frame: BoardItem, level: number) => {
        const children = visible.filter(item => parents.get(item.id) === frame.id).sort(byPosition);
        out.push(`${'#'.repeat(Math.min(6, level))} ${frame.title || frame.text || 'Рамка'}`, '');
        for (const item of children.filter(item => item.kind !== 'frame')) { const text = describe(item); if (text) push(text); }
        out.push('');
        for (const child of children.filter(item => item.kind === 'frame')) writeFrame(child, level + 1);
    };
    for (const frame of frames.filter(frame => !parents.get(frame.id)).sort(byPosition)) writeFrame(frame, 2);
    const loose = visible.filter(item => item.kind !== 'frame' && !parents.get(item.id)).sort(byPosition);
    for (const item of loose) { const text = describe(item); if (text) push(text); }
    if (loose.length) out.push('');
    const byId = new Map(visible.map(item => [item.id, item] as const));
    // A link is labeled by the first line of the object's text, without list or task markers.
    const label = (id: string) => { const item = byId.get(id); if (!item) return ''; const first = (describe(item).split('\n')[0] || '').replace(/^- (\[[ xX]\] )?/, ''); return first || item.title || item.text || ''; };
    const active = new Set(board.items.filter(item => !item.unsorted).map(item => item.id));
    const links = board.edges.filter(edge => !edge.unsorted && active.has(edge.from) && active.has(edge.to)).map(edge => { const text = edgeLabels(edge).map(label => label.text).filter(Boolean).join('; '); return `- ${label(edge.from)} ${edge.arrow === 'none' ? '—' : '→'} ${label(edge.to)}${text ? ` (${text})` : ''}`; });
    if (links.length) out.push('## Связи', '', ...links, '');
    return out.join('\n');
}
