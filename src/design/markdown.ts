import { parseYaml, stringifyYaml } from 'obsidian';
import { DesignError, type DesignEntity, type DesignField, type DesignBoard } from './types';

export function splitNote(raw: string): { frontmatter: Record<string, unknown>; body: string } {
    const match = raw.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return { frontmatter: {}, body: raw };
    const value = parseYaml(match[1]!);
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new DesignError('design_invalid');
    return { frontmatter: (value || {}) as Record<string, unknown>, body: raw.replace(/^\uFEFF/, '').slice(match[0].length) };
}
function sections(body: string): { name: string; start: number; content: number; end: number }[] {
    const result: { name: string; start: number; content: number; end: number }[] = [];
    let offset = 0, fence = '';
    let current: (typeof result)[number] | undefined;
    for (const line of body.split(/(?<=\n)/)) {
        const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (marker) { if (!fence) fence = marker[1]![0]!; else if (marker[1]![0] === fence) fence = ''; }
        if (!fence && /^#{1,2}\s+/.test(line)) {
            if (current) current.end = offset;
            current = undefined;
            const heading = line.match(/^##\s+(.+?)\s*\r?\n?$/);
            if (heading) { current = { name: heading[1]!, start: offset, content: offset + line.length, end: body.length }; result.push(current); }
        }
        offset += line.length;
    }
    return result;
}
function fieldMarker(id: string): string { return `<!-- design-field:${id} -->`; }
function fieldSection(body: string, name: string, id?: string) { const all = sections(body); return (id ? all.find(s => body.slice(s.content, s.end).trimStart().startsWith(fieldMarker(id))) : undefined) || all.find(s => s.name === name); }
export function longValue(body: string, name: string, id?: string): string { const section = fieldSection(body, name, id); if (!section) return ''; const content = body.slice(section.content, section.end); return (id ? content.replace(fieldMarker(id), '') : content).trim(); }
export function replaceLongValue(body: string, name: string, value: string, id?: string): string {
    const section = fieldSection(body, name, id), header = `## ${name}\n${id ? fieldMarker(id) + '\n' : ''}`;
    if (section) return body.slice(0, section.start) + header + (value.trim() ? value.trim() + '\n\n' : '\n') + body.slice(section.end);
    return value.trim() ? `${body.trimEnd()}\n\n${header}${value.trim()}\n` : body;
}
export function parseEntity(path: string, raw: string, fields: DesignField[] = []): DesignEntity | undefined {
    const { frontmatter, body } = splitNote(raw);
    if (typeof frontmatter.design_id !== 'string' || !frontmatter.design_id || typeof frontmatter.design_type !== 'string') return undefined;
    const values = { ...frontmatter };
    delete values.design_id; delete values.design_type;
    for (const field of fields.filter(f => f.kind === 'longtext')) values[field.id] = longValue(body, field.name, field.id);
    return { id: frontmatter.design_id, type: frontmatter.design_type, path, title: path.split('/').pop()!.replace(/\.md$/i, ''), values, body, raw };
}
export function serializeEntity(entity: DesignEntity, fields: DesignField[] = []): string {
    const original = splitNote(entity.raw).frontmatter;
    const data: Record<string, unknown> = { ...original, ...entity.values, design_id: entity.id, design_type: entity.type };
    let body = entity.body;
    for (const field of fields.filter(f => f.kind === 'longtext')) { delete data[field.id]; body = replaceLongValue(body, field.name, String(entity.values[field.id] || ''), field.id); }
    for (const key of Object.keys(data)) if (data[key] === undefined || data[key] === '') delete data[key];
    return `---\n${stringifyYaml(data).trimEnd()}\n---\n${body}`;
}
const LINKS_START = '<!-- design-links:start -->';
const LINKS_END = '<!-- design-links:end -->';
function markerOffsets(raw: string, marker: string): number[] {
    const body = splitNote(raw).body, offsets: number[] = [];
    let offset = raw.length - body.length, fence = '';
    for (const line of body.split(/(?<=\n)/)) {
        const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (delimiter) { if (!fence) fence = delimiter[1]![0]!; else if (delimiter[1]![0] === fence) fence = ''; }
        else if (!fence && line.trim() === marker) offsets.push(offset + line.indexOf(marker));
        offset += line.length;
    }
    return offsets;
}
export interface ManagedLink { id: string; path: string; title: string; }
/** Only our marked block is replaced. Manual text even within “Связи” remains byte-for-byte intact. */
export function replaceManagedLinks(raw: string, links: ManagedLink[]): string {
    const starts = markerOffsets(raw, LINKS_START), ends = markerOffsets(raw, LINKS_END);
    const start = starts[0] ?? -1, end = ends[0] ?? -1;
    if (starts.length > 1 || ends.length > 1 || (start < 0) !== (end < 0) || (start >= 0 && end < start)) throw new DesignError('design_invalid', 'design-links');
    const unique = [...new Map(links.map(link => [link.id, link])).values()].sort((a, b) => a.id.localeCompare(b.id));
    const block = `${LINKS_START}\n${unique.map(link => `- [[${link.path.replace(/\.md$/i, '')}|${link.title.replace(/[\]|\r\n]/g, '')}]] <!-- design-link:${link.id.replace(/[^a-zA-Z0-9_-]/g, '')} -->`).join('\n')}\n${LINKS_END}`;
    if (start >= 0) return raw.slice(0, start) + block + raw.slice(end + LINKS_END.length);
    if (!unique.length) return raw;
    const { body } = splitNote(raw), section = sections(body).find(s => s.name === 'Связи');
    if (section) { const insert = raw.length - body.length + section.end; return raw.slice(0, insert).trimEnd() + '\n\n' + block + '\n\n' + raw.slice(insert); }
    return `${raw.trimEnd()}\n\n## Связи\n${block}\n`;
}
export function boardRelations(boards: DesignBoard[]): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const board of boards) {
        const items = new Map(board.items.map(item => [item.id, item]));
        for (const edge of board.edges) {
            const from = items.get(edge.from), to = items.get(edge.to);
            if (from?.kind !== 'entity' || to?.kind !== 'entity' || !from.ref || !to.ref) continue;
            const targets = result.get(from.ref) || new Set<string>(); targets.add(to.ref); result.set(from.ref, targets);
        }
    }
    return result;
}
