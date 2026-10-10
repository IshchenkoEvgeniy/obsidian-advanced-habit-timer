import type { BoardItem } from './types';
import { sanitizeRichText } from './rich-text';

export type TextProperty = 'color' | 'fontSize' | 'textAlign';
export function defaultTextColor(item: BoardItem): string {
    return item.kind === 'text' || item.kind === 'frame' ? 'var(--text-normal, #172b4d)' : '#172b4d';
}
export function validTextRange(editor: HTMLElement, range?: Range): range is Range {
    return !!range && editor.contains(range.startContainer) && editor.contains(range.endContainer);
}
/** Whole-card changes replace inline overrides of that property, preserving other formatting. */
export function clearTextProperty(root: ParentNode, property: TextProperty): void {
    root.querySelectorAll<HTMLElement>('[style]').forEach(node => {
        node.style[property] = '';
        if (!node.getAttribute('style')) node.removeAttribute('style');
    });
}
function headingSize(root: ParentNode, value: string): void {
    root.querySelectorAll<HTMLElement>('h1,h2,h3').forEach(node => node.style.fontSize = value);
}
export function applyCardTextStyle(editor: HTMLElement, property: 'color' | 'fontSize', value: string): void {
    clearTextProperty(editor, property); editor.style[property] = value;
    // An explicit size must also replace relative heading sizes, so entering 25 really displays 25px.
    if (property === 'fontSize') headingSize(editor, value);
}
export function clearHtmlProperty(html: string, property: TextProperty, value?: string): string {
    const root = document.createElement('div'); root.innerHTML = sanitizeRichText(html);
    clearTextProperty(root, property);
    if (property === 'fontSize' && value) headingSize(root, value);
    return root.innerHTML;
}
/** Retain the selection after wrapping it, including when a numeric input owns focus. */
export function styleTextRange(range: Range, property: 'color' | 'fontSize', value: string): Range {
    const span = range.startContainer.ownerDocument!.createElement('span');
    span.style[property] = value;
    const fragment = range.extractContents();
    // Existing inline runs or headings must not override the new selection style.
    fragment.querySelectorAll<HTMLElement>('*').forEach(node => node.style[property] = value);
    span.append(fragment); range.insertNode(span);
    const next = span.ownerDocument.createRange(); next.selectNodeContents(span); return next;
}
export function textFormat(editor: HTMLElement, range?: Range): { color: string; fontSize: number } {
    const node = validTextRange(editor, range) ? range.startContainer : editor;
    const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement!;
    const style = editor.ownerDocument.defaultView!.getComputedStyle(element);
    const rgb = style.color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    return { color: rgb ? '#' + rgb.slice(1, 4).map(value => Number(value).toString(16).padStart(2, '0')).join('') : '#172b4d', fontSize: parseFloat(style.fontSize) || 18 };
}
