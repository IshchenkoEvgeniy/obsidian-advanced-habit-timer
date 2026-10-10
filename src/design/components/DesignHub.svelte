<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';
    import { setIcon } from 'obsidian';
    import type { DesignService } from '../service';
    import { BoardSession } from '../session';
    import { clone, type BoardDocument, type BoardEdge, type BoardItem, type DesignEntity } from '../types';
    import { thumbnailBox } from '../board';
    import { DesignConfirm, DesignPicker, DesignPrompt, DesignSchemaModal, NewDesignEntityModal } from '../modals';
    import EntityEditor from './EntityEditor.svelte';
    import WorldWorkspace from './WorldWorkspace.svelte';
    import DesignBoardView from './DesignBoard.svelte';
    import { boardWorkspace } from '../workspace-mode';
    export let service: DesignService;
    export let sessions: Map<string, BoardSession>;
    export let initialBoard = '';
    export let onBoardChanged: (id: string) => void = () => {};
    let active = '', trail: string[] = [], tab = 'entities', query = '', filter = '', tag = '', status = '', revision = 0;
    let boardQuery = '', quick = '';
    let worldEditing: { type: string; view: string; readOnly: boolean; board: string } | undefined;
    function openWorldView(type: string, view: string, readOnly: boolean) { worldEditing = { type, view, readOnly, board: active }; }
    function placeWorldView(type: string, view: string) { new DesignPicker(service, service.boards().filter(doc => !doc.board.readOnly), doc => doc.board.name, doc => { openBoard(doc.board.id); void tick().then(() => boardView?.addWorldView(type, view)); }, tr('design_choose_board')).open(); }
    let compact = false, fullscreen = false;
    function measureWorkspace(node: HTMLElement) {
        const observer = new ResizeObserver(entries => compact = entries[0]!.contentRect.width <= 720 || node.ownerDocument.defaultView!.matchMedia('(pointer: coarse)').matches);
        observer.observe(node);
        return { destroy: () => observer.disconnect() };
    }
    /** Boards visited before and after the current one, for Ctrl+[ and Ctrl+]. Not reactive: only read by key handlers. */
    let past: string[] = [], future: string[] = [], restoring = false;
    let editing: DesignEntity | undefined, boardView: DesignBoardView | undefined, editor: EntityEditor | undefined;
    const tr = service.tr.bind(service);
    const unsubscribe = service.subscribe(() => {
        revision++;
        if (editing) { const latest = service.index.resolve(editing.id); if (latest) editor?.refresh(latest); }
        for (const [id, session] of sessions) if (!service.resolveBoard(id) && !service.plugin.app.vault.getAbstractFileByPath(session.path)) {
            sessions.delete(id);
            if (service.isDeletingBoard(id) || !session.dirty) session.discard(); else void session.close().catch(error => service.report(error));
            if (active === id) hub(); else trail = trail.filter(item => item !== id);
        }
    });
    $: records = refreshed(revision, service.index.all()).filter(entity => {
        const type = service.settings.types.find(type => type.id === entity.type);
        return (!filter || (filter === '_untyped' ? !type : entity.type === filter)) &&
            (!query || `${entity.title} ${entity.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
            (!tag || String(entity.values.tags || '').toLocaleLowerCase().includes(tag.toLocaleLowerCase())) &&
            (!status || type?.fields.filter(field => field.kind === 'status').some(field => service.displayValue(entity, field.id) === status));
    }).sort((a, b) => a.title.localeCompare(b.title));
    $: inbox = refreshed(revision, service.unplacedEntities()).sort((a, b) => a.title.localeCompare(b.title));
    $: documents = refreshed(revision, service.boards()).filter(doc => !boardQuery || `${doc.board.name} ${doc.board.items.map(item => item.text || item.title || (item.ref && service.index.resolve(item.ref)?.title) || '').join(' ')}`.toLocaleLowerCase().includes(boardQuery.toLocaleLowerCase()));
    $: hits = boardQuery.trim() ? refreshed(revision, searchItems(boardQuery.trim())) : [];
    $: session = refreshed(revision, active ? sessions.get(active) : undefined);
    function refreshed<T>(_revision: number, value: T): T { return value; }
    function icon(node: HTMLElement, value: string) { setIcon(node, value); return { update(next: string) { if (next !== value) { value = next; setIcon(node, next); } } }; }
    function openBoard(id: string, nested = false) {
        const doc = service.resolveBoard(id); if (!doc) { service.report(new Error(tr('design_missing_board'))); return; }
        if (!restoring && active && active !== id) { past = [...past.slice(-49), active]; future = []; }
        if (!sessions.has(id)) sessions.set(id, new BoardSession(service, doc, () => { revision++; }));
        if (nested) { const seen = trail.indexOf(id); trail = seen >= 0 ? trail.slice(0, seen + 1) : [...trail, id]; }
        else trail = [id]; active = id; onBoardChanged(id); editing = undefined; revision++;
        void service.refreshTasks().then(() => { revision++; }).catch(e => service.report(e));
    }
    export function newEntity() { new NewDesignEntityModal(service, (entity, add) => { revision++; if (add && active) boardView?.addEntity(entity.id); else editing = entity; }, Boolean(active)).open(); }
    export function newBoard() { new DesignPrompt(service, tr('design_new_board_label'), '', async name => { const doc = await service.createBoard(name); openBoard(doc.board.id); }).open(); }
    export function pickBoard() { new DesignPicker(service, service.boards(), doc => doc.board.name, doc => openBoard(doc.board.id), tr('design_choose_board')).open(); }
    export function showHub() { hub(); }
    export function showBoard(id: string) { openBoard(id); }
    function edit(id: string) { const entity = service.index.resolve(id); if (entity) editing = entity; else { active = ''; tab = 'entities'; } }
    /** Quick capture: a record with a title only, without a board. Enter in the field creates it. */
    async function captureIdea() { const title = quick.trim(); if (!title) return; const type = service.settings.types.find(type => type.id === 'idea') || service.settings.types[0]; if (!type) { service.report(new Error(tr('design_invalid'))); return; } try { await service.createEntity(type.id, title, {}); quick = ''; } catch (error) { service.report(error); } }
    /** Puts an inbox record on the chosen board, opening that board first. */
    function placeOnBoard(entity: DesignEntity) { new DesignPicker(service, service.boards(), doc => doc.board.name, doc => { openBoard(doc.board.id); void tick().then(() => boardView?.addEntity(entity.id)); }, tr('design_choose_board')).open(); }
    function hub() { fullscreen = false; active = ''; onBoardChanged(''); trail = []; editing = undefined; }
    function trailTo(index: number) { const target = trail[index] || ''; if (!restoring && active && target !== active) { past = [...past.slice(-49), active]; future = []; } trail = trail.slice(0, index + 1); active = target; onBoardChanged(active); revision++; }
    /** Ctrl+U: up one level (same as the breadcrumb back button). Ctrl+[ / Ctrl+]: step through visited boards. */
    function historyCommand(command: 'parent' | 'back' | 'forward') {
        if (command === 'parent') { if (trail.length > 1) trailTo(trail.length - 2); else hub(); return; }
        const id = command === 'back' ? past[past.length - 1] : future[future.length - 1];
        if (!id || !service.resolveBoard(id)) return;
        if (command === 'back') { past = past.slice(0, -1); future = [...future, active]; } else { future = future.slice(0, -1); past = [...past, active]; }
        restoring = true;
        try { openBoard(id, trail.includes(id)); } finally { restoring = false; }
    }
    /** Makes a board from a template: a copy without the template mark, opened at once. */
    function newFromTemplate() { const templates = service.boards().filter(doc => doc.board.template); if (!templates.length) { service.report(new Error(tr('design_no_templates'))); return; } new DesignPicker(service, templates, doc => doc.board.name, doc => void makeFromTemplate(doc).catch(error => service.report(error)), tr('design_from_template')).open(); }
    async function makeFromTemplate(doc: BoardDocument) { const copy = await service.copyBoard(doc); await service.saveBoard({ ...copy.board, template: undefined }, copy.path, copy.raw); openBoard(copy.board.id); }
    /** A hub copy includes the latest draft even when the source's autosave has not fired yet. */
    function copyDocument(doc: BoardDocument) { const current = sessions.get(doc.board.id); return service.copyBoard(current ? { ...doc, board: current.board } : doc); }
    /** Objects dropped on a breadcrumb arrive on that board: through its open session when there is one, otherwise by saving its file. */
    async function moveItems(targetId: string, items: BoardItem[], edges: BoardEdge[]) {
        let destination = sessions.get(targetId);
        if (!destination) { const target = service.resolveBoard(targetId); if (!target) throw new Error(tr('design_missing_board')); destination = new BoardSession(service, target, () => revision++); sessions.set(targetId, destination); }
        await destination.receive(items, edges);
        revision++;
    }
    /** Objects on any board whose text, or whose record's title and body, contains the query. */
    function searchItems(query: string): { board: BoardDocument; item: BoardItem; label: string }[] {
        const needle = query.toLocaleLowerCase(), hits: { board: BoardDocument; item: BoardItem; label: string }[] = [];
        for (const doc of service.boards()) for (const item of doc.board.items) {
            if (item.kind === 'anchor') continue;
            const record = item.ref ? service.index.resolve(item.ref) : undefined;
            const haystack = `${item.title || ''} ${item.text || ''} ${record ? `${record.title} ${record.body}` : ''}`.toLocaleLowerCase();
            if (haystack.includes(needle)) { hits.push({ board: doc, item, label: (item.title || item.text || record?.title || doc.board.name).split('\n')[0] || doc.board.name }); if (hits.length >= 200) return hits; }
        }
        return hits;
    }
    function openHit(boardId: string, itemId: string) { openBoard(boardId); void tick().then(() => boardView?.reveal(itemId)); }
    onMount(() => { if (initialBoard) openBoard(initialBoard); });
    onDestroy(unsubscribe);
</script>

<div class="design-root" class:is-compact={compact} class:design-fullscreen={fullscreen} use:measureWorkspace use:boardWorkspace={fullscreen}>
    {#if !active || (!compact && !fullscreen)}<header class="design-header"><div class="design-brand"><span use:icon={'network'}></span><h2>{tr('design_title')}</h2></div><div class="design-inline"><button on:click={newEntity}>{tr('design_new_record_label')}</button><button on:click={newBoard}>{tr('design_new_board_label')}</button><button on:click={newFromTemplate}>{tr('design_new_from_template')}</button><button on:click={() => new DesignSchemaModal(service).open()}>{tr('design_schema')}</button></div></header>{/if}
    {#if service.warnings.size}<div class="design-warning" role="alert">{#each [...service.warnings] as [path, warning]}<div>{warning}: {path}</div>{/each}</div>{/if}
    {#if active && session}<nav class="design-board-heading" aria-label={tr('design_boards')}>
        <button class="design-chrome-icon" aria-label={tr('design_back')} title={tr('design_back')} on:click={() => { if (trail.length > 1) trailTo(trail.length - 2); else hub(); }}><span use:icon={'arrow-left'}></span></button>
        <div class="design-breadcrumbs"><button class="design-hub-link" on:click={hub}>{tr('design_hub')}</button>{#each trail as id, index}<span>›</span><button class:design-current-board={id === active} data-board-target={id} on:click={() => trailTo(index)}>{sessions.get(id)?.board.name || service.resolveBoard(id)?.board.name}</button>{/each}</div>
        <button class="design-chrome-icon design-fullscreen-toggle" class:mod-cta={!fullscreen && compact} aria-label={tr(fullscreen ? 'design_exit_fullscreen' : 'design_fullscreen')} title={tr(fullscreen ? 'design_exit_fullscreen' : 'design_fullscreen')} aria-pressed={fullscreen} on:click={() => fullscreen = !fullscreen}><span use:icon={fullscreen ? 'minimize' : 'maximize'}></span></button>
    </nav>{/if}
    <div class="design-content">
        {#if active && session}<div class="design-main-board">{#key active}<DesignBoardView bind:this={boardView} {service} {session} {revision} {compact} onOpenEntity={edit} onNavigate={id => openBoard(id, true)} onNewEntity={newEntity} onHistory={historyCommand} onMoveItems={moveItems} onOpenWorldView={openWorldView} />{/key}</div>
        {:else}<main class="design-hub-main"><nav class="design-tabs"><button class:mod-cta={tab === 'world'} on:click={() => tab = 'world'}>{service.plugin.settings.language === 'ru' ? 'Таблицы мира' : 'World tables'}</button><button class:mod-cta={tab === 'entities'} on:click={() => tab = 'entities'}>{tr('design_entities')}</button><button class:mod-cta={tab === 'boards'} on:click={() => tab = 'boards'}>{tr('design_boards')}</button><button class:mod-cta={tab === 'inbox'} on:click={() => tab = 'inbox'}>{tr('design_inbox')}</button></nav>
            {#if tab === 'world'}<div class="design-world-hub"><WorldWorkspace {service} onPlaceView={placeWorldView} /></div>
            {:else if tab === 'entities'}<div class="design-filters"><input placeholder={tr('design_search')} aria-label={tr('design_search')} bind:value={query} /><select aria-label={tr('design_type')} bind:value={filter}><option value="">{tr('design_all')}</option>{#each service.settings.types as type}<option value={type.id}>{type.name}</option>{/each}<option value="_untyped">{tr('design_untyped')}</option></select><input placeholder={tr('design_filter_tag')} aria-label={tr('design_filter_tag')} bind:value={tag} /><select aria-label={tr('design_filter_status')} bind:value={status}><option value="">{tr('design_filter_status')}</option>{#each service.statuses() as value}<option value={value}>{value}</option>{/each}</select></div>
                {#if records.length}<div class="design-records">{#each records as entity (entity.path)}{@const type = service.settings.types.find(type => type.id === entity.type)}<button class="design-record-row" style:--item-color={type?.color || '#94a3b8'} on:click={() => edit(entity.id)}><span use:icon={type?.icon || 'file'}></span><strong>{entity.title}</strong><small>{type?.name || tr('design_untyped')}</small><span class="design-row-tags">{String(entity.values.tags || '')}</span></button>{/each}</div>{:else}<div class="design-empty"><span use:icon={'files'}></span><p>{tr('design_empty')}</p><button class="mod-cta" on:click={newEntity}>{tr('design_create')}</button></div>{/if}
            {:else if tab === 'inbox'}<form style="display:flex;gap:6px;margin-bottom:8px" on:submit|preventDefault={captureIdea}><input aria-label={tr('design_quick_idea')} placeholder={tr('design_quick_idea')} bind:value={quick} /><button class="mod-cta" type="submit">{tr('design_create')}</button></form>
                {#if inbox.length}<div class="design-records">{#each inbox as entity (entity.path)}{@const type = service.settings.types.find(type => type.id === entity.type)}<div style="display:flex;gap:6px;align-items:center" style:--item-color={type?.color || '#94a3b8'}><button class="design-record-row" style="flex:1" on:click={() => edit(entity.id)}><span use:icon={type?.icon || 'file'}></span><strong>{entity.title}</strong><small>{type?.name || tr('design_untyped')}</small></button><button on:click={() => placeOnBoard(entity)}>{tr('design_place_on_board')}</button></div>{/each}</div>{:else}<div class="design-empty"><span use:icon={'inbox'}></span><p>{tr('design_inbox_empty')}</p></div>{/if}
            {:else}<input aria-label={tr('design_search_boards')} placeholder={tr('design_search_boards')} bind:value={boardQuery} /><div class="design-board-grid"><article class="design-board-tile design-board-new"><button class="design-board-open" on:click={newBoard}><span class="design-board-thumb"><span use:icon={'plus'}></span></span><strong>{tr('design_new_board_label')}</strong></button></article>{#each documents as doc (doc.path)}<article class="design-board-tile"><button class="design-board-open" on:click={() => openBoard(doc.board.id)}><span class="design-board-thumb" style:background={doc.board.background || undefined}>{#if doc.board.items.length}<svg viewBox={thumbnailBox(doc.board)} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{#each doc.board.items.filter(item => item.kind !== 'anchor').slice(0, 60) as child}<rect x={child.x} y={child.y} width={child.w} height={child.h} rx="8" fill={child.color || '#8b5cf6'} />{/each}</svg>{:else}<span use:icon={'layout-dashboard'}></span>{/if}</span><strong>{doc.board.name}</strong><small>{tr('design_cards_label')} {doc.board.items.filter(item => item.kind !== 'anchor').length}</small></button><div class="design-board-actions"><button aria-label={tr('design_rename')} title={tr('design_rename')} on:click={() => new DesignPrompt(service, tr('design_rename'), doc.board.name, name => service.renameBoard(doc, name)).open()}><span use:icon={'pencil'}></span></button><button aria-label={tr('design_copy_board')} title={tr('design_copy_board')} on:click={() => void copyDocument(doc).then(copy => openBoard(copy.board.id)).catch(error => service.report(error))}><span use:icon={'copy'}></span></button><button aria-label={tr('delete')} title={tr('delete')} on:click={() => new DesignConfirm(service, tr('design_delete_board'), () => service.deleteBoard(doc)).open()}><span use:icon={'trash-2'}></span></button></div></article>{/each}</div>{#if hits.length}<div class="design-hits">{#each hits as hit (hit.board.path + hit.item.id)}<button class="design-board-title" on:click={() => openHit(hit.board.board.id, hit.item.id)}><span use:icon={'search'}></span><strong>{hit.label}</strong><small>{hit.board.board.name}</small></button>{/each}</div>{/if}
            {#if !documents.length}<div class="design-empty"><p>{tr('design_empty_boards')}</p><button class="mod-cta" on:click={newBoard}>{tr('design_create')}</button></div>{/if}{/if}
        </main>{/if}
        {#if editing}<aside class="design-record-panel">{#key editing.id}<EntityEditor bind:this={editor} {service} bind:entity={editing} onSaved={entity => { editing = entity; revision++; }} onClose={() => editing = undefined} />{/key}<button class="design-delete-note" on:click={() => new DesignConfirm(service, tr('design_delete_entity'), async () => { await service.deleteEntity(editing!); editing = undefined; }).open()}>{tr('design_delete_note')}</button></aside>{/if}
    </div>
    {#if worldEditing}<div class="design-world-editor">{#key worldEditing.type + worldEditing.view}<WorldWorkspace {service} initialType={worldEditing.type} initialView={worldEditing.view} readOnly={worldEditing.readOnly} sourceBoard={worldEditing.board} onClose={() => worldEditing = undefined} />{/key}</div>{/if}
</div>
