import { App, TFile } from 'obsidian';
import { markdownContentLines, maskMarkdownCodeSpans } from './engine/markdown-lines';

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

export function isProjectImageFile(file: TFile): boolean {
    return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

export function isProjectImageFilename(name: string): boolean {
    return IMAGE_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() || '');
}

/** Prefer native embeds; encode names that cannot be represented safely in a wiki link. */
export function projectImageEmbed(file: TFile): string {
    if (!/[[\]|#^%\r\n]/.test(file.path)) return `![[${file.path}]]`;
    const path = file.path.split('/').map(part => encodeURIComponent(part)
        .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
    return `![](${path})`;
}

export function appendProjectImages(app: App, description: string, files: TFile[], sourcePath: string): string {
    const sources = new Set(extractProjectImageReferences(description)
        .map(reference => resolveProjectImage(app, reference, sourcePath)).filter(Boolean));
    const additions: string[] = [];
    for (const file of files) {
        const source = app.vault.getResourcePath(file);
        if (sources.has(source)) continue;
        sources.add(source);
        additions.push(projectImageEmbed(file));
    }
    if (!additions.length) return description;
    return `${description.trimEnd()}${description.trim() ? '\n\n' : ''}${additions.join('\n\n')}`;
}

export interface ProjectImageEmbed { reference: string; raw: string; start: number; end: number; }

function escaped(text: string, at: number): boolean {
    let slashes = 0;
    while (at > 0 && text[--at] === '\\') slashes++;
    return slashes % 2 === 1;
}

/** Mask non-rendered Markdown without changing source offsets. */
function imageMarkdown(markdown: string): string {
    const lines = markdown.split('\n');
    const contentLines = markdownContentLines(lines);
    const source = lines.map((line, index) => contentLines[index] ? line : ' '.repeat(line.length)).join('\n')
        .replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\r\n]/g, ' '));
    return maskMarkdownCodeSpans(source);
}

function closingBracket(source: string, at: number): number {
    let depth = 1;
    for (let index = at + 1; index < source.length; index++) {
        if (escaped(source, index)) continue;
        if (source[index] === '[') depth++;
        if (source[index] === ']' && --depth === 0) return index;
    }
    return -1;
}

const unescapeDestination = (value: string): string => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~ ])/g, '$1');

function imageDestination(source: string, at: number): { reference: string; end: number } | null {
    if (source[at] === '<') {
        for (let index = at + 1; index < source.length && source[index] !== '\n'; index++) {
            if (source[index] === '>' && !escaped(source, index)) return { reference: unescapeDestination(source.slice(at + 1, index)), end: index + 1 };
        }
        return null;
    }
    let depth = 0;
    let index = at;
    for (; index < source.length; index++) {
        const character = source[index]!;
        if (escaped(source, index)) continue;
        if (/\s/.test(character)) break;
        if (character === '(') depth++;
        if (character === ')') {
            if (!depth) break;
            depth--;
        }
    }
    return depth ? null : { reference: unescapeDestination(source.slice(at, index)), end: index };
}

function whitespaceEnd(source: string, at: number): number {
    while (at < source.length && /\s/.test(source[at]!)) at++;
    return at;
}

function inlineImageDestination(source: string, opening: number): { reference: string; end: number } | null {
    const destination = imageDestination(source, whitespaceEnd(source, opening + 1));
    if (!destination) return null;
    let end = whitespaceEnd(source, destination.end);
    if (source[end] !== ')') {
        if (end === destination.end) return null;
        const delimiter = source[end];
        if (delimiter !== '"' && delimiter !== "'" && delimiter !== '(') return null;
        const closing = delimiter === '(' ? ')' : delimiter;
        let close = end + 1;
        for (; close < source.length; close++) if (source[close] === closing && !escaped(source, close)) break;
        if (close === source.length) return null;
        end = whitespaceEnd(source, close + 1);
    }
    return source[end] === ')' ? { reference: destination.reference, end: end + 1 } : null;
}

export function projectMarkdownLinks(markdown: string, imagesOnly = false): ProjectImageEmbed[] {
    const source = imageMarkdown(markdown);
    const definitions = new Map<string, string>();
    const labelKey = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
    for (const match of source.matchAll(/^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*/gm)) {
        const destination = imageDestination(source, match.index + match[0].length);
        if (destination?.reference && !definitions.has(labelKey(match[1]!))) definitions.set(labelKey(match[1]!), destination.reference);
    }
    const result: ProjectImageEmbed[] = [];
    for (let start = 0; start < source.length; start++) {
        const image = source[start] === '!' && source[start + 1] === '[';
        if ((!image && (imagesOnly || source[start] !== '[')) || escaped(source, start)) continue;
        const opening = image ? start + 1 : start;
        let reference = '';
        let end = -1;
        if (source[opening + 1] === '[') {
            let close = source.indexOf(']]', opening + 2);
            while (close >= 0 && escaped(source, close)) close = source.indexOf(']]', close + 2);
            if (close < 0 || source.slice(start, close).includes('\n')) continue;
            reference = source.slice(opening + 2, close).split('|')[0]?.trim() || '';
            end = close + 2;
        } else {
            const close = closingBracket(source, opening);
            if (close < 0) continue;
            if (source[close + 1] === '(') {
                const destination = inlineImageDestination(source, close + 1);
                if (!destination) continue;
                reference = destination.reference;
                end = destination.end;
            } else {
                let label = source.slice(opening + 1, close);
                end = close + 1;
                if (source[end] === '[') {
                    const labelEnd = closingBracket(source, end);
                    if (labelEnd < 0) continue;
                    label = source.slice(end + 1, labelEnd) || label;
                    end = labelEnd + 1;
                }
                reference = definitions.get(labelKey(label)) || '';
            }
        }
        if (reference) result.push({ reference, start, end, raw: markdown.slice(start, end) });
        start = end - 1;
    }
    return result;
}

export function projectImageEmbeds(markdown: string): ProjectImageEmbed[] {
    return projectMarkdownLinks(markdown, true);
}

export function extractProjectImageReferences(markdown: string): string[] {
    return projectImageEmbeds(markdown).map(embed => embed.reference);
}

export function projectImageReferencePath(reference: string): string {
    let path = reference.trim();
    const wrapped = projectImageEmbeds(path.startsWith('!') ? path : `!${path}`)[0];
    if (wrapped) path = wrapped.reference;
    if (path.startsWith('<') && path.endsWith('>')) path = path.slice(1, -1);
    return path.split('|')[0]?.trim() || '';
}

/** Resolve URLs and Obsidian-style image references for use in an HTML image element. */
export function resolveProjectImage(app: App, reference: string, sourcePath: string): string | null {
    let linkpath = projectImageReferencePath(reference);
    if (!linkpath) return null;

    if (/^(https?:|data:image\/)/i.test(linkpath)) return linkpath;

    linkpath = linkpath.split('|')[0]?.trim() || '';
    const literalFile = app.vault.getAbstractFileByPath(linkpath);
    try { linkpath = decodeURIComponent(linkpath); } catch { /* Keep literal vault paths. */ }
    if (!linkpath) return null;

    const file = literalFile instanceof TFile ? literalFile :
        app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) ?? app.vault.getAbstractFileByPath(linkpath);
    if (!(file instanceof TFile) || !isProjectImageFile(file)) return null;

    try { return app.vault.getResourcePath(file); }
    catch { return null; }
}
