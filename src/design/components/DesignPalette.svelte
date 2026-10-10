<script lang="ts">
    import { onDestroy } from 'svelte';
    import { setIcon } from 'obsidian';
    import type { PaletteItem } from '../dock';

    /** The menu lists the board's objects, or the text formatting while a text is being edited. Objects are dragged onto the board. */
    export let items: PaletteItem[] = [];
    export let mode: 'objects' | 'text' = 'objects';
    /** The board: an item dropped outside it is not placed. */
    export let dropArea: HTMLElement | undefined = undefined;
    export let hint = '';
    export let heading = '', searchLabel = '';
    export let compact = false, moreLabel = '', closeLabel = '';
    let expanded = false;
    let filter = '';
    $: moreItem = { id: 'more', glyph: 'plus', label: moreLabel, title: moreLabel, run: () => { filter = ''; expanded = true; } };
    $: if (mode === 'text') { expanded = false; filter = ''; }
    $: shown = compact && !expanded && mode === 'objects' ? items.filter(item => ['select', 'hand', 'sticky', 'board'].includes(item.id)) : mode === 'text' || !filter ? items : items.filter(item => `${item.label} ${item.title}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));

    /** A press on an item: a click runs it, a move past the threshold drags it onto the board. */
    let panel: HTMLDivElement;
    let press: { item: PaletteItem; x: number; y: number; pointer: number; dragging: boolean; droppable: boolean; button: HTMLElement; win: Window } | undefined;
    let ghost: { item: PaletteItem; x: number; y: number; over: boolean } | undefined;
    /** Set by a drag, so the click that may follow its release does not run the item again. */
    let suppressClick = false;
    const THRESHOLD = 6;

    function icon(node: HTMLElement, name: string) { setIcon(node, name); return { update(next: string) { if (next !== name) { name = next; setIcon(node, next); } } }; }
    /** Moves the ghost to the end of the document body: inside a view a transformed or contained ancestor would make a fixed element follow that ancestor instead of the pointer. */
    function toBody(node: HTMLElement) { panel.ownerDocument.body.appendChild(node); return { destroy() { node.remove(); } }; }
    function inside(rect: DOMRect | undefined, x: number, y: number): boolean { return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom; }
    /** Over the board and not over the menu itself, which lies on top of the board's left edge. */
    function overBoard(x: number, y: number): boolean { return inside(dropArea?.getBoundingClientRect(), x, y) && !inside(panel?.getBoundingClientRect(), x, y); }

    function pressItem(event: PointerEvent, item: PaletteItem) {
        if (press) return;
        suppressClick = false;
        if (event.button !== 0 || item.disabled) return;
        const button = event.currentTarget as HTMLElement, win = button.ownerDocument.defaultView;
        if (!win) return;
        press = { item, x: event.clientX, y: event.clientY, pointer: event.pointerId, dragging: false, droppable: Boolean(item.drop) && mode === 'objects', button, win };
        // Obsidian may stop pointer events in a pane or move this view into another window.
        // Capture them in the button's own window before they reach the host's handlers.
        win.addEventListener('pointermove', moveItem, true);
        win.addEventListener('pointerup', releaseItem, true);
        win.addEventListener('pointercancel', cancelPointer, true);
        win.addEventListener('blur', cancelPress);
        button.addEventListener('lostpointercapture', cancelPointer);
        if (press.droppable && event.pointerType !== 'touch') {
            event.preventDefault(); // Prevent native mouse drag/selection from canceling our pointer gesture.
            try { button.setPointerCapture(event.pointerId); } catch { /* An untrusted event has no active pointer. */ }
        }
    }
    function moveItem(event: PointerEvent) {
        if (!press || event.pointerId !== press.pointer) return;
        if (!press.dragging) {
            if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < THRESHOLD) return;
            press.dragging = true;
        }
        if (press.droppable) {
            if (event.pointerType !== 'touch') event.preventDefault();
            ghost = { item: press.item, x: event.clientX, y: event.clientY, over: overBoard(event.clientX, event.clientY) };
        }
    }
    function releaseItem(event: PointerEvent) {
        if (!press || event.pointerId !== press.pointer) return;
        const released = press, dragged = press.dragging ? press : undefined;
        endPress();
        if (!dragged) { if (event.pointerType === 'touch') { suppressClick = true; expanded = false; released.item.run?.(); } return; }
        suppressClick = true;
        if (dragged.droppable && overBoard(event.clientX, event.clientY)) { expanded = false; dragged.item.drop?.(event.clientX, event.clientY); }
    }
    function endPress() {
        const ended = press;
        press = undefined;
        ghost = undefined;
        if (!ended) return;
        ended.win.removeEventListener('pointermove', moveItem, true);
        ended.win.removeEventListener('pointerup', releaseItem, true);
        ended.win.removeEventListener('pointercancel', cancelPointer, true);
        ended.win.removeEventListener('blur', cancelPress);
        ended.button.removeEventListener('lostpointercapture', cancelPointer);
        if (ended.button.hasPointerCapture(ended.pointer)) ended.button.releasePointerCapture(ended.pointer);
    }
    function cancelPress() { if (press?.dragging) suppressClick = true; endPress(); }
    function cancelPointer(event: PointerEvent) { if (event.pointerId === press?.pointer) cancelPress(); }
    function clickItem(event: MouseEvent, item: PaletteItem) {
        const suppressed = suppressClick && event.detail !== 0;
        suppressClick = false;
        if (suppressed) return;
        if (!item.disabled) { expanded = false; item.run?.(); }
    }
    onDestroy(endPress);
</script>

<div bind:this={panel} class="design-palette" class:is-text={mode === 'text'} class:is-expanded={compact && expanded} role="toolbar" tabindex="-1" aria-orientation={compact && !expanded ? 'horizontal' : 'vertical'} title={hint} on:dragstart|preventDefault>
    <div class="design-palette-heading"><span class="design-palette-brand" use:icon={'layers'}></span><strong>{heading}</strong>{#if compact}<button class="design-chrome-icon" on:click={() => { expanded = false; filter = ''; }} aria-label={closeLabel}><span use:icon={'x'}></span></button>{/if}</div>
    {#if mode === 'objects'}<div class="design-palette-search"><span use:icon={'search'}></span><input type="search" placeholder={searchLabel} aria-label={searchLabel} bind:value={filter} /></div>{/if}
    <div class="design-palette-list">
        {#each shown as item (item.id)}
            {#if item.divider}<hr class="design-palette-divider" />{/if}
            {#if item.kind === 'color'}
                <label class="design-palette-item" title={item.title}><span class="design-palette-glyph" use:icon={item.glyph}></span><input type="color" aria-label={item.title} value={String(item.value ?? '#172b4d')} on:pointerdown={() => item.focus?.()} on:focus={() => item.focus?.()} on:input={event => item.change?.(event.currentTarget.value)} /><small>{item.label}</small></label>
            {:else if item.kind === 'number'}
                <label class="design-palette-item" title={item.title}><span class="design-palette-glyph" use:icon={item.glyph}></span><input type="number" min="6" max="200" aria-label={item.title} value={item.value} on:pointerdown={() => item.focus?.()} on:focus={() => item.focus?.()} on:input={event => item.change?.(event.currentTarget.value)} /><small>{item.label}</small></label>
            {:else}
                <button class="design-palette-item" data-tool={item.id} disabled={item.disabled} class:mod-cta={item.active} class:is-draggable={Boolean(item.drop) && mode === 'objects'} title={item.title} aria-label={item.title} aria-pressed={item.active ? 'true' : undefined} on:mousedown={event => { if (mode === 'text') event.preventDefault(); }} on:pointerdown={event => pressItem(event, item)} on:click={event => clickItem(event, item)}><span class="design-tool-preview" data-tool={item.id}><span class="design-palette-glyph" use:icon={item.glyph}></span>{#if item.id === 'board'}<i></i><i></i><i></i>{/if}</span><small>{item.label}</small></button>
            {/if}
        {/each}
        {#if compact && !expanded && mode === 'objects'}<button class="design-palette-item design-palette-more" aria-label={moreLabel} aria-expanded={expanded} on:pointerdown={event => pressItem(event, moreItem)} on:click={event => clickItem(event, moreItem)}><span class="design-tool-preview"><span class="design-palette-glyph" use:icon={'plus'}></span></span><small>{moreLabel}</small></button>{/if}
    </div>
    <div class="design-palette-footer">{hint}</div>
</div>
{#if ghost}<div use:toBody class="design-palette-ghost" class:is-over={ghost.over} style:left={`${ghost.x}px`} style:top={`${ghost.y}px`} aria-hidden="true"><span class="design-palette-glyph" use:icon={ghost.item.glyph}></span><small>{ghost.item.label}</small></div>{/if}
