<script lang="ts">
    import { onDestroy } from 'svelte';
    import { setIcon } from 'obsidian';
    import type { BoardItem, DesignBoard } from '../types';
    import type { DesignService } from '../service';
    export let service: DesignService;
    export let board: DesignBoard;
    export let mode: 'unsorted' | 'trash';
    export let canvas: HTMLElement;
    export let title: (item: BoardItem) => string;
    export let onClose: () => void;
    export let onPlace: (id: string, client?: { x: number; y: number }) => void;
    export let onDelete: (id: string) => void;
    export let onRestore: (id: string) => void;
    export let onEmpty: () => void;
    export let onCreate: (kind: 'sticky' | 'link') => void;
    export let onFiles: (files: File[]) => void;
    const tr = service.tr.bind(service);
    let upload: HTMLInputElement;
    let press: { id: string; x: number; y: number; pointer: number; text: string } | undefined;
    let freeLines: BoardItem[] = [];
    let ghost: { x: number; y: number; text: string } | undefined;
    let suppressed = false;
    $: unsorted = board.items.filter(item => item.unsorted && item.kind !== 'anchor' && !board.items.some(parent => parent.unsorted && parent.kind === 'frame' && (item.columnId === parent.id || (item.x >= parent.x && item.y >= parent.y && item.x + item.w <= parent.x + parent.w && item.y + item.h <= parent.y + parent.h && item.id !== parent.id))));
    $: freeLines = board.edges.filter(edge => edge.unsorted || [edge.from, edge.to].every(id => board.items.some(item => item.id === id && item.unsorted && item.kind === 'anchor'))).map(edge => ({ id: edge.id, kind: 'text' as const, text: tr('design_palette_line'), x: 0, y: 0, w: 100, h: 10, z: 0 }));
    function icon(node: HTMLElement, name: string) { setIcon(node, name); }
    function begin(event: PointerEvent, item: BoardItem) {
        if (board.readOnly || item.locked || event.button !== 0) return;
        suppressed = false; press = { id: item.id, x: event.clientX, y: event.clientY, pointer: event.pointerId, text: title(item) };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
    }
    function move(event: PointerEvent) { if (press && event.pointerId === press.pointer && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) ghost = { x: event.clientX, y: event.clientY, text: press.text }; }
    function end(event: PointerEvent) {
        if (!press || event.pointerId !== press.pointer) return;
        const id = press.id, dragged = Boolean(ghost), rect = canvas.getBoundingClientRect();
        cancel(); suppressed = dragged;
        if (dragged && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) onPlace(id, { x: event.clientX, y: event.clientY });
    }
    function cancel() { press = undefined; ghost = undefined; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); }
    function toBody(node: HTMLElement) { document.body.appendChild(node); return { destroy: () => node.remove() }; }
    onDestroy(cancel);
</script>

<aside class="design-shelf" data-board-shelf={mode} aria-label={tr(mode === 'unsorted' ? 'design_unsorted' : 'design_trash')} on:dragover|preventDefault on:drop|preventDefault={event => { if (!board.readOnly && mode === 'unsorted') onFiles(Array.from(event.dataTransfer?.files || [])); }}>
    <div class="design-shelf-heading"><span use:icon={mode === 'unsorted' ? 'inbox' : 'trash-2'}></span><strong>{tr(mode === 'unsorted' ? 'design_unsorted' : 'design_trash')}</strong><button class="design-icon-button" on:click={onClose} aria-label={tr('design_close_panel')}>×</button></div>
    <p class="design-shelf-description">{tr(mode === 'unsorted' ? 'design_unsorted_hint' : 'design_trash_hint')}</p>
    {#if mode === 'unsorted'}
        <div class="design-shelf-create"><button disabled={board.readOnly} on:click={() => onCreate('sticky')}>+ {tr('design_palette_note')}</button><button disabled={board.readOnly} on:click={() => onCreate('link')}>+ {tr('design_link')}</button><button disabled={board.readOnly} on:click={() => upload.click()}>{tr('design_upload')}</button><input bind:this={upload} type="file" multiple hidden on:change={event => { onFiles(Array.from(event.currentTarget.files || [])); event.currentTarget.value = ''; }} /></div>
        <div class="design-shelf-list">{#each [...unsorted, ...freeLines] as item (item.id)}<div class="design-shelf-card" data-unsorted-item={item.id}>
            <button class="design-shelf-content" disabled={board.readOnly || item.locked} on:pointerdown={event => begin(event, item)} on:click={() => { if (suppressed) { suppressed = false; return; } onPlace(item.id); }}>
                {#if item.kind === 'image' && item.path}<img src={service.image(item.path)} alt="" draggable="false" />{:else}<span class="design-shelf-kind" use:icon={item.kind === 'board' ? 'layout-dashboard' : item.kind === 'link' ? 'link' : item.kind === 'file' ? 'paperclip' : 'sticky-note'}></span>{/if}
                <strong>{title(item)}</strong>{#if item.kind === 'link' && item.preview?.description}<small>{item.preview.description}</small>{/if}
            </button><button class="design-shelf-delete design-icon-button" disabled={board.readOnly || item.locked} on:click={() => onDelete(item.id)} aria-label={tr('delete')}>×</button>
        </div>{:else}<div class="design-shelf-empty"><span use:icon={'inbox'}></span><p>{tr('design_unsorted_empty')}</p></div>{/each}</div>
    {:else}
        <div class="design-shelf-list">{#each board.trash || [] as entry (entry.id)}<div class="design-trash-card"><strong>{entry.items.filter(item => item.kind !== 'anchor').slice(0, 2).map(title).join(', ') || tr('design_palette_line')}</strong><small>{new Date(entry.deletedAt).toLocaleString()}</small><button disabled={board.readOnly} on:click={() => onRestore(entry.id)}>{tr('design_restore')}</button></div>{:else}<div class="design-shelf-empty"><span use:icon={'trash-2'}></span><p>{tr('design_trash_empty')}</p></div>{/each}</div>
        {#if board.trash?.length}<button class="design-empty-trash" disabled={board.readOnly} on:click={onEmpty}>{tr('design_empty_trash')}</button>{/if}
    {/if}
</aside>
{#if ghost}<div use:toBody class="design-shelf-ghost" style:left={`${ghost.x}px`} style:top={`${ghost.y}px`}>{ghost.text}</div>{/if}
