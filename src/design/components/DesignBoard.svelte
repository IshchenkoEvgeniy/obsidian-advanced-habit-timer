<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';
    import { setIcon, getIcon, getIconIds } from 'obsidian';
    import type { TranslationKey } from '../../i18n';
    import type { DesignService } from '../service';
    import type { BoardSession } from '../session';
    import { clone, uid, SHAPES, type BoardItem, type BoardEdge, type DesignBoard } from '../types';
    import { alignItems, autoLayout, contained, deleteItems, duplicateItems, expandSelection, followConnections, groupItems, hitItem, itemLocalPoint, itemsBounds, mindBranch, movingIds, selectionBoard, strokePath, visible, zoomAt } from '../board';
    import { DesignConfirm, DesignImageModal, DesignHelpModal, DesignPicker, DesignPrompt, DesignEntityModal } from '../modals';
    import { edgePath as pathForEdge, edgePoints as pointsForEdge, edgeLabels, labelPoint } from '../geometry';
    import { erasePartial, resizeItem, styleOf, templateItems } from '../operations';
    import { exportBoard } from '../export';
    import { plainHtml, richPlainText, safeLink, sanitizeRichText } from '../rich-text';
    import { shortcutLetter } from '../keys';
    import { codeCommand, letterCommand } from '../commands';
    import { emptyTable, tableToMarkdown } from '../table';
    import { boardToMarkdown } from '../markdown-board';
    import { worldViewMarkdown } from '../world-export';
    import { straightPoint, straightSides } from '../straight';
    import { columnRowMembers, planColumnRow } from '../columns';
    import { cornerPoint, CORNERS, type Corner } from '../corners';
    import BoardControls from './BoardControls.svelte';
    import { designClipboard } from '../clipboard';
    import ItemView from './BoardItem.svelte';
    import DesignPalette from './DesignPalette.svelte';
    import type { PaletteItem } from '../dock';
    import BoardShelf from './BoardShelf.svelte';
    import { columnDrop, columnMembers, manageColumn, layoutColumn, placeInColumn, reflowColumns, type ColumnDrop } from '../column-layout';
    import { stashItems, placeFromShelf, trashItems, restoreTrash } from '../shelf';
    import { webLink, mediaEmbed } from '../link-preview';
    import { imageSize } from '../image-size';
    import { applyCardTextStyle, clearHtmlProperty, styleTextRange, textFormat, validTextRange, type TextProperty } from '../text-format';
    export let service: DesignService;
    export let session: BoardSession;
    export let revision = 0;
    export let compact = false;
    export let onOpenEntity: (id: string) => void;
    export let onNavigate: (id: string) => void;
    export let onNewEntity: () => void;
    export let onOpenWorldView: (type: string, view: string, readOnly: boolean) => void = () => undefined;
    /** Ctrl+U (parent board) and Ctrl+[ / Ctrl+] (back / forward), handled by the hub that owns the trail. */
    export let onHistory: (command: 'parent' | 'back' | 'forward') => void = () => undefined;
    /** Objects dropped on another board's breadcrumb go there (L6). */
    export let onMoveItems: (targetId: string, items: BoardItem[], edges: BoardEdge[]) => Promise<void> = async () => { throw new Error('Destination unavailable'); };
    let canvas: HTMLDivElement, width = 900, height = 650;
    let searchOpen = false, multiSelect = false, alive = true;
    let searchInput: HTMLInputElement, showMap = true, editingText = '', partialEraser = false, presentation = -1, searchCursor = -1;
    $: showMap = !compact;
    let editingLabel: { edge: string; label: string } | undefined;
    let clipboardFallback: ReturnType<typeof setTimeout> | undefined;
    let copyFallback: ReturnType<typeof setTimeout> | undefined;
    let tool = 'select', selected = new Set<string>(), source = '', search = '', space = false;
    /** Text formatting for the palette: the selection saved inside the text being edited, and the styles it has. */
    let textRange: Range | undefined, selectionFormat: { color: string; fontSize: number } | undefined, formatting = { bold: false, italic: false, underline: false, strike: false, bullets: false, numbers: false };
    /** Floating board menu items: the objects while nothing is being typed, the text formatting while a text is edited. */
    let objectItems: PaletteItem[] = [], textItems: PaletteItem[] = [], paletteObjects: PaletteItem[] = [];
    /** Where a palette item was dropped: an object created next without a point of its own is centred there. */
    let pendingAt: { x: number; y: number } | undefined;
    let shelf: 'unsorted' | 'trash' | undefined, insertion: ColumnDrop | undefined;
    let fetchingLinks = new Set<string>();
    let shape: BoardItem['shape'] = 'rect', color = '#facc15', penWidth = 3, menu = false;
    let selectionBox: { x: number; y: number; w: number; h: number } | undefined;
    let stroke: [number, number][] = [], endpointPreview: { x: number; y: number } | undefined;
    let hoverItem = '', connectPreview: { from: { x: number; y: number }; to: { x: number; y: number } } | undefined;
    let guides: { x?: number; y?: number } = {};
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: { center: { x: number; y: number }; distance: number; view: DesignBoard['viewport'] } | undefined;
    let drag: { mode: string; start: { x: number; y: number }; view: DesignBoard['viewport']; positions: Map<string, BoardItem>; item?: string; side?: string; moved: boolean; base: DesignBoard; selection?: Set<string> } | undefined;
    /** Column drag (Milanote-style): the dragged column is lifted, its row neighbours slide aside, the drop settles into a slot. */
    let lifted = '', animated = new Set<string>(), slotGhost: { x: number; y: number; w: number; h: number } | undefined, displaced = new Map<string, number>();
    let longPress: ReturnType<typeof setTimeout> | undefined;
    let lastTap = { id: '', time: 0 }, lastEmpty = { time: 0, x: 0, y: 0 };
    const tr = service.tr.bind(service);
    $: board = refreshed(revision, session.board);
    function refreshed<T>(_revision: number, value: T): T { return value; }
    /** History flags are plain fields, so they are read through `revision` to refresh the undo/redo buttons. */
    function historyState(_revision: number) { return { canUndo: session.history.canUndo, canRedo: session.history.canRedo }; }
    $: contentKey = contentStamp(revision, session);
    function contentStamp(_revision: number, current: BoardSession) { return current.board.id + ':' + current.contentVersion; }
    function contentData(_key: string) {
        const current = session.board;
        return {
            hidden: hiddenIds(current), byId: new Map(current.items.map(item => [item.id, item])),
            counts: new Map(current.items.filter(item => item.column).map(column => [column.id, columnMembers(current, column).length] as const)),
            bounds: bounds(current.items.filter(item => !item.unsorted)),
            appearance: new Map(current.items.map(item => [item.id, JSON.stringify({ kind: item.kind, rotation: item.rotation, locked: item.locked, textStyle: item.textStyle, strokeColor: item.strokeColor, strokeWidth: item.strokeWidth, strokeDash: item.strokeDash, opacity: item.opacity, crop: item.crop, points: item.points, band: item.band, column: item.column, collapsed: item.collapsed, table: item.table, sketch: item.sketch, imageStrokes: item.imageStrokes, preview: item.preview, worldView: item.worldView })]))
        };
    }
    $: content = contentData(contentKey);
    $: hidden = content.hidden;
    $: items = board.items.filter(item => item.kind !== 'anchor' && !hidden.has(item.id) && (item.id === editingText || visible(item, board.viewport, width, height))).sort((a, b) => a.z - b.z);
    $: selectedItem = board.items.find(item => selected.has(item.id));
    $: editedItem = board.items.find(item => item.id === editingText);
    $: if (editingText && (board.readOnly || !editedItem || editedItem.locked)) finishText();
    $: objectItems = [
        { id: 'select', glyph: 'mouse-pointer-2', label: tr('design_select'), title: tr('design_select'), active: tool === 'select', run: () => chooseTool('select') },
        { id: 'hand', glyph: 'hand', label: tr('design_hand'), title: tr('design_hand'), active: tool === 'hand', run: () => chooseTool('hand') },
        { id: 'sticky', glyph: 'sticky-note', label: tr('design_palette_note'), title: tr('design_sticky'), active: tool === 'sticky', divider: true, run: () => chooseTool('sticky') },
        { id: 'text', glyph: 'type', label: tr('design_text'), title: tr('design_text'), active: tool === 'text', run: () => chooseTool('text') },
        { id: 'shape', glyph: 'shapes', label: tr('design_shape'), title: tr('design_shape'), active: tool === 'shape', run: () => chooseTool('shape') },
        { id: 'edge', glyph: 'move-up-right', label: tr('design_palette_line'), title: tr('design_edge'), active: tool === 'edge', run: () => chooseTool('edge') },
        { id: 'frame', glyph: 'scan', label: tr('design_frame'), title: tr('design_frame'), active: tool === 'frame', run: () => chooseTool('frame') },
        { id: 'link', glyph: 'link', label: tr('design_link'), title: tr('design_add_link'), divider: true, run: chooseLink },
        { id: 'todo', glyph: 'check-square', label: tr('design_todo'), title: tr('design_add_todo'), run: addTodo },
        { id: 'table', glyph: 'table', label: tr('design_table'), title: tr('design_add_table'), run: addTable },
        { id: 'world-view', glyph: 'database', label: service.plugin.settings.language === 'ru' ? 'Таблица мира' : 'World table', title: service.plugin.settings.language === 'ru' ? 'Представление записей мира' : 'World record view', run: chooseWorldView },
        { id: 'sketch', glyph: 'pencil-line', label: tr('design_sketch'), title: tr('design_add_sketch'), run: addSketch },
        { id: 'column', glyph: 'columns', label: tr('design_column'), title: tr('design_make_column'), run: addColumn },
        { id: 'board', glyph: 'network', label: tr('design_palette_board'), title: tr('design_new_board_label'), divider: true, run: newNestedBoard },
        { id: 'board-link', glyph: 'external-link', label: tr('design_board_shortcut'), title: tr('design_board_shortcut'), run: chooseBoard },
        { id: 'record', glyph: 'file-plus-2', label: tr('design_palette_record'), title: tr('design_choose_entity'), run: chooseEntity },
        { id: 'new-record', glyph: 'plus', label: tr('design_palette_new_record'), title: tr('design_new_entity'), run: onNewEntity },
        { id: 'inbox', glyph: 'inbox', label: tr('design_inbox'), title: tr('design_inbox'), run: chooseInbox },
        { id: 'image', glyph: 'image', label: tr('design_palette_image'), title: tr('design_image'), divider: true, run: chooseImage },
        { id: 'file', glyph: 'paperclip', label: tr('design_palette_file'), title: tr('design_file'), run: chooseFile },
        { id: 'icons', glyph: 'smile', label: tr('design_palette_icons'), title: tr('design_icons'), run: iconLibrary },
        { id: 'paste', glyph: 'clipboard-paste', label: tr('design_paste'), title: tr('design_clipboard_os'), run: () => void pasteOs() },
        { id: 'pen', glyph: 'pencil', label: tr('design_pen'), title: tr('design_pen'), active: tool === 'pen', divider: true, run: () => chooseTool('pen') },
        { id: 'marker', glyph: 'pen-tool', label: tr('design_marker'), title: tr('design_marker'), active: tool === 'marker', run: () => chooseTool('marker') },
        { id: 'highlighter', glyph: 'highlighter', label: tr('design_highlighter'), title: tr('design_highlighter'), active: tool === 'highlighter', run: () => chooseTool('highlighter') },
        { id: 'eraser', glyph: 'eraser', label: tr('design_eraser'), title: tr('design_eraser'), active: tool === 'eraser', run: () => chooseTool('eraser') },
        { id: 'unsorted', glyph: 'inbox', label: tr('design_unsorted'), title: tr('design_unsorted'), divider: true, run: () => shelf = shelf === 'unsorted' ? undefined : 'unsorted' },
        { id: 'trash', glyph: 'trash-2', label: tr('design_trash'), title: tr('design_trash'), run: () => shelf = shelf === 'trash' ? undefined : 'trash' },
    ];
    /** Text being edited: the same formatting as the old bar above the text, now in the board menu. */
    $: textItems = [
        { id: 'back', glyph: 'check', label: tr('design_finish_edit'), title: tr('design_finish_edit'), run: finishText },
        { id: 'color', kind: 'color', glyph: 'palette', label: tr('design_text_color'), title: tr('design_text_color'), value: selectionFormat?.color || editedItem?.textStyle?.color || '#172b4d', divider: true, focus: rememberText, change: value => formatText('foreColor', value) },
        { id: 'size', kind: 'number', glyph: 'case-sensitive', label: tr('design_font_size'), title: tr('design_font_size'), value: selectionFormat?.fontSize || editedItem?.textStyle?.fontSize || 18, focus: rememberText, change: applyTextSize },
        { id: 'bold', glyph: 'bold', label: tr('design_bold'), title: tr('design_bold'), active: formatting.bold, divider: true, run: () => formatText('bold') },
        { id: 'italic', glyph: 'italic', label: tr('design_italic'), title: tr('design_italic'), active: formatting.italic, run: () => formatText('italic') },
        { id: 'underline', glyph: 'underline', label: tr('design_underline'), title: tr('design_underline'), active: formatting.underline, run: () => formatText('underline') },
        { id: 'strike', glyph: 'strikethrough', label: tr('design_strike'), title: tr('design_strike'), active: formatting.strike, run: () => formatText('strikeThrough') },
        { id: 'bullets', glyph: 'list', label: tr('design_bullets'), title: tr('design_bullets'), active: formatting.bullets, divider: true, run: () => formatText('insertUnorderedList') },
        { id: 'numbers', glyph: 'list-ordered', label: tr('design_numbers'), title: tr('design_numbers'), active: formatting.numbers, run: () => formatText('insertOrderedList') },
        { id: 'align-left', glyph: 'align-left', label: tr('design_align_left'), title: tr('design_align_left'), divider: true, run: () => formatText('justifyLeft') },
        { id: 'align-center', glyph: 'align-center', label: tr('design_align_center'), title: tr('design_align_center'), run: () => formatText('justifyCenter') },
        { id: 'align-right', glyph: 'align-right', label: tr('design_align_right'), title: tr('design_align_right'), run: () => formatText('justifyRight') },
        { id: 'h1', glyph: 'heading-1', label: 'H1', title: 'H1', divider: true, run: () => formatText('formatBlock', 'H1') },
        { id: 'h2', glyph: 'heading-2', label: 'H2', title: 'H2', run: () => formatText('formatBlock', 'H2') },
        { id: 'h3', glyph: 'heading-3', label: 'H3', title: 'H3', run: () => formatText('formatBlock', 'H3') },
        { id: 'quote', glyph: 'quote', label: tr('design_quote'), title: tr('design_quote'), run: () => formatText('formatBlock', 'BLOCKQUOTE') },
        { id: 'link', glyph: 'link', label: tr('design_link'), title: tr('design_link'), divider: true, run: linkText },
    ];
    $: selectedEdge = board.edges.find(edge => selected.has(edge.id));
    $: lowerSearch = search.toLocaleLowerCase();
    $: matches = search ? board.items.filter(item => item.kind !== 'anchor' && `${title(item)} ${item.text || ''} ${item.kind === 'entity' ? service.index.resolve(item.ref!)?.body || '' : ''}`.toLocaleLowerCase().includes(lowerSearch)) : [];
    $: frames = board.items.filter(item => item.kind === 'frame' && !item.unsorted).sort((a, b) => a.y - b.y || a.x - b.x);
    $: itemById = content.byId;
    /** Cards inside each column (anchors and strokes do not count), shown as a badge on the column. */
    $: columnCounts = content.counts;
    $: handles = hoverItem && !drag && !selected.has(hoverItem) ? handlesFor(hoverItem, board) : [];
    $: mapBounds = content.bounds;
    $: unsortedCount = board.items.filter(item => item.unsorted && item.kind !== 'anchor').length + board.edges.filter(edge => edge.unsorted).length;
    $: edges = board.edges.filter(edge => { if (edge.unsorted) return false; const a = itemById.get(edge.from), b = itemById.get(edge.to); return a && b && !hidden.has(edge.from) && !hidden.has(edge.to) && visible({ ...a, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + Math.max(a.w, b.w), h: Math.abs(a.y - b.y) + Math.max(a.h, b.h) }, board.viewport, width, height); });
    function icon(node: HTMLElement, value: string) { setIcon(node, value); return { update(next: string) { if (next !== value) { value = next; setIcon(node, next); } } }; }
    function boardMenu(node: HTMLDetailsElement) {
        const outside = (event: PointerEvent) => { if (compact && node.open && !node.contains(event.target as Node)) node.open = false; };
        const command = (event: MouseEvent) => { if (compact && (event.target as Element).closest('button')) node.open = false; };
        node.ownerDocument.addEventListener('pointerdown', outside); node.addEventListener('click', command);
        return { destroy() { node.ownerDocument.removeEventListener('pointerdown', outside); node.removeEventListener('click', command); } };
    }
    function measure(node: HTMLElement) { const observer = new ResizeObserver(entries => { width = entries[0]!.contentRect.width; height = entries[0]!.contentRect.height; if (compact && editingText) { const item = session.board.items.find(item => item.id === editingText); if (item) focusText(item); } }); observer.observe(node); return { destroy: () => observer.disconnect() }; }
    function autoMeasure(node: HTMLElement, item: BoardItem) { let current = item; const observer = new ResizeObserver(() => { if (!current.autoSize || current.locked || session.board.readOnly || session.board.viewport.zoom < .3 || !session.board.items.includes(current)) return; const height = node.offsetHeight; if (Math.abs(current.h - height) > 1) { current.h = height; if (current.columnId) { const parent = session.board.items.find(item => item.id === current.columnId); if (parent) layoutColumn(session.board, parent); if (session.dirty) session.touch(); else session.layoutChanged(); } else session.layoutChanged(); } }); observer.observe(node); return { update(next: BoardItem) { current = next; }, destroy() { observer.disconnect(); } }; }
    function point(event: PointerEvent | WheelEvent) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
    function world(p: { x: number; y: number }) { return { x: (p.x - board.viewport.x) / board.viewport.zoom, y: (p.y - board.viewport.y) / board.viewport.zoom }; }
    function center() { return world({ x: width / 2, y: height / 2 }); }
    function bounds(items: BoardItem[]) { const x = Math.min(0, ...items.map(item => item.x)) - 40, y = Math.min(0, ...items.map(item => item.y)) - 40; return { x, y, w: Math.max(400, ...items.map(item => item.x + item.w)) - x + 40, h: Math.max(300, ...items.map(item => item.y + item.h)) - y + 40 }; }
    function navigateMap(event: MouseEvent) { const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined; if (!rect) return; const x = mapBounds.x + (event.clientX - rect.left) / rect.width * mapBounds.w, y = mapBounds.y + (event.clientY - rect.top) / rect.height * mapBounds.h; board.viewport.x = width / 2 - x * board.viewport.zoom; board.viewport.y = height / 2 - y * board.viewport.zoom; session.touchViewport(); }
    function chooseTool(id: string) { if (board.readOnly && !['select', 'hand'].includes(id)) return; finishText(); tool = id; source = ''; selected = new Set(); pendingAt = undefined; }
    /** Every content change goes through here, so a read-only board cannot be edited by any path that uses mutate. */
    function mutate(run: () => void) { if (board.readOnly) return; const before = clone(board); session.checkpoint(); run(); reflowColumns(board); followConnections(before, board); session.touch(); }
    /** Read-only is a board setting, so it is set directly rather than through mutate. */
    function setReadOnly(value: boolean) { finishText(); tool = 'select'; source = ''; session.checkpoint(); board.readOnly = value ? true : undefined; session.touch(); }
    function title(item: BoardItem): string { return item.kind === 'entity' ? service.index.resolve(item.ref!)?.title || tr('design_not_found') : item.kind === 'board' ? service.resolveBoard(item.ref!)?.board.name || tr('design_missing_board') : item.title || item.text || tr(('design_' + (item.kind === 'stroke' ? 'pen' : item.kind)) as TranslationKey); }
    function add(kind: BoardItem['kind'], extra: Partial<BoardItem> = {}, p?: { x: number; y: number }) { if (!alive || board.readOnly) return; const w =extra.w || (kind === 'frame' ? 500 : 230), h = extra.h || (kind === 'frame' ? 340 : kind === 'text' ? 80 : 160), c = center(); const position = p || (pendingAt ? { x: pendingAt.x - w / 2, y: pendingAt.y - h / 2 } : { x: c.x - w / 2, y: c.y - h / 2 }); pendingAt = undefined; const item: BoardItem = { id: uid(), kind, x: position.x, y: position.y, w, h, autoSize: kind === 'sticky' || kind === 'text' ? true : undefined, z: kind === 'frame' ? Math.min(0, ...board.items.map(item => item.z)) - 1 : Math.max(0, ...board.items.map(item => item.z)) + 1, color, ...extra }; mutate(() => { board.items.push(item); if (!item.unsorted && !['frame', 'stroke', 'anchor'].includes(kind)) { const target = columnDrop(board, { x: item.x + item.w / 2, y: item.y + item.h / 2 }, new Set([item.id])); if (target) placeInColumn(board, new Set([item.id]), target); } }); selected = new Set([item.id]); tool = 'select'; if (!item.unsorted && ['sticky', 'text', 'shape', 'frame'].includes(kind)) void startText(item.id); if (item.unsorted) { shelf = 'unsorted'; selected = new Set(); } return item; }
    export function addEntity(id: string) { add('entity', { ref: id, autoSize: true }); }
    function editCanvasEntity(item: BoardItem) { const record = service.index.resolve(item.ref || ''); if (record) new DesignEntityModal(service, record, Boolean(board.readOnly || item.locked)).open(); }
    function chooseEntity() { new DesignPicker(service, service.index.all(), item => item.title, item => addEntity(item.id), tr('design_choose_entity')).open(); }
    /** Records not yet placed on any board, to put on the current one. */
    function chooseInbox() { const inbox = service.unplacedEntities(); if (!inbox.length) { service.report(new Error(tr('design_inbox_empty'))); return; } new DesignPicker(service, inbox, item => item.title, item => addEntity(item.id), tr('design_inbox')).open(); }
    function newNestedBoard() { new DesignPrompt(service, tr('design_new_board_label'), '', async name => { const at = pendingAt; pendingAt = undefined; const doc = await service.createBoard(name); if (board.readOnly) return; pendingAt = at; add('board', { ref: doc.board.id, w: 240, h: 200, color: '#8b5cf6' }); }).open(); }
    function chooseBoard() { new DesignPicker(service, service.boards(), doc => doc.board.name, doc => add('board', { ref: doc.board.id, w: 240, h: 200 }), tr('design_choose_board')).open(); }
    /** Writes fields from a card's own controls (checkboxes, table cells, sketch). Refused on read-only and locked items. */
    function patchItem(id: string, values: Partial<BoardItem>) { const target = board.items.find(item => item.id === id); if (!alive || !target || target.locked || board.readOnly) return; session.checkpoint(); Object.assign(target, values); reflowColumns(board); session.touch(); }
    function chooseLink(unsorted = false) { new DesignPrompt(service, tr('design_link_url'), '', async value => { const link = webLink(value); if (!link) throw new Error(tr('design_link_invalid')); const item = add('link', { text: link, title: '', w: 280, h: mediaEmbed(link) ? 300 : 260, unsorted: unsorted || undefined }); if (item) void refreshLink(item.id); }).open(); }
    async function refreshLink(id: string) {
        const item = board.items.find(item => item.id === id && item.kind === 'link' && !item.locked); if (!item || board.readOnly || fetchingLinks.has(id)) return;
        const address = item.text || ''; fetchingLinks = new Set([...fetchingLinks, id]);
        try { const preview = await service.linkPreview(address); const current = session.board.items.find(item => item.id === id); if (alive && current && !current.locked && !session.board.readOnly && current.text === address) patchItem(id, { preview }); }
        catch { /* Offline or protected sites remain ordinary link cards. */ }
        finally { fetchingLinks = new Set([...fetchingLinks].filter(key => key !== id)); }
    }
    function imageEditor(id: string) { const item = board.items.find(item => item.id === id && item.kind === 'image' && !item.locked); if (item && !board.readOnly) new DesignImageModal(service, clone(item), values => patchItem(id, values)).open(); }
    function stashSelection(ids = selected) { finishText(); mutate(() => stashItems(board, ids)); selected = new Set(); shelf = 'unsorted'; }
    function placeShelf(id: string, client?: { x: number; y: number }) { const rect = canvas.getBoundingClientRect(), p = client ? world({ x: client.x - rect.left, y: client.y - rect.top }) : center(); mutate(() => { selected = placeFromShelf(board, id, p); const target = columnDrop(board, p, selected); if (target && !board.items.some(item => selected.has(item.id) && item.kind === 'frame')) placeInColumn(board, selected, target); }); if (compact && selected.size) shelf = undefined; }
    function shelfCreate(kind: 'sticky' | 'link') { if (kind === 'link') chooseLink(true); else new DesignPrompt(service, tr('design_palette_note'), '', async text => { add('sticky', { text, autoSize: true, unsorted: true }); }).open(); }
    function recover(id: string) { const entry = board.trash?.find(entry => entry.id === id), unsorted = entry?.items.some(item => item.unsorted) || entry?.edges.some(edge => edge.unsorted); mutate(() => selected = restoreTrash(board, id)); if (unsorted) shelf = 'unsorted'; }
    function emptyTrash() { if (board.readOnly) return; new DesignConfirm(service, tr('design_empty_trash_confirm'), async () => mutate(() => board.trash = [])).open(); }
    function boardCover(id: string) { new DesignPicker(service, service.plugin.app.vault.getFiles().filter(file => /^(png|jpg|jpeg|webp|gif|svg|avif)$/i.test(file.extension)), file => file.path, file => { if (id === board.id) mutate(() => board.cover = file.path); else void service.setBoardAppearance(id, { cover: file.path }).catch(error => service.report(error)); }, tr('design_board_cover')).open(); }
    function boardIcon(id: string) { const doc = service.resolveBoard(id); new DesignPrompt(service, tr('design_board_icon'), doc?.board.icon || '📋', async icon => { if (id === board.id) mutate(() => board.icon = icon.slice(0, 12)); else await service.setBoardAppearance(id, { icon: icon.slice(0, 12) }); }).open(); }
    function addTodo() { add('todo', { text: `- [ ] ${tr('design_todo_item')}`, w: 260, h: 150 }); }
    function addTable() { add('table', { table: emptyTable(3, 3), w: 420, h: 220 }); }
    export function addWorldView(typeId: string, viewId: string, at?: { x: number; y: number }) { add('world-view', { worldView: { typeId, viewId }, w: 360, h: 300, color: '#8b5cf6' }, at ? { x: at.x - 180, y: at.y - 150 } : undefined); }
    function chooseWorldView() { if (board.readOnly) return;
        // Keep this picker's point through async initialization without leaking it to another tool if canceled.
        const at = pendingAt; pendingAt = undefined;
        void service.initializeWorld().then(() => {
        if (!alive || board.readOnly) return;
        const views = service.world!.datasets.flatMap(dataset => dataset.views.map(view => ({ typeId: dataset.id, view, name: service.settings.types.find(type => type.id === dataset.id)?.name || dataset.id })));
        new DesignPicker(service, views, entry => `${entry.name} · ${entry.view.name}`, entry => addWorldView(entry.typeId, entry.view.id, at), service.plugin.settings.language === 'ru' ? 'Выбрать вид таблицы мира' : 'Choose world table view').open();
    }).catch(error => service.report(error)); }
    function addSketch() { add('sketch', { sketch: [], w: 320, h: 240 }); }
    /** Frames the selection as a column (L5): a tall titled frame. Collapsing it hides what is inside. */
    function makeColumn() { const members = board.items.filter(item => selected.has(item.id) && !item.locked && !['frame', 'anchor', 'stroke'].includes(item.kind)); if (!members.length) return; const box = itemsBounds(members), ids = new Set(members.map(item => item.id)); const column = add('frame', { column: true, columnManaged: true, title: tr('design_column'), x: box.x - 16, y: box.y - 60, w: Math.max(300, ...members.map(item => item.w + 32)), h: 180 }); if (column) mutate(() => placeInColumn(board, ids, { id: column.id, index: 0, x: column.x, y: column.y + 60, w: column.w })); }
    /** Items inside a collapsed column are not drawn. */
    function hiddenIds(current: DesignBoard): Set<string> { const hidden = new Set(current.items.filter(item => item.unsorted).map(item => item.id)); for (const column of current.items.filter(item => item.column && item.collapsed)) for (const child of current.items) if (contained(column, child)) hidden.add(child.id); return hidden; }
    /** Moves dragged objects to another board when they are dropped on its breadcrumb. Links between moved objects go with them. */
    async function moveOut(targetId: string, ids: Set<string>) {
        if (board.readOnly) return;
        const moving = board.items.filter(item => ids.has(item.id) && !item.locked); if (!moving.length) return;
        const movingIds = new Set(moving.map(item => item.id));
        const items = clone(moving).map(item => ({ ...item, unsorted: true })), edges = clone(board.edges.filter(edge => movingIds.has(edge.from) && movingIds.has(edge.to)));
        const snapshot = JSON.stringify({ items: moving, edges: board.edges.filter(edge => movingIds.has(edge.from) && movingIds.has(edge.to)) });
        await onMoveItems(targetId, items, edges);
        const latest = session.board;
        if (!alive || latest.readOnly || snapshot !== JSON.stringify({ items: latest.items.filter(item => movingIds.has(item.id)), edges: latest.edges.filter(edge => movingIds.has(edge.from) && movingIds.has(edge.to)) })) { service.report(new Error(tr('design_transfer_changed'))); return; }
        mutate(() => deleteItems(board, movingIds)); selected = new Set();
    }
    /** Selects an object after its board was opened from search. */
    export function reveal(id: string) { if (board.items.some(item => item.id === id)) selectItem(id); }
    /** Text for one object in a Markdown export: wiki-links for records and boards, embeds for files, Markdown for tasks and tables. */
    function describeItem(item: BoardItem): string {
        if (item.kind === 'entity') { const record = item.ref ? service.index.resolve(item.ref) : undefined; return record ? `[[${record.path.replace(/\.md$/i, '')}|${record.title.replace(/[\]|\r\n]/g, '')}]]` : ''; }
        if (item.kind === 'board') { const doc = service.resolveBoard(item.ref || ''); return doc ? `[[${doc.path}|${doc.board.name.replace(/[\]|\r\n]/g, '')}]]` : title(item); }
        if ((item.kind === 'image' || item.kind === 'file') && item.path) return `![[${item.path}]]`;
        if (item.kind === 'link') return `[${title(item)}](${item.text || ''})`;
        if (item.kind === 'todo') return item.text || '';
        if (item.kind === 'table' && item.table) return tableToMarkdown(item.table);
        if (item.kind === 'world-view' && item.worldView) return worldViewMarkdown(service, item.worldView);
        if (item.kind === 'stroke' || item.kind === 'sketch') return '';
        return item.kind === 'frame' ? item.title || '' : item.text || item.title || '';
    }
    async function exportMarkdown() { await service.writeExport(board.name, 'md', boardToMarkdown(board, describeItem)); }
    /** The sketch card under a point, if any: pen strokes started on it are kept inside it (L11). */
    function sketchUnder(p: [number, number]): BoardItem | undefined { return board.items.filter(item => item.kind === 'sketch' && !hidden.has(item.id) && !item.locked && hitItem(item, { x: p[0], y: p[1] })).sort((a, b) => b.z - a.z)[0]; }
    async function vaultImage(path: string, replace?: string) {
        const at = pendingAt; pendingAt = undefined;
        const size = await imageSize(service.image(path));
        if (!alive || board.readOnly) return;
        if (replace) { const item = board.items.find(item => item.id === replace); if (item) patchItem(replace, { path, h: item.w * size.h / size.w, crop: undefined, imageStrokes: undefined }); }
        else { const scale = Math.min(300 / size.w, 240 / size.h); pendingAt = at; add('image', { path, w: size.w * scale, h: size.h * scale }); }
    }
    function chooseImage() { new DesignPicker(service, service.plugin.app.vault.getFiles().filter(file => /^(png|jpg|jpeg|webp|gif|svg|avif)$/i.test(file.extension)), file => file.path, file => void vaultImage(file.path).catch(error => service.report(error)), tr('design_choose_image')).open(); }
    function fit(onlySelected = false) { const items = onlySelected ? selectionBoard(board, selected).items : board.items.filter(item => !item.unsorted); if (!items.length) return; const box = itemsBounds(items), zoom = Math.max(.08, Math.min(1.5, (width - 100) / Math.max(1, box.w), (height - 100) / Math.max(1, box.h))); board.viewport = { x: width / 2 - (box.x + box.w / 2) * zoom, y: height / 2 - (box.y + box.h / 2) * zoom, zoom }; session.touchViewport(); }
    function remove() { if (board.items.some(item => selected.has(item.id) && !item.locked) || board.edges.some(edge => selected.has(edge.id))) mutate(() => trashItems(board, movingIds(board, selected))); selected = new Set(); menu = false; }
    function removeItem(id: string) { selected = new Set([id]); remove(); }
    function copy() { const graph = selectionBoard(board, selected); designClipboard.value = { board: graph, selected: [...graph.items.map(item => item.id), ...graph.edges.map(edge => edge.id)] }; designClipboard.text = graph.items.filter(item => item.kind !== 'anchor').map(title).join('\n'); }
    function cut() { copy(); if (!board.readOnly) { selected = new Set(designClipboard.value!.selected); remove(); } }
    function paste() { const clip = designClipboard.value; if (clip) mutate(() => selected = new Set(duplicateItems(board, new Set(clip.selected), clip.board))); }
    function duplicate() { mutate(() => selected = new Set(duplicateItems(board, selected))); }
    function layer(front: boolean) { const z = (front ? Math.max : Math.min)(0, ...board.items.map(item => item.z)); mutate(() => board.items.filter(item => selected.has(item.id) && !item.locked).forEach((item, index) => item.z = z + (front ? 1 : -1) * (index + 1))); }
    function prop(key: keyof BoardItem, value: unknown) { if (['w', 'h'].includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) return; mutate(() => { for (const item of board.items.filter(item => selected.has(item.id) && !item.locked)) { Object.assign(item, { [key]: value }); if (key === 'path' && item.kind === 'image') { if (item.crop) item.h *= item.crop.w / item.crop.h; item.crop = undefined; item.imageStrokes = undefined; } if (key === 'text' && item.kind === 'link') item.preview = undefined; if (key === 'column' && value) layoutColumn(board, item); if (key === 'column' && !value) { item.columnManaged = undefined; board.items.filter(child => child.columnId === item.id).forEach(child => { child.columnId = undefined; child.columnOrder = undefined; }); } if (key === 'text' || key === 'title') item.richText = undefined; } }); }
    function edgeProp(key: keyof BoardEdge, value: unknown) { mutate(() => { if (selectedEdge) Object.assign(selectedEdge, { [key]: value === '' && key.endsWith('Side') ? undefined : value }); }); }
    function edgePoints(edge: BoardEdge) { return pointsForEdge(edge, itemById); }
    function edgePath(edge: BoardEdge) { return pathForEdge(edge, itemById); }
    function nearestSide(item: BoardItem, p: { x: number; y: number }): BoardEdge['fromSide'] { return ([['left', Math.abs(p.x - item.x)], ['right', Math.abs(p.x - item.x - item.w)], ['top', Math.abs(p.y - item.y)], ['bottom', Math.abs(p.y - item.y - item.h)]] as [BoardEdge['fromSide'], number][]).sort((a, b) => a[1] - b[1])[0]![0]; }
    function connect(id: string) { if (!source) { source = id; selected = new Set([id]); } else if (source !== id) { mutate(() => board.edges.push({ id: uid(), from: source, to: id, style: 'straight', label: '', arrow: 'end' })); source = ''; selected = new Set(); } }
    /** Connection handles: one per corner of a hovered, unselected object. Reads the board passed in so the reactive statement stays fresh. */
    function handlesFor(id: string, current: DesignBoard): { corner: Corner; x: number; y: number }[] { const item = current.items.find(candidate => candidate.id === id); return item && item.kind !== 'anchor' && item.kind !== 'stroke' ? CORNERS.map(corner => ({ corner, ...cornerPoint(item, corner) })) : []; }
    /** Tracks the object under a button-free pointer so its corner handles can appear. */
    function hover(event: PointerEvent) { if (drag || pointers.size) return; const element = (event.target as Element).closest?.('[data-item],[data-connect]'); const id = element?.getAttribute('data-connect') || element?.getAttribute('data-item') || ''; if (id !== hoverItem) hoverItem = id; }
    function itemAt(p: { x: number; y: number }) { return [...board.items].sort((a, b) => b.z - a.z).find(item => item.kind !== 'anchor' && item.kind !== 'stroke' && !hidden.has(item.id) && hitItem(item, p)); }
    /** The object at the opposite end of a link; Shift straightening measures from its center. */
    function otherEnd(edgeId: string, side?: string): BoardItem | undefined { const edge = board.edges.find(edge => edge.id === edgeId); return edge ? board.items.find(item => item.id === (side === 'from' ? edge.to : edge.from)) : undefined; }
    function anchorAt(p: { x: number; y: number }, constrain = false, start?: BoardItem): string { const at = constrain ? straightPoint(start, p) : p; const id = uid(); board.items.push({ id, kind: 'anchor', x: at.x - .5, y: at.y - .5, w: 1, h: 1, z: -1 }); return id; }
    function focusText(item: BoardItem) { const zoom = Math.max(board.viewport.zoom, Math.min(1.25, (width - 32) / item.w)); board.viewport = { zoom, x: width / 2 - (item.x + item.w / 2) * zoom, y: Math.max(16, (height - 76 - item.h * zoom) / 2) - item.y * zoom }; session.touchViewport(); }
    async function startText(id: string) { const item = board.items.find(item => item.id === id); if (!item || item.locked || board.readOnly || !['sticky', 'text', 'shape', 'frame'].includes(item.kind)) return; if (editingText !== id) { session.checkpoint(); textRange = undefined; selectionFormat = undefined; } if (compact) focusText(item); menu = false; shelf = undefined; editingText = id; selected = new Set([id]); await tick(); }
    function finishText() { if (editingText) { editingText = ''; canvas?.focus(); } editingLabel = undefined; textRange = undefined; selectionFormat = undefined; }
    /** The editable node of the text being edited, if one is open. */
    function editorNode(): HTMLElement | null { return canvas?.querySelector<HTMLElement>('.design-editing-text') ?? null; }
    /** Saves the selection when it is inside the text being edited, so the palette can format it after it takes focus. */
    function rememberText() {
        const editor = editorNode(), selection = window.getSelection();
        if (!editor || !selection?.rangeCount || !validTextRange(editor, selection.getRangeAt(0))) return;
        // Native color/number controls take focus before their focus event. Capture a fresh selection,
        // but keep the wrapped range when the browser collapses its old range during formatting.
        if (document.activeElement !== editor && selection.isCollapsed && validTextRange(editor, textRange) && !textRange.collapsed) return;
        textRange = selection.getRangeAt(0).cloneRange(); selectionFormat = textFormat(editor, textRange);
        formatting = { bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), underline: document.queryCommandState('underline'), strike: document.queryCommandState('strikeThrough'), bullets: document.queryCommandState('insertUnorderedList'), numbers: document.queryCommandState('insertOrderedList') };
    }
    function restoreText() { const editor = editorNode(); if (!editor || !validTextRange(editor, textRange)) return; const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(textRange); }
    /** Runs a formatting command on the saved selection. The `input` event saves the change the same way typing does. */
    function formatText(name: string, value?: string) {
        if (name === 'foreColor') { if (value && /^#[\da-f]{6}$/i.test(value)) applyTextStyle('color', value); return; }
        const editor = editorNode(); if (!alive || !editor || board.readOnly || editedItem?.locked) return;
        rememberText(); editor.focus({ preventScroll: true }); restoreText(); document.execCommand(name, false, value);
        rememberText(); editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    /** Without a text selection, color and size apply to the entire card and future typing. */
    function applyTextStyle(property: 'color' | 'fontSize', value: string) {
        const editor = editorNode(), item = board.items.find(candidate => candidate.id === editingText);
        if (!alive || !editor || !item || item.locked || board.readOnly) return;
        rememberText();
        if (validTextRange(editor, textRange) && !textRange.collapsed && textRange.toString()) {
            textRange = styleTextRange(textRange, property, value);
            if (document.activeElement === editor) restoreText();
        } else {
            applyCardTextStyle(editor, property, value);
            item.textStyle = { ...item.textStyle, [property]: property === 'fontSize' ? parseFloat(value) : value };
        }
        selectionFormat = textFormat(editor, textRange);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function applyTextSize(value: string) { const size = Number(value); if (Number.isFinite(size) && size >= 6 && size <= 200) applyTextStyle('fontSize', size + 'px'); }
    function linkText() { rememberText(); new DesignPrompt(service, tr('design_link'), '', async value => { const href = safeLink(value); if (href) formatText('createLink', href); }).open(); }
    /** Column without a selection: an empty tall frame in the middle of the view. With a selection it frames the selection. */
    function addColumn() { if (selected.size && !pendingAt) makeColumn(); else add('frame', { column: true, columnManaged: true, title: tr('design_column'), w: 300, h: 420 }); }
    /** Palette items that create an object when dropped on the board. Tools (Select, Pen…) only switch the tool, so they are not droppable. */
    const DROPPABLE = new Set(['sticky', 'text', 'shape', 'frame', 'edge', 'link', 'todo', 'table', 'world-view', 'sketch', 'column', 'board', 'board-link', 'record', 'new-record', 'inbox', 'image', 'file', 'icons']);
    /** Items whose object is chosen afterwards (a picker or a prompt): the drop point waits for that choice. */
    const WAITS = new Set(['link', 'board', 'board-link', 'record', 'new-record', 'inbox', 'image', 'file', 'icons']);
    const paletteOrder = ['select', 'hand', 'sticky', 'link', 'todo', 'board', 'column', 'image', 'text', 'sketch', 'table', 'world-view', 'record', 'new-record', 'board-link', 'inbox', 'file', 'shape', 'edge', 'frame', 'icons', 'paste', 'pen', 'marker', 'highlighter', 'eraser', 'unsorted', 'trash'];
    $: paletteObjects = [...objectItems].sort((a, b) => paletteOrder.indexOf(a.id) - paletteOrder.indexOf(b.id)).map(item => ({ ...item, divider: ['sticky', 'text', 'record', 'shape', 'pen', 'unsorted'].includes(item.id), disabled: board.readOnly && !['select', 'hand', 'unsorted', 'trash'].includes(item.id), run: compact && ['sticky', 'text'].includes(item.id) ? () => createFromPalette(item.id, center()) : item.run, drop: DROPPABLE.has(item.id) ? dropAt(item.id) : undefined }));
    /** Creates the object a palette item stands for, at the point where it was dropped. */
    function createFromPalette(id: string, at: { x: number; y: number }) {
        if (board.readOnly) return;
        pendingAt = at;
        if (id === 'sticky') add('sticky', { text: compact ? '' : tr('design_text') });
        else if (id === 'text') add('text', { text: compact ? '' : tr('design_text') });
        else if (id === 'shape') add('shape', { shape });
        else if (id === 'frame') add('frame', { title: tr('design_frame') });
        else if (id === 'edge') addLine(at);
        else if (id === 'link') chooseLink();
        else if (id === 'todo') addTodo();
        else if (id === 'table') addTable();
        else if (id === 'world-view') chooseWorldView();
        else if (id === 'sketch') addSketch();
        else if (id === 'column') addColumn();
        else if (id === 'board') newNestedBoard();
        else if (id === 'board-link') chooseBoard();
        else if (id === 'record') chooseEntity();
        else if (id === 'new-record') onNewEntity();
        else if (id === 'inbox') chooseInbox();
        else if (id === 'image') chooseImage();
        else if (id === 'file') chooseFile();
        else if (id === 'icons') iconLibrary();
        if (!WAITS.has(id)) pendingAt = undefined;
    }
    /** The palette reports screen coordinates; the board places the object in its own coordinates. */
    function dropAt(id: string) { return (clientX: number, clientY: number) => { const rect = canvas.getBoundingClientRect(); createFromPalette(id, world({ x: clientX - rect.left, y: clientY - rect.top })); }; }
    /** A free line (Milanote-style): two invisible anchors joined by an edge, so its ends can be dragged like any other line. */
    function addLine(at: { x: number; y: number }) { if (board.readOnly) return; const id = uid(); mutate(() => { const from = anchorAt(at), to = anchorAt({ x: at.x + 160, y: at.y }); board.edges.push({ id, from, to, style: 'straight', label: '', arrow: 'none' }); }); selected = new Set([id]); tool = 'select'; }
    function changeText(id: string, html: string, text: string) { const item = board.items.find(item => item.id === id); if (!item || item.locked || board.readOnly) return; item.richText = sanitizeRichText(html); if (item.kind === 'frame') item.title = text; else item.text = text; session.touch(); }
    function selectItem(id: string) { selected = expandSelection(board, new Set([id])); const item = board.items.find(item => item.id === id); if (item) { if (item.unsorted) shelf = 'unsorted'; board.viewport.x = width / 2 - (item.x + item.w / 2) * board.viewport.zoom; board.viewport.y = height / 2 - (item.y + item.h / 2) * board.viewport.zoom; session.touchViewport(); } }
    /** Enters the first object inside the selected frame. Returns false when there is nothing to enter. */
    function enterFrame(): boolean { const frame = selectedItem; if (frame?.kind !== 'frame') return false; const child = board.items.find(item => item.kind !== 'anchor' && item.id !== frame.id && contained(frame, item)); if (!child) return false; selectItem(child.id); return true; }
    /** Leaves the selected object for the smallest frame that contains it. Returns false when no frame contains it. */
    function exitFrame(): boolean { const item = selectedItem; if (!item) return false; const parent = board.items.filter(other => other.kind === 'frame' && other.id !== item.id && contained(other, item)).sort((a, b) => a.w * a.h - b.w * b.h)[0]; if (!parent) return false; selectItem(parent.id); return true; }
    /** Ctrl+Enter: a new object of the same kind placed to the right of the selected one, opened for typing. */
    function createNext() { const source = selectedItem; if (!source) { add('sticky', { text: tr('design_text') }); return; } const kind: BoardItem['kind'] = ['sticky', 'text', 'shape', 'frame'].includes(source.kind) ? source.kind : 'sticky'; add(kind, { w: source.w, h: source.h, color: source.color || color, shape: source.shape, text: kind === 'frame' ? '' : tr('design_text'), title: kind === 'frame' ? tr('design_frame') : '' }, { x: source.x + source.w + 24, y: source.y }); }
    function present(index: number) { if (!frames.length) return; presentation = (index + frames.length) % frames.length; selected = new Set([frames[presentation]!.id]); fit(true); }
    function chooseFile() { new DesignPicker(service, service.plugin.app.vault.getFiles(), file => file.path, file => add('file', { path: file.path }), tr('design_file')).open(); }
    function insertTemplate() { new DesignPicker(service, ['mechanic', 'story'], name => tr(name === 'mechanic' ? 'design_mechanic_template' : 'design_story_template'), name => { const p = center(); const items = templateItems(name, p.x - 425, p.y - 180); items[0]!.title = tr(name === 'mechanic' ? 'design_type_mechanic' : 'design_type_story'); const keys: TranslationKey[] = name === 'mechanic' ? ['design_trigger', 'design_rules', 'design_value'] : ['design_type_character', 'design_goal', 'design_description']; items.slice(1).forEach((item, i) => item.text = tr(keys[i]!)); mutate(() => board.items.push(...items)); selected = new Set(items.map(item => item.id)); }, tr('design_template')).open(); }
    function iconLibrary() { new DesignPicker(service, ['🧠', '💡', '⭐', '❤️', '⚙️', '🎯', '📍', '🏠', '⚔️', '🪙', '⛏️', '🌲', '→', '✓', '☀', '☁', '⚠', '♟', '⌂', '✉', ...getIconIds()], value => value, text => { const svg = getIcon(text); if (!svg) { add('text', { text, textStyle: { fontSize: 48 }, w: 100, h: 90 }); return; } svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', '120'); svg.setAttribute('height', '120'); svg.setAttribute('stroke', '#172b4d'); void service.importAsset(new File([svg.outerHTML], `${text}.svg`, { type: 'image/svg+xml' })).then(path => add('image', { path, w: 120, h: 120 })).catch(error => service.report(error)); }, tr('design_icons')).open(); }
    function normalLabels(edge: BoardEdge) { return edge.labels ??= clone(edgeLabels(edge)); }
    function editEdgeLabel(edge: BoardEdge, id?: string) { if (board.readOnly) return; if (!id) { mutate(() => { const labels = normalLabels(edge); labels.push({ id: uid(), text: '', t: labels.length ? .5 + .4 * labels.length / (labels.length + 1) : .5 }); }); id = edge.labels![edge.labels!.length - 1]!.id; } else session.checkpoint(); editingLabel = { edge: edge.id, label: id }; selected = new Set([edge.id]); }
    function labelInput(node: HTMLInputElement) { requestAnimationFrame(() => { node.focus(); node.select(); }); }
    function action(name: string, value?: unknown) {
        if (['rotation', 'opacity', 'strokeWidth', 'edgeWidth', 'textSize'].includes(name)) { const number = Number(value); if (!Number.isFinite(number)) return; value = name === 'rotation' ? number : Math.max(name === 'textSize' ? 6 : name === 'edgeWidth' ? 1 : 0, Math.min(name === 'opacity' ? 1 : name === 'textSize' ? 200 : 100, number)); }
        if (name === 'edit' && selectedItem) { void startText(selectedItem.id); return; }
        if (name === 'imageEdit' && selectedItem) { imageEditor(selectedItem.id); return; }
        if (name === 'stash') { stashSelection(); return; }
        if (name === 'refreshLink' && selectedItem) { void refreshLink(selectedItem.id); return; }
        if (name === 'boardCover' && selectedItem?.ref) { boardCover(selectedItem.ref); return; }
        if (name === 'boardIcon' && selectedItem?.ref) { boardIcon(selectedItem.ref); return; }
        if (name === 'cut') { cut(); return; }
        if (name === 'styleCopy') { if (selectedItem) designClipboard.style = styleOf(selectedItem); return; }
        if (name === 'replaceImage') { new DesignPicker(service, service.plugin.app.vault.getFiles().filter(file => /^(png|jpg|jpeg|webp|gif|svg|avif)$/i.test(file.extension)), file => file.path, file => { if (selectedItem) void vaultImage(file.path, selectedItem.id).catch(error => service.report(error)); }, tr('design_replace_image')).open(); return; }
        if (name === 'label' && selectedEdge) { editEdgeLabel(selectedEdge); return; }
        mutate(() => {
            const items = board.items.filter(item => selected.has(item.id) && !item.locked);
            if (name === 'group' || name === 'ungroup') groupItems(board, selected, name === 'ungroup');
            else if (name === 'lock') { const lock = board.items.some(item => selected.has(item.id) && !item.locked); board.items.filter(item => selected.has(item.id)).forEach(item => item.locked = lock); }
            else if (name === 'align') alignItems(board, selected, value as Parameters<typeof alignItems>[2]);
            else if (name === 'stylePaste' && designClipboard.style) items.forEach(item => { Object.assign(item, clone(designClipboard.style!)); if (item.richText) for (const property of ['color', 'fontSize', 'textAlign'] as TextProperty[]) item.richText = clearHtmlProperty(item.richText, property, property === 'fontSize' ? (item.textStyle?.fontSize || 18) + 'px' : undefined); });
            else if (name === 'step') { const order = [...board.items].sort((a, b) => a.z - b.z); const moving = Number(value) > 0 ? [...order].reverse() : order; for (const item of moving.filter(item => selected.has(item.id) && !item.locked)) { const index = order.indexOf(item), next = index + Number(value); if (next >= 0 && next < order.length && !selected.has(order[next]!.id)) [order[index], order[next]] = [order[next]!, item]; } order.forEach((item, index) => item.z = index); }
            else if (name === 'clear') items.forEach(item => { item.text = ''; item.title = ''; item.richText = ''; });
            else if (['textSize', 'textColor', 'textAlign'].includes(name)) {
                if (name === 'textSize' && (!Number.isFinite(Number(value)) || Number(value) < 6 || Number(value) > 200)) return;
                const property: TextProperty = name === 'textSize' ? 'fontSize' : name === 'textColor' ? 'color' : 'textAlign';
                items.forEach(item => { item.textStyle = { ...item.textStyle, [property === 'textAlign' ? 'align' : property]: value }; if (item.richText) item.richText = clearHtmlProperty(item.richText, property, property === 'fontSize' ? (item.textStyle?.fontSize || 18) + 'px' : undefined); });
            }
            else if (name === 'autoSize') items.forEach(item => item.autoSize = !item.autoSize);
            else if (name === 'crop') { const input = value as { key: 'x' | 'y' | 'w' | 'h'; value: number }; for (const item of items) { const crop = { x: 0, y: 0, w: 1, h: 1, ...item.crop }; crop[input.key] = Math.max(input.key === 'w' || input.key === 'h' ? .05 : 0, Math.min(1, input.value)); crop.w = Math.min(crop.w, 1 - crop.x); crop.h = Math.min(crop.h, 1 - crop.y); if (crop.w > 0 && crop.h > 0) { const old = item.crop || { w: 1, h: 1 }; item.h *= crop.h / crop.w * old.w / old.h; item.crop = crop; } } }
            else if (name === 'resetCrop') items.forEach(item => { if (item.crop) item.h *= item.crop.w / item.crop.h; item.crop = undefined; });
            else if (['rotation', 'opacity', 'strokeColor', 'strokeWidth', 'strokeDash'].includes(name)) items.forEach(item => Object.assign(item, { [name]: value }));
            else if (selectedEdge) { if (name === 'edgeColor') selectedEdge.color = String(value); if (name === 'edgeWidth') selectedEdge.width = Math.max(1, Math.min(100, Number(value))); if (name === 'edgeDash') selectedEdge.dash = value as BoardEdge['dash']; if (name === 'clearBends') selectedEdge.bends = undefined; if (name === 'bend') { const p = edgePoints(selectedEdge); (selectedEdge.bends ??= []).push([(p.a.x + p.b.x) / 2, (p.a.y + p.b.y) / 2]); } if (name === 'labelText') { const input = value as { id: string; text: string }; const label = normalLabels(selectedEdge).find(label => label.id === input.id); if (label) label.text = input.text; } if (name === 'labelDelete') selectedEdge.labels = normalLabels(selectedEdge).filter(label => label.id !== value); }
        });
    }
    function clipboardCopy(event: ClipboardEvent, cutting = false) { if ((event.target as Element).closest('[contenteditable="true"],input,textarea,[data-canvas-interactive],.world-cell')) return; clearTimeout(copyFallback); event.preventDefault(); event.stopPropagation(); copy(); event.clipboardData?.setData('application/x-world-design', JSON.stringify(designClipboard.value)); event.clipboardData?.setData('text/plain', designClipboard.text || ''); if (cutting) cut(); }
    async function clipboardPaste(event: ClipboardEvent) {
        clearTimeout(clipboardFallback);
        if ((event.target as Element).closest('input,textarea,select,.world-cell,[data-canvas-interactive],[contenteditable="true"]')) return;
        event.preventDefault(); event.stopPropagation(); if (board.readOnly) return;
        const data = event.clipboardData; if (!data) return;
        const internal = data.getData('application/x-world-design');
        if (internal) { try { const clip = JSON.parse(internal); const source = (await import('../board')).parseBoard(JSON.stringify(clip.board)); if (Array.isArray(clip.selected) && clip.selected.every((id: unknown) => typeof id === 'string')) mutate(() => selected = new Set(duplicateItems(board, new Set(clip.selected), source))); } catch (error) { service.report(error); } return; }
        const files = Array.from(data.files); if (files.length) { await importFiles(files); return; }
        const html = data.getData('text/html'), text = data.getData('text/plain');
        if (text === designClipboard.text && designClipboard.value && designClipboard.value.selected.length) { paste(); return; }
        pasteExternal(html, text);
    }
    function pasteExternal(html: string, text: string) { if (text && !html && webLink(text) && !/\s/.test(text.trim())) { const item = add('link', { text: webLink(text), w: 280, h: 260 }); if (item) void refreshLink(item.id); } else if (html || text) add('text', { text: html ? richPlainText(html) : text, richText: html ? sanitizeRichText(html) : plainHtml(text), autoSize: true }); else paste(); }
    async function pasteOs(fallback = false) { if (board.readOnly) return; try { const values = await navigator.clipboard.read(), files: File[] = []; let html = '', text = ''; for (const value of values) { const image = value.types.find(type => type.startsWith('image/')); if (image) { const blob = await value.getType(image); files.push(new File([blob], `clipboard.${image.split('/')[1]!.replace('jpeg', 'jpg')}`, { type: image })); } else { if (value.types.includes('text/html')) html = await (await value.getType('text/html')).text(); if (value.types.includes('text/plain')) text = await (await value.getType('text/plain')).text(); } } if (files.length) await importFiles(files); else if (fallback && text === designClipboard.text && designClipboard.value) paste(); else if (html || text) pasteExternal(html, text); else if (fallback) paste(); } catch (error) { if (fallback && designClipboard.value) paste(); else service.report(error); } }
    async function importFiles(files: File[], position?: { x: number; y: number }, unsorted = false) { if (board.readOnly) return; const c = pendingAt || center(); pendingAt = undefined; for (let i = 0; i < files.length; i++) { if (!alive || board.readOnly) return; const file = files[i]!, path = await service.importAsset(file), image = /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(path); let w = 300, h = 220; if (image) { const url = URL.createObjectURL(file); try { const size = await imageSize(url); const scale = Math.min(300 / size.w, 240 / size.h); w = Math.max(1, size.w * scale); h = Math.max(1, size.h * scale); } finally { URL.revokeObjectURL(url); } } add(image ? 'image' : 'file', { path, w, h, unsorted: unsorted || undefined }, { x: (position?.x ?? c.x - w / 2) + i * 30, y: (position?.y ?? c.y - h / 2) + i * 30 }); } }
    function down(event: PointerEvent) {
        if (event.button > 1) return;
        if ((event.target as Element).closest('input,textarea,select,button,video,audio,iframe,[data-canvas-interactive],[contenteditable="true"]')) return;
        if (presentation >= 0) return;
        finishText();
        // touch-action:none handles touch scrolling; canceling touch pointerdown can suppress later button clicks in Chromium.
        if (event.pointerType !== 'touch') event.preventDefault();
        canvas.focus(); const p = point(event); pointers.set(event.pointerId, p); canvas.setPointerCapture(event.pointerId);
        if (pointers.size >= 2) { if (pointers.size > 2) return; clearTimeout(longPress); if (drag?.moved && !['pan', 'marquee'].includes(drag.mode)) { session.board = clone(drag.base); session.touch(); } drag = undefined; selectionBox = undefined; stroke = []; guides = {}; const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]; gesture = { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), view: clone(session.board.viewport) }; return; }
        const target = event.target as Element, itemId = target.closest('[data-item]')?.getAttribute('data-item') || '', edgeId = target.closest('[data-edge]')?.getAttribute('data-edge') || '', item = board.items.find(item => item.id === itemId);
        const panOnly = board.readOnly || space || event.button === 1 || tool === 'hand' || (event.pointerType === 'touch' && tool === 'select' && !item && !edgeId && !multiSelect);
        const base = panOnly ? { ...board, viewport: clone(board.viewport) } : clone(board), selectedBefore = new Set(selected); const w = world(p);
        // Read-only boards only pan, zoom and select: no drags, no drawing, no tool actions.
        if (board.readOnly) { selected = item ? expandSelection(board, new Set([item.id])) : new Set(); drag = { mode: 'pan', start: p, view: clone(board.viewport), positions: new Map(), moved: false, base }; return; }
        if (space || event.button === 1 || tool === 'hand') { drag = { mode: 'pan', start: p, view: clone(board.viewport), positions: new Map(), moved: false, base }; return; }
        if (tool === 'edge') { if (item) connect(item.id); else { session.checkpoint(); const id = anchorAt(w, event.shiftKey, board.items.find(item => item.id === source)); session.touch(); connect(id); } return; }
        if (tool === 'eraser') { session.checkpoint(); if (partialEraser) { if (erasePartial(board, w.x, w.y, penWidth * 3)) session.touch(); } else if (item?.kind === 'stroke' && !item.locked) { trashItems(board, new Set([item.id])); session.touch(); } drag = { mode: 'erase', start: w, view: clone(board.viewport), positions: new Map(), moved: false, base }; return; }
        if (['pen', 'marker', 'highlighter'].includes(tool)) { stroke = [[w.x, w.y]]; drag = { mode: 'pen', side: tool, start: w, view: clone(board.viewport), positions: new Map(), moved: false, base }; return; }
        if (['sticky', 'shape', 'text', 'frame'].includes(tool)) { add(tool as BoardItem['kind'], { text: tool === 'sticky' || tool === 'text' ? tr('design_text') : '', title: tool === 'frame' ? tr('design_frame') : '', shape }, w); return; }
        const bend = target.closest('[data-bend]'), label = target.closest('[data-label]');
        if (bend) { drag = { mode: 'bend', start: w, view: clone(board.viewport), positions: new Map(), item: edgeId, side: bend.getAttribute('data-bend')!, moved: false, base }; return; }
        if (label) { drag = { mode: 'label', start: w, view: clone(board.viewport), positions: new Map(), item: edgeId, side: label.getAttribute('data-label')!, moved: false, base }; selected = new Set([edgeId]); return; }
        const endpoint = target.closest('[data-endpoint]');
        if (endpoint) { drag = { mode: 'endpoint', start: w, view: clone(board.viewport), positions: new Map(), item: endpoint.getAttribute('data-endpoint')!, side: endpoint.getAttribute('data-side')!, moved: false, base }; return; }
        const connector = target.closest('[data-connect]');
        if (connector) { drag = { mode: 'connect', start: w, view: clone(board.viewport), positions: new Map(), item: connector.getAttribute('data-connect')!, side: connector.getAttribute('data-corner') || undefined, moved: false, base }; return; }
        if (edgeId) { selected = new Set([edgeId]); if (!compact) menu = true; return; }
        if (item) {
            const unit = expandSelection(board, new Set([item.id]));
            if (!target.closest('[data-resize],[data-rotate]') && (multiSelect || event.shiftKey || event.ctrlKey || event.metaKey)) { const next = new Set(selected), remove = next.has(item.id); for (const id of unit) if (remove) next.delete(id); else next.add(id); selected = next; }
            else if (!selected.has(item.id)) selected = unit;
            if (!selected.has(item.id)) return;
            if (item.locked) return;
            if (event.altKey) { session.checkpoint(); selected = new Set(duplicateItems(board, selected, board, { x: 0, y: 0 })); session.touch(); }
            for (const column of board.items.filter(candidate => candidate.column && !candidate.columnManaged)) if (!item.column && contained(column, item)) manageColumn(board, column);
            const moving = movingIds(board, selected);
            const resize = target.closest('[data-resize]');
            drag = { mode: target.closest('[data-rotate]') ? 'rotate' : resize ? 'resize' : 'move', start: w, view: clone(board.viewport), positions: new Map(board.items.filter(item => moving.has(item.id) && !item.locked).map(item => [item.id, clone(item)])), item: event.altKey ? [...selected][0] : item.id, side: resize?.getAttribute('data-resize') || undefined, moved: false, base };
            if (event.pointerType === 'touch') longPress = setTimeout(() => { selected = new Set([...selectedBefore, item.id]); menu = true; drag = undefined; }, 550);
        } else { if (!event.shiftKey && !multiSelect) selected = new Set(); menu = false; const pan = event.pointerType === 'touch' && !multiSelect; selectionBox = pan ? undefined : { x: w.x, y: w.y, w: 0, h: 0 }; drag = { mode: pan ? 'pan' : 'marquee', start: pan ? p : w, view: clone(board.viewport), positions: new Map(), moved: false, base, selection: new Set(selected) }; }
    }
    function move(event: PointerEvent) {
        if (!pointers.has(event.pointerId)) { hover(event); return; } const p = point(event); pointers.set(event.pointerId, p);
        if (gesture && pointers.size >= 2) { const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]; const view = zoomAt(gesture.view, gesture.view.zoom * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, gesture.center.x, gesture.center.y); board.viewport = { ...view, x: view.x + (a.x + b.x) / 2 - gesture.center.x, y: view.y + (a.y + b.y) / 2 - gesture.center.y }; session.touchViewport(); return; }
        if (!drag) return; const w = world(p); let dx = w.x - drag.start.x, dy = w.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) * board.viewport.zoom < 3 && drag.mode !== 'pan') return;
        clearTimeout(longPress);
        if (!drag.moved && ['move', 'resize', 'rotate', 'endpoint', 'label', 'bend'].includes(drag.mode)) session.checkpoint(); drag.moved = true;
        if (drag.mode === 'pan') { board.viewport = { ...drag.view, x: drag.view.x + p.x - drag.start.x, y: drag.view.y + p.y - drag.start.y }; session.touchViewport(); }
        else if (drag.mode === 'pen') { stroke = [...stroke, [w.x, w.y]]; }
        else if (drag.mode === 'endpoint') { endpointPreview = event.shiftKey && !itemAt(w) ? straightPoint(otherEnd(drag.item || '', drag.side), w) : w; }
        else if (drag.mode === 'connect') { const source = itemById.get(drag.item || ''); connectPreview = source ? { from: cornerPoint(source, (drag.side || 'se') as Corner), to: w } : undefined; }
        else if (drag.mode === 'label') { const edge = board.edges.find(edge => edge.id === drag!.item)!; const label = normalLabels(edge).find(label => label.id === drag!.side)!; let nearest = { t: 0, distance: Infinity, x: 0, y: 0 }; for (let t = 0; t <= 1; t += .02) { const point = labelPoint(edge, { id: label.id, text: label.text, t }, itemById); const distance = Math.hypot(w.x - point.x, w.y - point.y); if (distance < nearest.distance) nearest = { t, distance, ...point }; } label.t = Math.max(0, Math.min(1, nearest.t)); label.x = undefined; label.y = undefined; label.offsetX = w.x - nearest.x; label.offsetY = w.y - nearest.y; session.touch(); }
        else if (drag.mode === 'bend') { const edge = board.edges.find(edge => edge.id === drag!.item)!; edge.bends![Number(drag.side)] = [w.x, w.y]; session.touch(); }
        else if (drag.mode === 'erase') { if (partialEraser) { if (erasePartial(board, w.x, w.y, penWidth * 3)) session.touch(); } else { const item = board.items.find(item => item.kind === 'stroke' && !item.locked && w.x >= item.x && w.x <= item.x + item.w && w.y >= item.y && w.y <= item.y + item.h); if (item) { trashItems(board, new Set([item.id])); session.touch(); } } }
        else if (drag.mode === 'marquee') { selectionBox = { x: Math.min(w.x, drag.start.x), y: Math.min(w.y, drag.start.y), w: Math.abs(dx), h: Math.abs(dy) }; selected = expandSelection(board, new Set([...(drag.selection || []), ...board.items.filter(item => !hidden.has(item.id) && item.x >= selectionBox!.x && item.y >= selectionBox!.y && item.x + item.w <= selectionBox!.x + selectionBox!.w && item.y + item.h <= selectionBox!.y + selectionBox!.h).map(item => item.id)])); }
        else {
            guides = {};
            const origin = drag.positions.get(drag.item || '');
            if (drag.mode === 'move' && board.snap && origin) { dx = Math.round((origin.x + dx) / 20) * 20 - origin.x; dy = Math.round((origin.y + dy) / 20) * 20 - origin.y; }
            for (const item of board.items.filter(item => drag!.positions.has(item.id))) {
                const initial = drag.positions.get(item.id)!;
                if (drag.mode === 'resize' && item.id === drag.item) { Object.assign(item, resizeItem(initial, drag.side || 'se', dx, dy, event.shiftKey)); if (initial.autoSize && /[ns]/.test(drag.side || 'se')) item.autoSize = false; if (item.kind === 'stroke') item.points = initial.points?.map(([x, y]) => [x * item.w / initial.w, y * item.h / initial.h]); }
                else if (drag.mode === 'rotate' && item.id === drag.item) { const cx = initial.x + initial.w / 2, cy = initial.y + initial.h / 2, delta = (Math.atan2(w.y - cy, w.x - cx) - Math.atan2(drag.start.y - cy, drag.start.x - cx)) * 180 / Math.PI; item.rotation = (initial.rotation || 0) + delta; if (event.shiftKey) item.rotation = Math.round(item.rotation / 15) * 15; }
                else if (drag.mode === 'move') { item.x = initial.x + dx; item.y = initial.y + dy;
                    if (item.id === drag.item) for (const other of board.items.filter(other => !drag!.positions.has(other.id))) { if (Math.abs(item.x - other.x) * board.viewport.zoom < 5) guides.x = other.x; if (Math.abs(item.y - other.y) * board.viewport.zoom < 5) guides.y = other.y; }
                }
            }
            if (drag.mode === 'move' && drag.positions.size) { const moving = board.items.filter(item => drag!.positions.has(item.id)), box = itemsBounds(moving); for (const other of board.items.filter(item => !drag!.positions.has(item.id))) { for (const [a, b] of [[box.x, other.x], [box.x + box.w / 2, other.x + other.w / 2], [box.x + box.w, other.x + other.w]]) if (Math.abs(a! - b!) * board.viewport.zoom < 5) guides.x = b; for (const [a, b] of [[box.y, other.y], [box.y + box.h / 2, other.y + other.h / 2], [box.y + box.h, other.y + other.h]]) if (Math.abs(a! - b!) * board.viewport.zoom < 5) guides.y = b; } }
            if (drag.mode === 'move') { previewColumn(board, drag); const movable = [...drag.positions.values()].every(item => !['frame', 'anchor', 'stroke'].includes(item.kind)); insertion = movable ? columnDrop(board, w, new Set(drag.positions.keys())) : undefined; }
            followConnections(drag.base, board); session.touch();
        }
    }
    function up(event: PointerEvent) {
        if (!pointers.has(event.pointerId)) return;
        const wasGesture = Boolean(gesture); pointers.delete(event.pointerId); clearTimeout(longPress);
        if (wasGesture) { if (pointers.size < 2) { gesture = undefined; const remaining = [...pointers.values()][0]; drag = remaining ? { mode: 'pan', start: remaining, view: clone(board.viewport), positions: new Map(), moved: false, base: { ...board, viewport: clone(board.viewport) } } : undefined; } return; }
        const action = drag; drag = undefined; selectionBox = undefined; guides = {}; endpointPreview = undefined; connectPreview = undefined;
        // A pen stroke started on a sketch card is kept inside that card, in its local coordinates.
        const drawnOn = action?.mode === 'pen' && stroke.length ? sketchUnder(stroke[0]!) : undefined;
        if (drawnOn) { const host = drawnOn, local = stroke.map(([px, py]) => { const p = itemLocalPoint(host, { x: px, y: py }); return [p.x, p.y] as [number, number]; }), side = action?.side; mutate(() => { host.sketch = [...(host.sketch || []), { points: local, width: side === 'pen' ? penWidth : Math.max(8, penWidth * 3), color, opacity: side === 'highlighter' ? .3 : side === 'marker' ? .6 : 1 }]; }); tool = side || 'pen'; stroke = []; }
        if (action?.mode === 'pen' && stroke.length) { const left = Math.min(...stroke.map(p => p[0])), top = Math.min(...stroke.map(p => p[1])); add('stroke', { points: stroke.map(p => [p[0] - left, p[1] - top]), width: action.side === 'pen' ? penWidth : Math.max(8, penWidth * 3), opacity: action.side === 'highlighter' ? .3 : action.side === 'marker' ? .6 : 1, w: Math.max(1, Math.max(...stroke.map(p => p[0])) - left), h: Math.max(1, Math.max(...stroke.map(p => p[1])) - top) }, { x: left, y: top }); tool = action.side || 'pen'; stroke = []; }
        if (action?.mode === 'endpoint' && action.moved) { const p = world(point(event)); let target = itemAt(p); const edge = board.edges.find(edge => edge.id === action.item); if (edge && !target) { const id = anchorAt(p, event.shiftKey, otherEnd(edge.id, action.side)); target = board.items.find(item => item.id === id); } if (edge && target) { const other = board.items.find(item => item.id === (action.side === 'from' ? edge.to : edge.from)); if (target.id !== other?.id) { const facing = event.shiftKey && other && target.kind !== 'anchor' ? (action.side === 'from' ? straightSides(target, other)?.from : straightSides(other, target)?.to) : undefined; if (action.side === 'from') { edge.from = target.id; edge.fromSide = target.kind === 'anchor' ? 'center' : facing ?? nearestSide(target, p); } else { edge.to = target.id; edge.toSide = target.kind === 'anchor' ? 'center' : facing ?? nearestSide(target, p); } } deleteItems(board, new Set()); session.touch(); } }
        if (lifted) { if (action?.mode === 'move' && action.moved) settleColumn(action); else endColumnPreview(); }
        if (action?.mode === 'move' && action.moved && !board.readOnly) {
            const element = document.elementFromPoint(event.clientX, event.clientY), p = world(point(event)), ids = new Set(action.positions.keys());
            const card = [...board.items].reverse().find(item => item.kind === 'board' && !item.unsorted && !ids.has(item.id) && hitItem(item, p));
            const destination = element?.closest('[data-board-target]')?.getAttribute('data-board-target') || card?.ref;
            if (element?.closest('[data-board-shelf="unsorted"]')) stashSelection(ids);
            else if (destination && destination !== board.id) void moveOut(destination, ids).catch(error => service.report(error));
            else if (!action.positions.get(action.item || '')?.column) { placeInColumn(board, ids, insertion); session.touch(); }
        }
        if (action?.mode === 'resize' && !board.readOnly) { const column = board.items.find(item => item.id === action.item && item.column); if (column) layoutColumn(board, column); reflowColumns(board); session.touch(); }
        insertion = undefined;
        if (action?.mode === 'connect') { const from = action.item || ''; if (!action.moved) selected = new Set([from]); else { const p = world(point(event)), target = itemAt(p); if (target?.id !== from) mutate(() => { const to = target ? target.id : anchorAt(p, event.shiftKey, board.items.find(item => item.id === from)); const sides = event.shiftKey && target ? straightSides(board.items.find(item => item.id === from), target) : undefined; board.edges.push({ id: uid(), from, to, style: 'straight', label: '', arrow: 'end', fromSide: sides?.from, toSide: sides?.to }); }); } }
        if (action?.mode === 'move' && !action.moved && action.item && !multiSelect && !event.shiftKey && !event.ctrlKey && !event.metaKey) { const item = board.items.find(item => item.id === action.item)!; selected = expandSelection(board, new Set([item.id])); const now = Date.now(); if (lastTap.id === item.id && now - lastTap.time < 350) { if (item.kind === 'world-view' && item.worldView) onOpenWorldView(item.worldView.typeId, item.worldView.viewId, Boolean(board.readOnly || item.locked)); else if (item.kind === 'board') onNavigate(item.ref!); else if (item.kind === 'entity') editCanvasEntity(item); else if (item.kind === 'image') imageEditor(item.id); else void startText(item.id); lastTap = { id: '', time: 0 }; } else lastTap = { id: item.id, time: now }; }
        if (action?.mode === 'marquee' && !action.moved && !event.shiftKey) { const now = Date.now(), p = action.start; if (now - lastEmpty.time < 350 && Math.hypot(p.x - lastEmpty.x, p.y - lastEmpty.y) * board.viewport.zoom < 12) { lastEmpty = { time: 0, x: 0, y: 0 }; add('sticky', { text: tr('design_text') }, p); } else lastEmpty = { time: now, x: p.x, y: p.y }; }
        if ((!action || action.mode === 'label') && !action?.moved) { const target = event.target as Element, id = action?.item || target.closest('[data-edge]')?.getAttribute('data-edge'); if (id) { const now = Date.now(); if (lastTap.id === id && now - lastTap.time < 350) { editEdgeLabel(board.edges.find(edge => edge.id === id)!, action?.side || target.closest('[data-label]')?.getAttribute('data-label') || undefined); lastTap = { id: '', time: 0 }; } else lastTap = { id, time: now }; } }
    }
    /** Clears the column drag state. Positions already moved by the preview stay as they are (the drag is abandoned only by a cancel). */
    function endColumnPreview() { if (lifted) lifted = ''; if (slotGhost) slotGhost = undefined; if (displaced.size) displaced = new Map(); if (animated.size) animated = new Set(); }
    /**
     * While a single column is dragged, the columns of its row slide into the slots it would take. Neighbours get
     * positions computed from their start positions, so repeated moves do not drift; a neighbour that leaves the row returns.
     */
    function previewColumn(current: DesignBoard, action: NonNullable<typeof drag>) {
        const byId = new Map(current.items.map(item => [item.id, item] as const));
        const dragged = action.item ? byId.get(action.item) : undefined;
        // Only a column, with the objects inside it, reorders a row. A mixed selection moves freely.
        if (!dragged?.column || dragged.locked || ![...action.positions.keys()].every(id => id === dragged.id || (byId.has(id) && contained(dragged, byId.get(id)!)))) { endColumnPreview(); return; }
        const start = new Map(action.base.items.map(item => [item.id, item] as const)), begin = start.get(dragged.id);
        if (!begin) { endColumnPreview(); return; }
        lifted = dragged.id;
        const neighbours = current.items.filter(item => item.column && !item.locked && item.id !== dragged.id && !contained(item, dragged) && !contained(dragged, item));
        const row = columnRowMembers(neighbours, dragged);
        const slots = planColumnRow([{ id: dragged.id, x: dragged.x, w: dragged.w, base: begin.x }, ...row.map(column => ({ id: column.id, x: start.get(column.id)?.x ?? column.x, w: column.w, base: start.get(column.id)?.x ?? column.x }))]);
        const shifts = new Map<string, number>();
        slotGhost = undefined;
        for (const slot of slots) {
            if (slot.id === dragged.id) { slotGhost = { x: slot.x, y: begin.y, w: dragged.w, h: dragged.h }; continue; }
            const column = start.get(slot.id);
            if (!column) continue;
            const shift = slot.x - column.x;
            for (const member of action.base.items) if (!member.locked && !action.positions.has(member.id) && (member.id === column.id || contained(column, member))) shifts.set(member.id, shift);
        }
        const restored: string[] = [];
        for (const item of current.items) {
            const before = start.get(item.id);
            if (!before || action.positions.has(item.id)) continue;
            if (shifts.has(item.id)) item.x = before.x + shifts.get(item.id)!;
            else if (displaced.has(item.id)) { item.x = before.x; restored.push(item.id); }
        }
        displaced = shifts;
        animated = new Set([...shifts.keys(), ...restored]);
    }
    /** Drop: the dragged column and its contents glide from the pointer into the slot shown by the ghost. */
    function settleColumn(action: NonNullable<typeof drag>) {
        const ghost = slotGhost, dragged = board.items.find(item => item.id === lifted);
        endColumnPreview();
        if (!ghost || !dragged) return;
        const dx = ghost.x - dragged.x, dy = ghost.y - dragged.y;
        if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
        const moved = board.items.filter(item => action.positions.has(item.id));
        for (const item of moved) { item.x += dx; item.y += dy; }
        followConnections(action.base, board);
        animated = new Set(moved.map(item => item.id));
        session.touch();
        setTimeout(() => { animated = new Set(); }, 320);
    }
    function cancel(_event: PointerEvent) { if (drag?.mode === 'pan') { session.board.viewport = clone(drag.view); session.touchViewport(); } else if (drag && (drag.moved || drag.mode === 'erase') && !['pen', 'connect', 'endpoint', 'marquee'].includes(drag.mode)) { session.board = clone(drag.base); session.touch(); } endColumnPreview(); insertion = undefined; endpointPreview = undefined; connectPreview = undefined; pointers.clear(); clearTimeout(longPress); gesture = undefined; stroke = []; drag = undefined; selectionBox = undefined; guides = {}; }
    function wheel(event: WheelEvent) { if (!event.ctrlKey && !event.metaKey && (event.target as Element).closest('.design-table-wrap,.design-widget-body,video,audio,iframe,[contenteditable="true"]')) return; event.preventDefault(); const p = point(event); board.viewport = zoomAt(board.viewport, board.viewport.zoom * Math.exp(-event.deltaY * .0015), p.x, p.y); session.touchViewport(); }
    function key(event: KeyboardEvent) {
        if ((event.target as Element).closest('button,input,textarea,select,[data-canvas-interactive],[contenteditable="true"]')) return;
        const modifier = event.ctrlKey || event.metaKey, letter = shortcutLetter(event);
        event.stopPropagation();
        if (event.key === 'F1' || event.key === '?') { event.preventDefault(); new DesignHelpModal(service).open(); return; }
        if (modifier && letter === 'f') { event.preventDefault(); searchOpen = true; void tick().then(() => { searchInput.focus(); searchInput.select(); }); return; }
        if (modifier && ['c', 'x'].includes(letter)) { copy(); clearTimeout(copyFallback); copyFallback = setTimeout(() => { if (letter === 'x') cut(); if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(designClipboard.text || '').catch(() => undefined); }, 0); return; }
        if (modifier && letter === 'v') { clearTimeout(clipboardFallback); clipboardFallback = setTimeout(() => { if (designClipboard.value && designClipboard.text === '') paste(); else void pasteOs(true); }, 100); return; }
        if ((modifier && ['+', '=', '-', '0'].includes(event.key)) || (event.altKey && ['1', '2'].includes(event.key))) { event.preventDefault(); if (event.altKey) fit(event.key === '2'); else { board.viewport = zoomAt(board.viewport, event.key === '0' ? 1 : board.viewport.zoom * (event.key === '-' ? .8 : 1.25), width / 2, height / 2); session.touchViewport(); } return; }
        if (modifier && letter === 'g') { event.preventDefault(); action(event.shiftKey ? 'ungroup' : 'group'); return; }
        if (modifier && event.shiftKey && letter === 'l') { event.preventDefault(); action('lock'); return; }
        if (event.key === 'Tab') { event.preventDefault(); if (board.mindMap && selectedItem) { let child: BoardItem | undefined; mutate(() => child = mindBranch(board, selectedItem!.id)); if (child) void startText(child.id); } else { const order = board.items.filter(item => item.kind !== 'anchor').sort((a, b) => a.y - b.y || a.x - b.x), index = order.findIndex(item => selected.has(item.id)), next = order[(index + (event.shiftKey ? -1 : 1) + order.length) % order.length]; if (next) selectItem(next.id); } return; }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0, dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
            if (modifier && event.shiftKey) { if (dy && selected.size) action('step', -dy); }
            else if (modifier && selectedItem) { const cx = selectedItem.x + selectedItem.w / 2, cy = selectedItem.y + selectedItem.h / 2; const next = board.items.filter(item => item.kind !== 'anchor' && item.id !== selectedItem!.id && (item.x + item.w / 2 - cx) * dx + (item.y + item.h / 2 - cy) * dy > 0).sort((a, b) => Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) - Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy))[0]; if (next) selectItem(next.id); }
            else if (selected.size) mutate(() => { if (event.altKey) { const source = selectionBoard(board, selected).items; if (!source.length) return; const box = itemsBounds(source); selected = new Set(duplicateItems(board, selected, board, { x: dx * (box.w + 20), y: dy * (box.h + 20) })); } else { const moving = movingIds(board, selected); for (const item of board.items.filter(item => moving.has(item.id) && !item.locked)) { item.x += dx * (event.shiftKey ? 10 : 1); item.y += dy * (event.shiftKey ? 10 : 1); } } });
            else { board.viewport.x -= dx * 40; board.viewport.y -= dy * 40; session.touchViewport(); } return;
        }
        if (event.key === 'Enter' && modifier) { event.preventDefault(); createNext(); return; }
        if (event.key === 'Enter' && event.shiftKey && selectedItem?.kind === 'frame') { event.preventDefault(); enterFrame(); return; }
        if (event.key === 'Enter' && selectedItem) { event.preventDefault(); if (board.mindMap) { let child: BoardItem | undefined; mutate(() => child = mindBranch(board, selectedItem!.id, true)); if (child) void startText(child.id); } else if (selectedItem.kind === 'entity') editCanvasEntity(selectedItem); else if (selectedItem.kind === 'world-view' && selectedItem.worldView) onOpenWorldView(selectedItem.worldView.typeId, selectedItem.worldView.viewId, Boolean(board.readOnly || selectedItem.locked)); else if (selectedItem.kind === 'board') onNavigate(selectedItem.ref!); else void startText(selectedItem.id); return; }
        if (event.key === 'PageUp' || event.key === 'PageDown') { event.preventDefault(); if (event.shiftKey) layer(event.key === 'PageUp'); else action('step', event.key === 'PageUp' ? 1 : -1); return; }
        if (event.code === 'Space') { event.preventDefault(); space = true; }
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (modifier && event.key === 'Backspace') action('clear'); else remove(); }
        // Commands come from the layout-independent mapping in commands.ts (letters by physical key, brackets by code).
        const command = letterCommand(letter, modifier, event.shiftKey) ?? codeCommand(event.code, modifier);
        if (command === 'parent' || command === 'back' || command === 'forward') { event.preventDefault(); onHistory(command); return; }
        if (command === 'selectAll') { event.preventDefault(); selected = new Set([...board.items.filter(item => item.kind !== 'anchor' && !hidden.has(item.id)).map(item => item.id), ...board.edges.filter(edge => !edge.unsorted && !hidden.has(edge.from) && !hidden.has(edge.to)).map(edge => edge.id)]); return; }
        if (command === 'undo' || command === 'redo' || command === 'duplicate') { event.preventDefault(); if (board.readOnly) return; if (command === 'undo') session.undo(); else if (command === 'redo') session.redo(); else duplicate(); return; }
        if (!modifier && !event.altKey) { const tools: Record<string, string> = { v: 'select', h: 'hand', t: 'text', n: 'sticky', s: 'shape', r: 'shape', o: 'shape', l: 'edge', f: 'frame', p: 'pen', e: 'eraser' }; if (tools[letter] && (!board.readOnly || tools[letter] === 'select' || tools[letter] === 'hand')) { event.preventDefault(); chooseTool(tools[letter]!); if (letter === 'r') shape = 'rect'; if (letter === 'o') shape = 'ellipse'; } if (letter === 'm') showMap = !showMap; if (letter === 'g') mutate(() => board.grid = !board.grid); }
        if (event.key === 'Escape' && event.shiftKey && exitFrame()) return;
        if (event.key === 'Escape') { finishText(); presentation = -1; if (board.items.some(item => item.kind === 'anchor' && !board.edges.some(edge => edge.from === item.id || edge.to === item.id))) mutate(() => deleteItems(board, new Set())); source = ''; selected = new Set(); tool = 'select'; menu = false; shelf = undefined; searchOpen = false; multiSelect = false; }
    }
    function find(back = false) { if (!search || !matches.length) return; searchCursor = (searchCursor + (back ? -1 : 1) + matches.length) % matches.length; selectItem(matches[searchCursor]!.id); }
    async function drop(event: DragEvent) {
        event.preventDefault(); const files = Array.from(event.dataTransfer?.files || []); if (!files.length) return;
        const rect = canvas.getBoundingClientRect(); const p = world({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        await importFiles(files, p);
    }
    /** The palette formats the text the user selected, so the selection is followed for as long as the board is open. */
    function rememberEditorSelection() { if (document.activeElement === editorNode()) rememberText(); }
    onMount(() => {
        if (session.board.items.some(item => item.kind === 'world-view')) void service.initializeWorld().catch(error => service.report(error)); document.addEventListener('selectionchange', rememberEditorSelection); return () => document.removeEventListener('selectionchange', rememberEditorSelection); });
    onDestroy(() => { alive = false; clearTimeout(longPress); clearTimeout(clipboardFallback); clearTimeout(copyFallback); });
</script>

<div class="design-board-shell">
    <div class="design-board-top" class:design-compact-top={compact}>
        {#if compact}
            <button class="design-chrome-icon design-mobile-fit" on:click={() => fit()} aria-label={tr('design_fit')} title={tr('design_fit')}><span use:icon={'scan'}></span><small>{Math.round(board.viewport.zoom * 100)}%</small></button>
            <button class="design-chrome-icon" disabled={board.readOnly || !historyState(revision).canUndo} on:click={() => { finishText(); session.undo(); }} aria-label={tr('design_undo')}><span use:icon={'undo-2'}></span></button>
            <button class="design-chrome-icon" disabled={board.readOnly || !historyState(revision).canRedo} on:click={() => { finishText(); session.redo(); }} aria-label={tr('design_redo')}><span use:icon={'redo-2'}></span></button>
            <button class="design-chrome-icon" class:mod-cta={searchOpen} on:click={() => { searchOpen = !searchOpen; if (searchOpen) void tick().then(() => searchInput.focus()); }} aria-label={tr('design_search')} aria-expanded={searchOpen}><span use:icon={'search'}></span></button>
            <button class="design-chrome-icon design-mobile-inbox" class:mod-cta={shelf === 'unsorted'} on:click={() => { menu = false; shelf = shelf === 'unsorted' ? undefined : 'unsorted'; }} aria-label={tr('design_unsorted') + ' ' + unsortedCount} aria-expanded={shelf === 'unsorted'}><span use:icon={'inbox'}></span><span class="design-count">{unsortedCount}</span></button>
            <span class="design-save-dot" class:is-dirty={session.dirty} class:is-saving={session.saving} role="status" aria-label={tr(session.saving ? 'design_saving' : session.dirty ? 'design_unsaved' : 'design_saved')} title={tr(session.saving ? 'design_saving' : session.dirty ? 'design_unsaved' : 'design_saved')}></span>
        {:else}
<div class="design-inline"><button on:click={() => fit()}>{tr('design_fit')}</button><button on:click={() => { board.viewport = zoomAt(board.viewport, 1, width / 2, height / 2); session.touchViewport(); }}>{Math.round(board.viewport.zoom * 100)}%</button><button disabled={board.readOnly || !historyState(revision).canUndo} on:click={() => { finishText(); session.undo(); }} title={tr('design_undo')}>↶</button><button disabled={board.readOnly || !historyState(revision).canRedo} on:click={() => { finishText(); session.redo(); }} title={tr('design_redo')}>↷</button><label><input type="checkbox" checked={board.grid} on:change={event => mutate(() => board.grid = event.currentTarget.checked)} />{tr('design_grid')}</label><label><input type="checkbox" checked={board.snap} on:change={event => mutate(() => board.snap = event.currentTarget.checked)} />{tr('design_snap')}</label></div>
        <input bind:this={searchInput} placeholder={tr('design_search')} aria-label={tr('design_search')} bind:value={search} on:input={() => searchCursor = -1} on:keydown={event => { if (event.key === 'Enter') { event.preventDefault(); find(event.shiftKey); } }} /><button on:click={() => find()} title={tr('design_search_next')}>⌕</button>{#if search}<span>{matches.length} {tr('design_search_count')}</span>{/if}<small aria-live="polite">{tr(session.saving ? 'design_saving' : session.dirty ? 'design_unsaved' : 'design_saved')}</small>
        <button class:mod-cta={shelf === 'unsorted'} on:click={() => shelf = shelf === 'unsorted' ? undefined : 'unsorted'}>{tr('design_unsorted')} <span class="design-count">{unsortedCount}</span></button><button class="design-icon-button" title={tr('design_trash')} aria-label={tr('design_trash')} on:click={() => shelf = shelf === 'trash' ? undefined : 'trash'}><span use:icon={'trash-2'}></span></button>
        {/if}
        <details class="design-board-menu" use:boardMenu><summary aria-label={tr('design_board_settings')} title={tr('design_board_settings')}><span use:icon={'ellipsis'}></span></summary><div>{#if compact}<label><input type="checkbox" checked={board.grid} disabled={board.readOnly} on:change={event => mutate(() => board.grid = event.currentTarget.checked)} />{tr('design_grid')}</label><label><input type="checkbox" checked={board.snap} disabled={board.readOnly} on:change={event => mutate(() => board.snap = event.currentTarget.checked)} />{tr('design_snap')}</label><button on:click={() => { shelf = 'trash'; menu = false; }}>{tr('design_trash')}</button><button on:click={() => { board.viewport = zoomAt(board.viewport, 1, width / 2, height / 2); session.touchViewport(); }}>100%</button><label><input type="checkbox" bind:checked={showMap} />{tr('design_minimap')}</label>{/if}<button disabled={board.readOnly} on:click={() => boardCover(board.id)}>{tr('design_board_cover')}</button><button disabled={board.readOnly} on:click={() => boardIcon(board.id)}>{tr('design_board_icon')}</button><label>{tr('design_background')}<input type="color" value={board.background || '#ffffff'} on:change={event => mutate(() => board.background = event.currentTarget.value)} /></label><label><input type="checkbox" checked={!!board.readOnly} on:change={event => setReadOnly(event.currentTarget.checked)} />{tr('design_read_only')}</label><label><input type="checkbox" checked={board.mindMap} on:change={event => mutate(() => board.mindMap = event.currentTarget.checked)} />{tr('design_mind_map')}</label><button on:click={() => mutate(() => autoLayout(board))}>{tr('design_auto_layout')}</button><button on:click={insertTemplate}>{tr('design_template')}</button><button on:click={() => present(0)} disabled={!frames.length}>{tr('design_presentation')}</button><button on:click={() => void session.flush().then(() => service.copyBoard(service.resolveBoard(board.id)!)).then(doc => onNavigate(doc.board.id)).catch(error => service.report(error))}>{tr('design_copy_board')}</button>{#each ['svg', 'png', 'pdf'] as format}<button on:click={() => void exportBoard(service, board, format as 'svg' | 'png' | 'pdf').catch(error => service.report(error))}>{tr('design_export_board')} {format.toUpperCase()}</button><button disabled={!selected.size} on:click={() => void exportBoard(service, board, format as 'svg' | 'png' | 'pdf', selected).catch(error => service.report(error))}>{tr('design_export_selection')} {format.toUpperCase()}</button>{/each}<label><input type="checkbox" checked={Boolean(board.template)} on:change={event => mutate(() => board.template = event.currentTarget.checked ? true : undefined)} />{tr('design_is_template')}</label><button on:click={() => void exportMarkdown().catch(error => service.report(error))}>{tr('design_export_markdown')}</button><button on:click={() => new DesignHelpModal(service).open()}>{tr('design_shortcuts')}</button></div></details></div>
    {#if compact && searchOpen}<form class="design-mobile-search" on:submit|preventDefault={() => find()}><input bind:this={searchInput} type="search" placeholder={tr('design_search')} aria-label={tr('design_search')} bind:value={search} on:input={() => searchCursor = -1} /><small>{matches.length}</small><button class="design-chrome-icon" type="submit" aria-label={tr('design_search_next')}><span use:icon={'arrow-down'}></span></button><button class="design-chrome-icon" type="button" on:click={() => { searchOpen = false; search = ''; canvas.focus(); }} aria-label={tr('design_close_panel')}><span use:icon={'x'}></span></button></form>{/if}
    {#if presentation >= 0}<div class="design-inline design-presentation"><strong>{frames[presentation]?.title}</strong><button on:click={() => present(presentation - 1)}>{tr('design_previous')}</button><button on:click={() => present(presentation + 1)}>{tr('design_next')}</button><button on:click={() => presentation = -1}>{tr('design_exit')}</button></div>{/if}
    {#if session.conflict}<div class="design-conflict" role="alert">{tr('design_conflict')}<button on:click={() => void session.reload().catch(e => service.report(e))}>{tr('design_reload')}</button><button on:click={() => void session.keepLocal().catch(e => service.report(e))}>{tr('design_keep_local')}</button></div>{/if}
    <div class="design-board-workspace">
        <DesignPalette {compact} moreLabel={tr('design_all_tools')} closeLabel={tr('design_close_panel')} heading={tr(editingText ? 'design_format_text' : 'design_palette_heading')} searchLabel={tr('design_palette_search')} items={editingText ? textItems : paletteObjects} mode={editingText ? 'text' : 'objects'} dropArea={canvas} hint={tr('design_palette_handle')} />
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex (The application canvas implements pointer gestures and keyboard selection commands.) -->
        <div bind:this={canvas} use:measure class="design-canvas" class:is-hand={tool === 'hand' || space} tabindex="0" role="application" aria-label={tr('design_title')} style:background-color={board.background || undefined} style:background-size={`${20 * board.viewport.zoom}px ${20 * board.viewport.zoom}px`} style:background-position={`${board.viewport.x}px ${board.viewport.y}px`} class:no-grid={!board.grid || board.viewport.zoom < (compact ? .65 : .3)} on:pointerdown={down} on:pointermove={move} on:pointerup={up} on:pointercancel={cancel} on:wheel={wheel} on:keydown={key} on:keyup={event => { if (event.code === 'Space') space = false; }} on:blur={() => space = false} on:copy={clipboardCopy} on:cut={event => clipboardCopy(event, true)} on:paste={event => void clipboardPaste(event).catch(error => service.report(error))} on:contextmenu={event => { if (!(event.target as Element).closest('input,textarea,select,button,[data-canvas-interactive],[contenteditable="true"]')) { event.preventDefault(); menu = true; } }} on:dragover|preventDefault on:drop={event => void drop(event).catch(e => service.report(e))}>
            <svg class="design-edge-layer" width="100%" height="100%" aria-hidden="true">
                <defs><marker id={'design-arrow-' + board.id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
                <g transform={`translate(${board.viewport.x},${board.viewport.y}) scale(${board.viewport.zoom})`}>
                    {#each edges as edge (edge.id)}{@const points = edgePoints(edge)}<g data-edge={edge.id} class:selected-edge={selected.has(edge.id)}><defs><marker id={`design-arrow-${board.id}-${edge.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill={edge.color || '#475569'} /></marker></defs><path d={edgePath(edge)} fill="none" stroke="transparent" stroke-width={16 / board.viewport.zoom} class="design-edge-hit" /><path d={edgePath(edge)} fill="none" stroke={edge.color || '#475569'} stroke-width={edge.width || 2} stroke-dasharray={edge.dash === 'dash' ? '12 8' : edge.dash === 'dot' ? '2 6' : undefined} stroke-linecap="round" marker-end={edge.arrow !== 'none' ? `url(#design-arrow-${board.id}-${edge.id})` : undefined} marker-start={edge.arrow === 'both' ? `url(#design-arrow-${board.id}-${edge.id})` : undefined} />{#if selected.has(edge.id)}{#each ['from', 'to'] as side}<circle data-endpoint={edge.id} data-side={side} cx={side === 'from' ? points.a.x : points.b.x} cy={side === 'from' ? points.a.y : points.b.y} r={7 / board.viewport.zoom} fill="var(--interactive-accent)" />{/each}{#each edge.bends || [] as point, index}<circle data-bend={index} cx={point[0]} cy={point[1]} r={6 / board.viewport.zoom} fill="var(--interactive-accent)" />{/each}{/if}</g>{/each}
                    {#if stroke.length}<path d={strokePath(stroke)} fill="none" stroke={color} stroke-width={penWidth} stroke-linecap="round" />{/if}
                    {#if selectionBox}<rect x={selectionBox.x} y={selectionBox.y} width={selectionBox.w} height={selectionBox.h} class="design-marquee" />{/if}
                    {#if guides.x !== undefined}<line x1={guides.x} x2={guides.x} y1={-board.viewport.y / board.viewport.zoom} y2={(height - board.viewport.y) / board.viewport.zoom} class="design-guide" />{/if}
                    {#if guides.y !== undefined}<line y1={guides.y} y2={guides.y} x1={-board.viewport.x / board.viewport.zoom} x2={(width - board.viewport.x) / board.viewport.zoom} class="design-guide" />{/if}
                    {#if endpointPreview}<circle cx={endpointPreview.x} cy={endpointPreview.y} r="8" fill="var(--interactive-accent)" />{/if}
                </g>
            </svg>
            <div class="design-item-layer" style:transform={`translate(${board.viewport.x}px, ${board.viewport.y}px) scale(${board.viewport.zoom})`}>
                {#if insertion}<div class="design-column-insertion" style:left={`${insertion.x}px`} style:top={`${insertion.y}px`} style:width={`${insertion.w}px`}></div>{/if}
                {#if slotGhost}<div class="design-slot-ghost" style:left={`${slotGhost.x}px`} style:top={`${slotGhost.y}px`} style:width={`${slotGhost.w}px`} style:height={`${slotGhost.h}px`}></div>{/if}
                {#each items as item (item.id)}
                    {@const entity = item.kind === 'entity' ? service.index.resolve(item.ref!) : undefined}
                    {@const type = entity ? service.settings.types.find(type => type.id === entity.type) : undefined}
                    <ItemView lifted={lifted === item.id} animated={animated.has(item.id)} count={columnCounts.get(item.id)} {service} {item} {entity} {type} nested={item.kind === 'board' ? service.resolveBoard(item.ref!) : undefined} dataVersion={service.dataVersion} x={item.x} y={item.y} w={item.w} h={item.column && item.collapsed ? Math.min(item.h, 44) : item.h} z={item.z} color={type?.color || item.color || '#8b5cf6'} text={item.text || ''} title={item.title || ''} path={item.path || ''} shape={item.shape} strokeWidth={item.width || 3} autoSize={Boolean(item.autoSize)} selected={selected.has(item.id)} match={Boolean(search && title(item).toLocaleLowerCase().includes(lowerSearch))} compact={board.viewport.zoom < .3 && item.id !== editingText} interacting={tool === 'select' && !space && !multiSelect} zoom={board.viewport.zoom} measure={autoMeasure} openEntity={onOpenEntity} {removeItem} openBoard={onNavigate} openWorldView={(type, view) => onOpenWorldView(type, view, Boolean(board.readOnly || item.locked))} busy={fetchingLinks.has(item.id)} richText={item.richText || ''} appearance={content.appearance.get(item.id)} editingText={editingText === item.id} {changeText} {finishText} {patchItem} readOnly={Boolean(board.readOnly)} />
                {/each}
            </div>
            <svg class="design-label-layer" width="100%" height="100%" aria-hidden="true"><g transform={`translate(${board.viewport.x},${board.viewport.y}) scale(${board.viewport.zoom})`}>{#each edges as edge (edge.id)}<g data-edge={edge.id}>{#each edgeLabels(edge) as label (label.id)}{@const p = labelPoint(edge, label, itemById)}{#if editingLabel?.edge === edge.id && editingLabel?.label === label.id}<foreignObject x={p.x - 100} y={p.y - 24} width="220" height="80"><input use:labelInput aria-label={tr('design_label')} value={label.text} on:input={event => { const stored = normalLabels(edge).find(candidate => candidate.id === label.id)!; stored.text = event.currentTarget.value; session.touch(); }} on:keydown|stopPropagation={event => { if (event.key === 'Enter' || event.key === 'Escape') { editingLabel = undefined; canvas.focus(); } }} /></foreignObject>{:else}<text data-label={label.id} x={p.x} y={p.y} text-anchor="middle" font-size="14" fill={edge.color || '#475569'}>{label.text || '…'}</text>{/if}{/each}</g>{/each}{#if connectPreview}<line x1={connectPreview.from.x} y1={connectPreview.from.y} x2={connectPreview.to.x} y2={connectPreview.to.y} stroke="var(--interactive-accent)" stroke-width={2 / board.viewport.zoom} stroke-dasharray={`${6 / board.viewport.zoom} ${4 / board.viewport.zoom}`} />{/if}{#if handles.length}{#each handles as handle (handle.corner)}<circle data-connect={hoverItem} data-corner={handle.corner} cx={handle.x} cy={handle.y} r={6 / board.viewport.zoom} fill="var(--interactive-accent)" stroke="var(--background-primary)" stroke-width={2 / board.viewport.zoom} pointer-events="all" cursor="crosshair" />{/each}{/if}</g></svg>
            {#if showMap}<button class="design-minimap" aria-label={tr('design_minimap')} title={tr('design_minimap')} on:pointerdown|stopPropagation on:click={navigateMap}><svg viewBox={`${mapBounds.x} ${mapBounds.y} ${mapBounds.w} ${mapBounds.h}`} preserveAspectRatio="none" aria-hidden="true">{#each board.items.filter(item => !item.unsorted) as item (item.id)}<rect x={item.x} y={item.y} width={item.w} height={item.h} fill={item.color || '#8b5cf6'} opacity=".6" />{/each}<rect x={-board.viewport.x / board.viewport.zoom} y={-board.viewport.y / board.viewport.zoom} width={width / board.viewport.zoom} height={height / board.viewport.zoom} fill="none" stroke="var(--interactive-accent)" stroke-width={mapBounds.w / 120} /></svg></button>{/if}
            <p class="design-board-hint">{tr(tool === 'edge' ? 'design_connect_hint' : 'design_hint')}</p>
        </div>
        {#if compact && !editingText && !shelf}<div class="design-mobile-context"><button class="design-chrome-icon" class:mod-cta={multiSelect} on:click={() => multiSelect = !multiSelect} aria-label={tr('design_multi_select')} aria-pressed={multiSelect}><span use:icon={'square-dashed-mouse-pointer'}></span></button>{#if selected.size || ['shape', 'pen', 'marker', 'highlighter', 'eraser'].includes(tool)}<button class="design-context-properties" on:click={() => menu = !menu} aria-expanded={menu}><span use:icon={'sliders-horizontal'}></span>{tr('design_properties')}{#if selected.size}<small>{selected.size}</small>{/if}</button>{/if}{#if selected.size}<button class="design-chrome-icon" on:click={() => { selected = new Set(); menu = false; }} aria-label={tr('design_clear_selection')}><span use:icon={'x'}></span></button>{/if}</div>{/if}
        {#if !shelf && (compact ? menu && !editingText : menu || selected.size || ['shape', 'pen', 'marker', 'highlighter', 'eraser', 'sticky'].includes(tool))}<aside class="design-object-panel">
            {#if compact}<div class="design-panel-heading"><strong>{tr('design_properties')}</strong><button class="design-chrome-icon" on:click={() => menu = false} aria-label={tr('design_close_panel')}><span use:icon={'x'}></span></button></div>{/if}
            <BoardControls {service} item={selectedItem} edge={selectedEdge} count={selected.size} {action} />
            {#if selected.size}<div class="design-inline"><button on:click={duplicate}>{tr('design_duplicate_item')}</button><button on:click={copy}>{tr('design_copy')}</button><button on:click={paste}>{tr('design_paste')}</button><button on:click={remove}>{tr('delete')}</button><button on:click={() => layer(true)}>{tr('design_front')}</button><button on:click={() => layer(false)}>{tr('design_back_layer')}</button></div>{/if}
            {#if selectedItem}<strong>{title(selectedItem)}</strong>
                {#if selectedItem.kind === 'entity'}<button on:click={() => editCanvasEntity(selectedItem!)}>{tr('design_edit')}</button><button on:click={() => prop('autoSize', !selectedItem!.autoSize)}>{tr(selectedItem.autoSize ? 'design_fixed_size' : 'design_auto_size')}</button>{/if}
                {#if selectedItem.kind === 'board'}<button on:click={() => onNavigate(selectedItem!.ref!)}>{tr('design_open_nested')}</button>{/if}
                {#if ['sticky', 'text', 'shape', 'frame', 'image', 'todo'].includes(selectedItem.kind)}<textarea aria-label={tr(selectedItem.kind === 'image' ? 'design_caption' : selectedItem.kind === 'todo' ? 'design_todo' : 'design_text')} rows="3" value={selectedItem.kind === 'frame' ? selectedItem.title || '' : selectedItem.text || ''} on:change={event => prop(selectedItem!.kind === 'frame' ? 'title' : 'text', event.currentTarget.value)}></textarea>{/if}
                {#if selectedItem.kind === 'link'}<label>{tr('design_link_label')}<input value={selectedItem.title || ''} on:change={event => prop('title', event.currentTarget.value)} /></label><label>{tr('design_link_url')}<input value={selectedItem.text || ''} on:change={event => prop('text', event.currentTarget.value)} /></label>{/if}
                <label>{tr('design_band')}<input type="color" value={selectedItem.band || '#ffffff'} on:change={event => prop('band', event.currentTarget.value)} /></label>{#if selectedItem.band}<button on:click={() => prop('band', undefined)}>{tr('design_clear_band')}</button>{/if}
                {#if selectedItem.kind === 'frame'}<button on:click={() => prop('column', !selectedItem!.column)}>{tr(selectedItem.column ? 'design_unmake_column' : 'design_make_column')}</button>{#if selectedItem.column}<button on:click={() => prop('collapsed', !selectedItem!.collapsed)}>{tr(selectedItem.collapsed ? 'design_expand' : 'design_collapse')}</button>{/if}{/if}
                <label>{tr('design_color')}<input type="color" value={selectedItem.color || '#8b5cf6'} on:change={event => prop('color', event.currentTarget.value)} /></label>
                <label>{tr('design_width')}<input type="number" min="40" value={selectedItem.w} on:change={event => prop('w', Math.max(40, Number(event.currentTarget.value)))} /></label><label>{tr('design_height')}<input type="number" min="30" value={selectedItem.h} on:change={event => prop('h', Math.max(30, Number(event.currentTarget.value)))} /></label>
            {:else if selectedEdge}<label>{tr('design_arrow_style')}<select value={selectedEdge.style} on:change={event => edgeProp('style', event.currentTarget.value)}>{#each ['straight', 'elbow', 'curve'] as style}<option value={style}>{tr(('design_' + style) as TranslationKey)}</option>{/each}</select></label><label>{tr('design_arrowheads')}<select value={selectedEdge.arrow} on:change={event => edgeProp('arrow', event.currentTarget.value)}>{#each ['end', 'both', 'none'] as arrow}<option value={arrow}>{tr(('design_' + arrow) as TranslationKey)}</option>{/each}</select></label><small>{tr('design_link_direction')}</small>
                {#each ['fromSide', 'toSide'] as side}<label>{tr('design_side')}<select value={selectedEdge[side as 'fromSide' | 'toSide'] || ''} on:change={event => edgeProp(side as 'fromSide' | 'toSide', event.currentTarget.value)}><option value="">{tr('design_auto')}</option>{#each ['top', 'right', 'bottom', 'left', 'center'] as value}<option value={value}>{tr(('design_' + value) as TranslationKey)}</option>{/each}</select></label>{/each}
            {:else}<label>{tr('design_color')}<input type="color" bind:value={color} /></label>{#if tool === 'shape'}<select aria-label={tr('design_shape')} bind:value={shape}>{#each SHAPES as value}<option value={value}>{tr(('design_' + value) as TranslationKey)}</option>{/each}</select>{/if}{#if ['pen', 'marker', 'highlighter', 'eraser'].includes(tool)}<label>{tr('design_draw_width')}<input type="range" min="1" max="20" bind:value={penWidth} /></label>{/if}{#if tool === 'eraser'}<label><input type="checkbox" bind:checked={partialEraser} />{tr('design_partial_eraser')}</label>{/if}{/if}
        </aside>{/if}
        {#if shelf}<BoardShelf {service} {board} mode={shelf} {canvas} {title} onClose={() => shelf = undefined} onPlace={placeShelf} onDelete={id => { selected = movingIds(board, new Set([id])); remove(); }} onRestore={recover} onEmpty={emptyTrash} onCreate={shelfCreate} onFiles={files => void importFiles(files, undefined, true).catch(error => service.report(error))} />{/if}
    </div>
</div>
