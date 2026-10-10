<svelte:options immutable={true} />
<script lang="ts">
    import { setIcon } from 'obsidian';
    import { tick } from 'svelte';
    import type { Action } from 'svelte/action';
    import type { TranslationKey } from '../../i18n';
    import type { DesignService } from '../service';
    import type { BoardDocument, BoardItem, DesignEntity, DesignType } from '../types';
    import { strokePath } from '../board';
    import { shapePath, dashArray } from '../shapes';
    import { CELL_TYPES, columnLetter, displayValue, type CellType, type TableData } from '../table';
    import { safeLink } from '../links';
    import { mediaEmbed } from '../link-preview';
    import { imageMarkPath } from '../image-marks';
    import { pasteTableCells } from '../table-clipboard';
    import { paperColor } from '../card-appearance';
    import CanvasText from './CanvasText.svelte';
    import WorldViewPreview from './WorldViewPreview.svelte';
    import CanvasTodo from './CanvasTodo.svelte';
    import WorldField from './WorldField.svelte';
    import { DesignEntityModal } from '../modals';
    export let service: DesignService;
    export let item: BoardItem;
    export let entity: DesignEntity | undefined;
    export let type: DesignType | undefined;
    export let nested: BoardDocument | undefined;
    export let dataVersion: number;
    export let x: number, y: number, w: number, h: number, z: number;
    export let color: string, text: string, title: string, path: string;
    export let shape: BoardItem['shape'], strokeWidth: number, autoSize: boolean;
    export let selected: boolean, match: boolean, compact: boolean;
    export let interacting = true, zoom = 1;
    /** Column drag: the lifted column, and objects that glide to a new slot. The count is shown on columns only. */
    export let lifted = false, animated = false, count: number | undefined = undefined;
    export let appearance = '{}', richText = '', editingText = false, readOnly = false;
    export let changeText: (id: string, html: string, text: string) => void;
    export let finishText: () => void;
    export let patchItem: (id: string, values: Partial<BoardItem>) => void = () => undefined;
    export let measure: Action<HTMLElement, BoardItem>;
    export let openEntity: (id: string) => void;
    export let removeItem: (id: string) => void;
    export let openBoard: (id: string) => void = () => undefined;
    export let busy = false;
    export let openWorldView: (type: string, view: string) => void = () => undefined;
    let recordEditors = new Set<string>();
    $: recordDetailed = !compact || recordEditors.size > 0;
    function recordEditor(field: string, editing: boolean) {
        if (recordEditors.has(field) === editing) return;
        recordEditors = new Set(recordEditors);
        if (editing) recordEditors.add(field); else recordEditors.delete(field);
    }
    const tr = service.tr.bind(service);
    function icon(node: HTMLElement, name: string) { setIcon(node, name); return { update(next: string) { if (next !== name) { name = next; setIcon(node, next); } } }; }
    function refreshed<T>(_version: number, value: T): T { return value; }
    // Viewport movement does not invalidate note fields, Markdown or image resolution.
    $: fields = refreshed(dataVersion, entity && type ? type.fields.filter(field => field.card && field.kind !== 'image') : []);
    $: titleField = { id: 'title', name: tr('design_name'), kind: 'text' as const };
    $: recordCover = refreshed(dataVersion, entity && type ? service.image(String(entity.values[type.fields.find(field => field.kind === 'image')?.id || ''] || '')) : '');
    $: imageSrc = refreshed(dataVersion, path ? service.image(path) : '');
    $: paint = JSON.parse(appearance) as BoardItem;
    $: embedded = item.kind === 'link' ? mediaEmbed(text) : undefined;
    $: previewSrc = refreshed(dataVersion, paint.preview?.image ? service.image(paint.preview.image) : '');
    $: boardCover = refreshed(dataVersion, nested?.board.cover ? service.image(nested.board.cover) : '');
    $: blocked = readOnly || Boolean(paint.locked);
    $: drawn = strokePath(paint.points || item.points || []);
    $: editable = ['sticky', 'text', 'shape', 'frame'].includes(item.kind);
    $: sizeToContent = autoSize && (item.kind === 'entity' ? recordDetailed : editable && !compact);
    $: table = paint.table as TableData | undefined;
    /** Media shown inline for attached files: video, audio or PDF, by extension. */
    $: mediaKind = /\.(mp4|webm|ogv|mov)$/i.test(path) ? 'video' : /\.(mp3|wav|ogg|oga|m4a|flac)$/i.test(path) ? 'audio' : /\.pdf$/i.test(path) ? 'pdf' : '';
    function thumbnail(board: BoardDocument) { const items = board.board.items.filter(item => !item.unsorted && item.kind !== 'anchor').slice(0, 20), x = Math.min(0, ...items.map(item => item.x)) - 40, y = Math.min(0, ...items.map(item => item.y)) - 40; return `${x} ${y} ${Math.max(400, ...items.map(item => item.x + item.w)) - x + 40} ${Math.max(300, ...items.map(item => item.y + item.h)) - y + 40}`; }
    function openLink(url: string) { const href = safeLink(url); if (href) window.open(href, '_blank', 'noopener'); }
    /** Writes one cell; a cell that did not change is not stored, so blur without edits adds no history. */
    function setCell(row: number, col: number, value: string) {
        const current = table; if (!current || (current.rows[row]?.[col] ?? '') === value) return;
        patchItem(item.id, { table: { columns: current.columns, rows: current.rows.map((cells, r) => r === row ? cells.map((cell, c) => c === col ? value : cell) : cells) } });
    }
    function pasteCells(event: ClipboardEvent, row: number, col: number) {
        const value = event.clipboardData?.getData('text/plain') || ''; if (!table || blocked || !/[\t\n\r]/.test(value)) return;
        event.preventDefault(); event.stopPropagation();
        try { const next = pasteTableCells(table, row, col, value); (event.currentTarget as HTMLInputElement).value = next.rows[row]![col]!; patchItem(item.id, { table: next }); }
        catch (error) { service.report(error); }
    }
    async function cellKey(event: KeyboardEvent, row: number, col: number, raw: string) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const input = event.currentTarget as HTMLInputElement; input.value = raw; input.blur(); return; }
        if (!table || !['Tab', 'Enter'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); const input = event.currentTarget as HTMLInputElement, wrapper = input.closest('.design-table-wrap'); input.blur();
        let r = row, c = col;
        if (event.key === 'Enter') r += event.shiftKey ? -1 : 1; else { c += event.shiftKey ? -1 : 1; if (c < 0) { r--; c = table.columns.length - 1; } if (c >= table.columns.length) { r++; c = 0; } }
        await tick(); wrapper?.querySelector<HTMLInputElement>(`[data-table-cell="${r}:${c}"]`)?.focus();
    }
    function editColumns(change: (columns: TableData['columns']) => TableData['columns']) { if (table) patchItem(item.id, { table: { columns: change(table.columns), rows: table.rows } }); }
    function addRow() { if (table && table.rows.length < 500) patchItem(item.id, { table: { columns: table.columns, rows: [...table.rows, table.columns.map(() => '')] } }); }
    function removeRow() { if (table && table.rows.length > 1) patchItem(item.id, { table: { columns: table.columns, rows: table.rows.slice(0, -1) } }); }
    function addColumn() { if (table && table.columns.length < 50) patchItem(item.id, { table: { columns: [...table.columns, { name: columnLetter(table.columns.length), type: 'text' as CellType }], rows: table.rows.map(row => [...row, '']) } }); }
    function removeColumn() { if (table && table.columns.length > 1) patchItem(item.id, { table: { columns: table.columns.slice(0, -1), rows: table.rows.map(row => row.slice(0, -1)) } }); }
</script>

<div data-item={item.id} use:measure={item} class="design-item" class:design-frame={item.kind === 'frame'} class:design-column={Boolean(paint.column)} class:design-card={item.kind === 'entity' || item.kind === 'board'} class:design-board-card={item.kind === 'board'} class:design-surface-card={['link', 'todo', 'file', 'table', 'sketch', 'world-view'].includes(item.kind)} class:design-sticky={item.kind === 'sticky'} class:design-stroke={item.kind === 'stroke'} class:design-compact={compact} class:is-selected={selected} class:is-match={match} class:design-locked={paint.locked} class:is-lifted={lifted} class:is-animated={animated} style:left={`${x}px`} style:top={`${y}px`} style:width={`${w}px`} style:height={sizeToContent ? 'auto' : `${h}px`} style:min-height={sizeToContent ? '80px' : `${h}px`} style:z-index={editingText ? 100000 : z + 1000} style:--item-color={color} style:--paper-color={paperColor(color)} style:transform={`rotate(${paint.rotation || 0}deg)`} style:opacity={paint.opacity ?? 1} style:border-color={paint.strokeColor} style:border-width={paint.strokeWidth === undefined ? undefined : `${paint.strokeWidth}px`} style:border-style={paint.strokeDash === 'dash' ? 'dashed' : paint.strokeDash === 'dot' ? 'dotted' : paint.strokeColor ? 'solid' : undefined}>
    {#if count !== undefined}<span class="design-column-count">{count}</span>{/if}
    {#if paint.column}<button class="design-column-toggle" disabled={blocked} on:pointerdown|stopPropagation on:click={() => patchItem(item.id, { collapsed: !paint.collapsed })} aria-label={tr(paint.collapsed ? 'design_expand' : 'design_collapse')}>{paint.collapsed ? '+' : '−'}</button>{/if}
    {#if paint.band}<span class="design-band" style:background={paint.band} aria-hidden="true"></span>{/if}
    {#if item.kind === 'world-view' && paint.worldView}<WorldViewPreview {service} reference={paint.worldView} {dataVersion} {compact} {interacting} {zoom} readOnly={blocked} onOpen={() => openWorldView(paint.worldView!.typeId, paint.worldView!.viewId)} onChangeView={viewId => patchItem(item.id, { worldView: { typeId: paint.worldView!.typeId, viewId } })} />
    {:else if item.kind === 'entity'}
        {#if entity}
            {#if recordCover && recordDetailed}<img class="design-record-cover" src={recordCover} alt="" draggable="false" />{/if}
            <div class="design-card-heading">{#if recordDetailed}<span class="design-widget-grip" use:icon={'grip-vertical'}></span><span use:icon={type?.icon || 'file'}></span><WorldField {service} record={entity} field={titleField} readOnly={blocked || !interacting} onEditState={editing => recordEditor('title', editing)} /><button class="design-widget-icon" aria-label={service.plugin.settings.language === 'ru' ? 'Открыть запись полностью' : 'Open full record'} on:pointerdown|stopPropagation on:click={() => new DesignEntityModal(service, entity!, blocked).open()}>↗</button>{:else}<strong>{entity.title}</strong>{/if}</div>
            {#if recordDetailed}<small>{type?.name || tr('design_untyped')}</small><div class="design-record-fields" data-canvas-interactive class:design-widget-passive={!interacting}>{#each fields as field (field.id)}<div class="design-card-field"><span>{field.name}</span><WorldField {service} record={entity} {field} readOnly={blocked || !interacting} onEditState={editing => recordEditor(field.id, editing)} /></div>{/each}</div>{/if}
        {:else}<strong>{tr('design_not_found')}</strong><button on:pointerdown|stopPropagation on:click={() => openEntity(item.ref!)}>{tr('design_entities')}</button><button on:pointerdown|stopPropagation on:click={() => removeItem(item.id)}>{tr('design_remove')}</button>{/if}
    {:else if item.kind === 'board'}<div class="design-nested-board"><div class="design-nested-cover" >{#if boardCover}<img src={boardCover} alt="" draggable="false" />{:else if nested && nested.board.items.some(child => !child.unsorted)}<svg viewBox={thumbnail(nested)} aria-hidden="true">{#each nested.board.items.filter(child => !child.unsorted && child.kind !== 'anchor').slice(0, 20) as child}<rect x={child.x} y={child.y} width={child.w} height={child.h} rx="8" fill={paperColor(child.color || '#e9d5ff')} />{/each}</svg>{:else}<span class="design-nested-empty" use:icon={'layout-dashboard'}></span>{/if}<span class="design-nested-emoji">{#if nested?.board.icon}{nested.board.icon}{:else}<span use:icon={'layout-dashboard'}></span>{/if}</span></div><div class="design-nested-caption"><strong>{nested?.board.name || tr('design_missing_board')}</strong>{#if !compact}<small>{tr('design_cards_label')} {nested?.board.items.filter(child => child.kind !== 'anchor').length || 0} · {tr('design_palette_board')}</small>{/if}</div>{#if !compact && nested}<button class="design-nested-open" on:pointerdown|stopPropagation on:click={() => openBoard(item.ref!)} aria-label={tr('design_open_nested')}>↗</button>{/if}</div>
    {:else if item.kind === 'image'}{#if imageSrc}<div class="design-image-clip"><img draggable="false" src={imageSrc} alt={text || path} style:width={paint.crop ? `${100 / paint.crop.w}%` : '100%'} style:height={paint.crop ? `${100 / paint.crop.h}%` : '100%'} style:left={paint.crop ? `${-paint.crop.x * 100 / paint.crop.w}%` : '0'} style:top={paint.crop ? `${-paint.crop.y * 100 / paint.crop.h}%` : '0'} />{#if paint.imageStrokes?.length}<svg class="design-image-marks" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">{#each paint.imageStrokes as mark}<path d={imageMarkPath(mark, w, h, paint.crop)} fill="none" stroke={mark.color || '#ef4444'} stroke-width={mark.width * w / (paint.crop?.w || 1)} stroke-linecap="round" stroke-linejoin="round" />{/each}</svg>{/if}</div>{:else}{tr('design_no_image')}{/if}
    {:else if item.kind === 'file'}{#if mediaKind === 'video' && imageSrc}<!-- svelte-ignore a11y_media_has_caption --><video class="design-media" controls preload="metadata" src={imageSrc}></video>{:else if mediaKind === 'audio' && imageSrc}<audio class="design-media" controls preload="metadata" src={imageSrc}></audio>{:else if mediaKind === 'pdf' && imageSrc}<iframe class="design-media design-pdf" class:design-passive={!selected} src={imageSrc} title={path.split('/').pop()}></iframe>{/if}
        <div class="design-file-bar"><span use:icon={'file'}></span><strong>{path.split('/').pop()}</strong><button on:pointerdown|stopPropagation on:click={() => { const file = service.plugin.app.vault.getAbstractFileByPath(path); if (file) void service.plugin.app.workspace.getLeaf('tab').openFile(file as import('obsidian').TFile); }}>{tr('design_open_note')}</button></div>
    {:else if item.kind === 'stroke'}<svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" style:overflow={'visible'}><path d={drawn} fill="none" stroke={color} stroke-width={strokeWidth} stroke-linecap="round" class="design-stroke-path" /></svg>
    {:else if item.kind === 'shape'}<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%"><path d={shapePath(shape)} fill={color} stroke={paint.strokeColor || 'none'} stroke-width={paint.strokeWidth || 0} stroke-dasharray={dashArray(paint.strokeDash, paint.strokeWidth)} vector-effect="non-scaling-stroke" /></svg><div class="design-shape-text"><CanvasText {service} item={paint} html={richText} {text} editing={editingText} onChange={(html, text) => changeText(item.id, html, text)} onFinish={finishText} /></div>
    {:else if item.kind === 'frame'}<CanvasText {service} item={paint} html={richText} text={title} editing={editingText} onChange={(html, text) => changeText(item.id, html, text)} onFinish={finishText} />
    {:else if item.kind === 'link'}<div class="design-link-card">{#if embedded}<iframe class="design-link-embed" class:design-passive={!selected} src={embedded} title={title || paint.preview?.title || tr('design_link')} loading="lazy" allow="fullscreen; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>{:else if previewSrc}<img class="design-link-preview-image" src={previewSrc} alt="" draggable="false" />{:else}<div class="design-link-placeholder"><span use:icon={'link'}></span></div>{/if}<div class="design-link-description"><small>{paint.preview?.site || text}</small><strong>{title || paint.preview?.title || text || tr('design_link')}</strong>{#if paint.preview?.description}<p>{paint.preview.description}</p>{/if}{#if busy}<small aria-live="polite">{tr('design_preview_loading')}</small>{/if}{#if safeLink(text)}<button on:pointerdown|stopPropagation on:click={() => openLink(text)}>{tr('design_open_link')} ↗</button>{/if}</div></div>
    {:else if item.kind === 'todo'}<CanvasTodo {service} {text} {title} {compact} {interacting} {zoom} readOnly={blocked} onChange={text => patchItem(item.id, { text })} onTitle={title => patchItem(item.id, { title })} />
    {:else if item.kind === 'table' && table}<div class="design-table-wrap"><table class="design-table"><thead><tr>{#each table.columns as column, c}<th><input aria-label={tr('design_column')} value={column.name} disabled={blocked} on:change={event => editColumns(columns => columns.map((entry, i) => i === c ? { ...entry, name: event.currentTarget.value } : entry))} /><select aria-label={tr('design_cell_type')} disabled={blocked} value={column.type} on:change={event => editColumns(columns => columns.map((entry, i) => i === c ? { ...entry, type: event.currentTarget.value as CellType } : entry))}>{#each CELL_TYPES as cellType}<option value={cellType}>{tr(('design_cell_' + cellType) as TranslationKey)}</option>{/each}</select></th>{/each}</tr></thead><tbody>{#each table.rows as row, r}<tr>{#each row as cell, c}<td>{#if table.columns[c]?.type === 'checkbox'}<input type="checkbox" disabled={blocked} checked={cell === 'true'} on:change={event => setCell(r, c, event.currentTarget.checked ? 'true' : 'false')} />{:else}<input class="design-cell" data-table-cell={`${r}:${c}`} aria-label={`${columnLetter(c)}${r + 1}`} on:paste={event => pasteCells(event, r, c)} on:keydown={event => void cellKey(event, r, c, cell)} disabled={blocked} value={displayValue(table, r, c)} on:focus={event => { event.currentTarget.value = cell; }} on:blur={event => { const input = event.currentTarget; setCell(r, c, input.value); void tick().then(() => { if (table) input.value = displayValue(table, r, c); }); }} />{/if}</td>{/each}</tr>{/each}</tbody></table>{#if !blocked}<div class="design-inline design-table-tools"><button on:pointerdown|stopPropagation on:click={addRow}>+ {tr('design_row')}</button><button on:pointerdown|stopPropagation on:click={removeRow}>− {tr('design_row')}</button><button on:pointerdown|stopPropagation on:click={addColumn}>+ {tr('design_column')}</button><button on:pointerdown|stopPropagation on:click={removeColumn}>− {tr('design_column')}</button></div>{/if}</div>
    {:else if item.kind === 'sketch'}<svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" class="design-sketch" aria-hidden="true">{#each paint.sketch || [] as stroke}<path d={strokePath(stroke.points)} fill="none" stroke={stroke.color || '#172b4d'} stroke-width={stroke.width} stroke-linecap="round" opacity={stroke.opacity ?? 1} />{/each}</svg>{#if !paint.sketch?.length}<small class="design-sketch-hint">{tr('design_sketch_hint')}</small>{/if}
    {:else}<CanvasText {service} item={paint} html={richText} {text} editing={editingText} onChange={(html, text) => changeText(item.id, html, text)} onFinish={finishText} />{/if}
    {#if item.kind === 'image' && text}<div class="design-caption">{text}</div>{/if}
    {#if paint.locked}<span class="design-lock-badge">🔒</span>{/if}
    {#if selected && !blocked && !editingText}{#each ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as handle}<span data-resize={handle} class="design-resize" class:design-resize-corner={handle.length === 2} style:left={handle.includes('w') ? '-4px' : handle.includes('e') ? 'calc(100% - 4px)' : 'calc(50% - 4px)'} style:top={handle.includes('n') ? '-4px' : handle.includes('s') ? 'calc(100% - 4px)' : 'calc(50% - 4px)'} title={tr('design_resize')}></span>{/each}<span data-rotate="true" class="design-rotate-handle" title={tr('design_rotate')}>↻</span>{/if}
</div>
