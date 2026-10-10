/** Canvas HTML is deliberately restricted; no embedded media, event handlers or remote resources. */
export function safeLink(value: string): string { return /^(https?:\/\/|mailto:|obsidian:\/\/|#)/i.test(value.trim()) ? value.trim() : ''; }
export function plainHtml(text: string): string { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }
export function sanitizeRichText(html: string): string {
    const source = new DOMParser().parseFromString(html, 'text/html'), output = document.createElement('div');
    // Headings, strikethrough, quotes and code blocks are text formatting (L4). Still no media, scripts or styles beyond the whitelist.
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'A', 'SPAN', 'H1', 'H2', 'H3', 'S', 'STRIKE', 'DEL', 'BLOCKQUOTE', 'PRE', 'CODE']);
    const walk = (node: Node, parent: HTMLElement) => {
        if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent || '')); return; }
        if (!(node instanceof Element) || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH', 'IMG', 'FORM'].includes(node.tagName)) return;
        if (!allowed.has(node.tagName)) { node.childNodes.forEach(child => walk(child, parent)); return; }
        const next = document.createElement(node.tagName.toLowerCase());
        if (node.tagName === 'A') { const link = safeLink(node.getAttribute('href') || ''); if (link) { next.setAttribute('href', link); next.setAttribute('rel', 'noopener noreferrer'); } }
        const style = (node as HTMLElement).style;
        if (style) { if (/^(#[\da-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i.test(style.color)) next.style.color = style.color; if (/^(bold|[6-9]00)$/.test(style.fontWeight)) next.style.fontWeight = 'bold'; if (style.fontStyle === 'italic') next.style.fontStyle = 'italic'; if (style.textDecoration.includes('underline')) next.style.textDecoration = 'underline'; if (/^\d+(\.\d+)?px$/.test(style.fontSize) && parseFloat(style.fontSize) >= 6 && parseFloat(style.fontSize) <= 200) next.style.fontSize = style.fontSize; if (['left', 'center', 'right'].includes(style.textAlign)) next.style.textAlign = style.textAlign; }
        node.childNodes.forEach(child => walk(child, next)); parent.appendChild(next);
    };
    source.body.childNodes.forEach(node => walk(node, output)); return output.innerHTML;
}
export function richPlainText(html: string): string { const doc = new DOMParser().parseFromString(sanitizeRichText(html), 'text/html'); doc.querySelectorAll('br').forEach(node => node.replaceWith('\n')); doc.querySelectorAll('div,p,li,h1,h2,h3,blockquote,pre').forEach(node => node.append('\n')); return (doc.body.textContent || '').trimEnd(); }
