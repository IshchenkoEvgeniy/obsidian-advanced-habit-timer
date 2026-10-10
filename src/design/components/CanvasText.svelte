<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import type { BoardItem } from '../types';
    import type { DesignService } from '../service';
    import { plainHtml, sanitizeRichText, safeLink } from '../rich-text';
    import { DesignPrompt } from '../modals';
    import { shortcutLetter } from '../keys';
    import { defaultTextColor, validTextRange } from '../text-format';
    export let service: DesignService;
    export let item: BoardItem;
    export let html = '', text = '', editing = false;
    export let onChange: (html: string, text: string) => void;
    export let onFinish: () => void;
    let node: HTMLDivElement, range: Range | undefined, wasEditing = false, focusFrame = 0;
    const tr = service.tr.bind(service);
    function content(node: HTMLElement, value: string) {
        node.innerHTML = sanitizeRichText(value);
        return { update(next: string) { const clean = sanitizeRichText(next); if (node.innerHTML !== clean && (!editing || sanitizeRichText(node.innerHTML) !== clean)) node.innerHTML = clean; } };
    }
    function changed() { if (node) onChange(sanitizeRichText(node.innerHTML), node.innerText); }
    function remember() { const selection = window.getSelection(); if (selection?.rangeCount && node?.contains(selection.anchorNode)) range = selection.getRangeAt(0).cloneRange(); }
    function command(name: string, value?: string) { node.focus(); if (validTextRange(node, range)) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); } if (name === 'foreColor') document.execCommand('styleWithCSS', false, 'true'); document.execCommand(name, false, value); if (name === 'foreColor') document.execCommand('styleWithCSS', false, 'false'); remember(); changed(); }
    function link() { remember(); new DesignPrompt(service, tr('design_link'), '', async value => { const href = safeLink(value); if (href) command('createLink', href); }).open(); }
    /** Markdown shortcuts typed alone at the start of a text: "# ", "## ", "### ", "- ", "* ", "1. ", "[] ". Returns true when it handled the space. */
    function markdownTrigger(): boolean {
        const selection = window.getSelection(); if (!selection?.rangeCount || !selection.isCollapsed || !node) return false;
        const caret = selection.getRangeAt(0), probe = caret.startContainer;
        if (probe.nodeType !== Node.TEXT_NODE) return false;
        const before = (probe.textContent || '').slice(0, caret.startOffset);
        if ((node.textContent || '').trim() !== before.trim()) return false;
        const rule = before === '#' ? 'H1' : before === '##' ? 'H2' : before === '###' ? 'H3' : before === '-' || before === '*' ? 'ul' : /^\d+\.$/.test(before) ? 'ol' : before === '[]' || before === '[ ]' ? 'todo' : '';
        if (!rule) return false;
        probe.textContent = (probe.textContent || '').slice(caret.startOffset);
        caret.setStart(probe, 0); caret.collapse(true); selection.removeAllRanges(); selection.addRange(caret);
        if (rule === 'ul') document.execCommand('insertUnorderedList');
        else if (rule === 'ol') document.execCommand('insertOrderedList');
        else if (rule === 'todo') document.execCommand('insertText', false, '☐ ');
        else document.execCommand('formatBlock', false, rule);
        changed(); return true;
    }
    function key(event: KeyboardEvent) { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); changed(); onFinish(); } if (event.key === ' ' && !event.ctrlKey && !event.metaKey && markdownTrigger()) { event.preventDefault(); return; } const modifier = event.ctrlKey || event.metaKey, letter = shortcutLetter(event); if (modifier && ['b', 'i', 'u'].includes(letter)) { event.preventDefault(); command({ b: 'bold', i: 'italic', u: 'underline' }[letter]!); } if (modifier && event.altKey && letter === 'k') { event.preventDefault(); link(); } if (modifier && event.shiftKey && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) { event.preventDefault(); command('formatBlock', `H${event.code.slice(-1)}`); return; } if (modifier && event.shiftKey && letter === 'x') { event.preventDefault(); command('strikeThrough'); } if (modifier && event.shiftKey && letter === 'q') { event.preventDefault(); command('formatBlock', 'BLOCKQUOTE'); } if (event.key === 'Tab') { event.preventDefault(); command(event.shiftKey ? 'outdent' : 'indent'); } }
    function paste(event: ClipboardEvent) { event.stopPropagation(); event.preventDefault(); const html = event.clipboardData?.getData('text/html'), text = event.clipboardData?.getData('text/plain') || ''; document.execCommand('insertHTML', false, html ? sanitizeRichText(html) : plainHtml(text)); changed(); }
    $: if (editing && node && !wasEditing) { wasEditing = true; focusFrame = requestAnimationFrame(() => { if (!editing || !node?.isConnected) return; node.focus({ preventScroll: true }); const selection = window.getSelection(), next = document.createRange(); next.selectNodeContents(node); next.collapse(false); selection?.removeAllRanges(); selection?.addRange(next); }); }
    $: if (!editing) { wasEditing = false; cancelAnimationFrame(focusFrame); range = undefined; }
    onMount(() => document.addEventListener('selectionchange', remember));
    onDestroy(() => { cancelAnimationFrame(focusFrame); document.removeEventListener('selectionchange', remember); });
</script>
<!-- svelte-ignore a11y_no_static_element_interactions (Editable canvas text owns its keyboard and pointer events.) -->
<div bind:this={node} class="design-rich-text" class:design-editing-text={editing} contenteditable={editing} role="textbox" aria-label={tr('design_text')} tabindex={editing ? 0 : -1} style:font-size={`${item.textStyle?.fontSize || 18}px`} style:color={item.textStyle?.color || defaultTextColor(item)} style:text-align={item.textStyle?.align || (item.kind === 'shape' ? 'center' : 'left')} use:content={html || plainHtml(text)} on:input={changed} on:keydown={key} on:paste={paste} on:pointerdown={event => { if (editing) event.stopPropagation(); }} on:click={event => { if (editing) event.stopPropagation(); }}></div>
