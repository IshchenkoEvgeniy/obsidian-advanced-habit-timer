import { parse, stringify } from 'yaml';
export const Platform = { get isAndroidApp() { return document.body.classList.contains('is-android'); } };
// Obsidian supplies these DOM helpers at runtime; fixtures must provide them too.
(HTMLElement.prototype as any).createEl = function(tag: string, options: { text?: string; cls?: string; value?: string; attr?: Record<string, string> } = {}) {
    const node = document.createElement(tag); if (options.text !== undefined) node.textContent = options.text; if (options.cls) node.className = options.cls; if (options.value !== undefined) (node as HTMLInputElement).value = options.value;
    for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, value); this.append(node); return node;
};
(HTMLElement.prototype as any).addClass = function(...names: string[]) { this.classList.add(...names); };
export class TFile { path: string; basename: string; extension: string; stat = { mtime: 0, ctime: 0, size: 0 }; constructor(path: string) { this.path = path; this.extension = path.split('.').pop() || ''; this.basename = path.split('/').pop()!.replace(/\.md$/, ''); } }
export class Notice { constructor(message: string) { console.log('Notice:', message); } }
export async function requestUrl(request: { url: string }) {
    const response = (window as any).designRequestUrl;
    if (response) return response(request);
    throw new Error('Network unavailable in fixture');
}
export class Component { load() {} unload() {} }
export const parseYaml = parse;
export const stringifyYaml = stringify;
export function setIcon(node: HTMLElement, name: string) { node.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8M12 8v8"/></svg>'; node.dataset.icon = name; }
export function getIconIds(): string[] { return ['star', 'map-pin', 'user']; }
export function getIcon(name: string): SVGSVGElement | null { if (!getIconIds().includes(name)) return null; const node = document.createElement('div'); setIcon(node, name); return node.firstElementChild as SVGSVGElement; }
export class MarkdownRenderer { static async render(_app: unknown, text: string, node: HTMLElement) { node.textContent = text; } }
export class Modal {
    modalEl = document.createElement('section'); contentEl = document.createElement('div'); private overlay = document.createElement('div');
    constructor(_app: unknown) { this.modalEl.className = 'fixture-modal'; this.overlay.className = 'fixture-overlay'; this.modalEl.append(this.contentEl); this.overlay.append(this.modalEl); }
    open() { document.body.append(this.overlay); this.onOpen(); }
    close() { this.onClose(); this.overlay.remove(); }
    onOpen() {} onClose() {}
}
export class FuzzySuggestModal<T> extends Modal {
    private placeholder = '';
    setPlaceholder(value: string) { this.placeholder = value; }
    getItems(): T[] { return []; } getItemText(_item: T) { return ''; } onChooseItem(_item: T) {}
    onOpen() { const input = document.createElement('input'); input.placeholder = this.placeholder; const list = document.createElement('div'); const render = () => { list.replaceChildren(); for (const item of this.getItems().filter(item => this.getItemText(item).toLowerCase().includes(input.value.toLowerCase()))) { const button = document.createElement('button'); button.textContent = this.getItemText(item); button.onclick = () => { this.onChooseItem(item); this.close(); }; list.append(button); } }; input.oninput = render; this.contentEl.append(input, list); render(); input.focus(); }
}
