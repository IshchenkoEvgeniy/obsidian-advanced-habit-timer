<script lang="ts">
    import { onDestroy, onMount, tick } from 'svelte';
    import { setIcon, Notice } from 'obsidian';
    import type { DesignService } from '../service';
    import { clone, uid, type DesignEntity, type DesignType } from '../types';
    import { kanbanColumns, newWorldView, queryWorld, worldFields, worldCreationDefaults, fieldIcon, worldNumberSummary, type WorldView, type WorldViewKind } from '../world-views';
    import { DesignConfirm, DesignPrompt, DesignSchemaModal, NewDesignEntityModal } from '../modals';
    import { boardWorkspace } from '../workspace-mode';
    import { fileName } from '../schema';
    import EntityEditor from './EntityEditor.svelte';
    import WorldField from './WorldField.svelte';
    import WorldTaskLink from './WorldTaskLink.svelte';
    export let service: DesignService;
    export let initialType = '';
    export let initialView = '';
    export let readOnly = false;
    export let sourceBoard = '';
    export let onClose: (() => void) | undefined = undefined;
    export let onPlaceView: ((type: string, view: string) => void) | undefined = undefined;
    let revision = 0, ready = false, loadingError = '', typeId = initialType, viewId = initialView;
    let search = '', navigation = false, focus = Boolean(onClose), configuring = false;
    let draft: WorldView | undefined, draftBaseline = '', error = '', busy = false, limit = 100;
    let editing: DesignEntity | undefined, editor: EntityEditor | undefined, selected = new Set<string>(), movingTo = '';
    let dragId = '';
    let viewMenu: HTMLDetailsElement;
    let workspace: HTMLDivElement;
    let configPanel = 'view', collapsedGroups = new Set<string>();
    function groupName(record: DesignEntity) { return service.displayValue(record, view?.groupBy || '') || word('Не указано', 'Unspecified'); }
    function toggleGroup(name: string) { collapsedGroups = new Set(collapsedGroups); if (collapsedGroups.has(name)) collapsedGroups.delete(name); else collapsedGroups.add(name); }
    async function navigateCell(path: string, field: string, direction: 'next' | 'previous' | 'up' | 'down') {
        const row = records.slice(0, limit).filter(record => !view?.groupBy || !collapsedGroups.has(groupName(record))), r = row.findIndex(record => record.path === path), c = columns.findIndex(column => column.id === field);
        let nr = r, nc = c; if (direction === 'up' || direction === 'down') nr += direction === 'up' ? -1 : 1; else { nc += direction === 'previous' ? -1 : 1; if (nc < 0) { nr--; nc = columns.length - 1; } if (nc >= columns.length) { nr++; nc = 0; } }
        await tick();
        while (row[nr] && columns[nc]) {
            const target = Array.from(workspace.querySelectorAll<HTMLElement>('.world-table [data-record-path]')).find(node => node.dataset.recordPath === row[nr]!.path);
            const button = target?.querySelector<HTMLButtonElement>(`[data-world-field="${CSS.escape(columns[nc]!.id)}"] .world-cell-value`);
            if (button && !button.disabled) { button.focus(); return; }
            if (direction === 'up' || direction === 'down') nr += direction === 'up' ? -1 : 1;
            else { nc += direction === 'previous' ? -1 : 1; if (nc < 0) { nr--; nc = columns.length - 1; } if (nc >= columns.length) { nr++; nc = 0; } }
        }
    }
    const ru = service.plugin.settings.language === 'ru';
    const word = (r: string, en: string) => ru ? r : en;
    const tr = service.tr.bind(service);
    const unsubscribe = service.subscribe(() => {
        revision++;
        if (editing) { const latest = service.index.resolve(editing.id); if (!latest) editing = undefined; else editor?.refresh(latest); }
    });
    function refreshed<T>(_revision: number, value: T): T { return value; }
    $: registry = refreshed(revision, service.world);
    $: datasets = registry?.datasets || [];
    $: type = refreshed(revision, service.settings.types.find(type => type.id === typeId));
    $: dataset = datasets.find(dataset => dataset.id === typeId);
    $: view = dataset?.views.find(view => view.id === viewId) || (initialView && viewId === initialView ? undefined : dataset?.views[0]);
    $: blocked = readOnly || refreshed(revision, Boolean(sourceBoard && service.resolveBoard(sourceBoard)?.board.readOnly));
    $: fields = type ? worldFields(type).map(field => field.id === 'title' ? { ...field, name: word('Название', 'Title') } : field.kind === 'status' ? { ...field, name: word('Статус реализации', 'Implementation status') } : field) : [];
    $: columns = view ? view.columns.map(id => fields.find(field => field.id === id)).filter((field): field is typeof fields[number] => Boolean(field)) : [];
    $: records = refreshed(revision, type && view ? queryWorld(service.index.all(), type, view, search, (record, field) => service.displayValue(record, field)) : []);
    $: groups = kanbanColumns(records, type?.fields.find(field => field.id === view?.groupBy), service.optionLabel.bind(service), word('Не указано', 'Unspecified'));
    $: if (ready && datasets.length && !dataset) chooseType(datasets[0]!.id);
    function icon(node: HTMLElement, name: string) { setIcon(node, name); return { update(next: string) { setIcon(node, next); } }; }
    function chooseType(id: string) {
        const change = async () => { typeId = id; viewId = service.world?.datasets.find(dataset => dataset.id === id)?.views[0]?.id || ''; navigation = false; configuring = false; search = ''; selected = new Set(); limit = 100; editing = undefined; };
        if (editor?.isDirty()) new DesignConfirm(service, tr('design_cancel_edit'), change).open(); else void change();
    }
    function chooseView(id: string) { viewId = id; configuring = false; selected = new Set(); limit = 100; }
    async function act(action: () => Promise<unknown>) {
        if (blocked || busy) return; busy = true; error = '';
        try { await action(); revision++; }
        catch (reason) { error = reason instanceof Error && reason.message.startsWith('design_') ? tr(reason.message as 'design_conflict') : String(reason); service.report(reason); }
        finally { busy = false; }
    }
    function newRecord(extra: Record<string, unknown> = {}) {
        if (!type || !view || blocked) return; const currentType = type, currentView = clone(view), defaults = worldCreationDefaults(type, view);
        new NewDesignEntityModal(service, entity => {
            editing = entity;
            if (!queryWorld([entity], currentType, currentView, search, (record, field) => service.displayValue(record, field)).length) new Notice(word('Запись сохранена, но не соответствует условиям текущего вида.', 'Record saved, but it does not match the current view.'));
        }, false, type.id, { ...defaults.values, ...extra }, defaults.title).open();
    }
    function configure(panel = 'view') { if (!view) return; const same = configuring && configPanel === panel; draft = clone(view); draftBaseline = JSON.stringify(view); configPanel = panel; configuring = !same; }
    function createView(kind: WorldViewKind) {
        if (!type || blocked) return;
        if (viewMenu) viewMenu.open = false;
        const currentType = type;
        new DesignPrompt(service, word('Новый вид', 'New view'), kind === 'table' ? word('Таблица', 'Table') : word('Канбан', 'Kanban'), async name => {
            const next = newWorldView(currentType, kind, name); await service.saveWorldView(currentType.id, next); viewId = next.id; await tick(); configure();
        }).open();
    }
    function newTable() {
        if (blocked) return;
        new DesignPrompt(service, word('Новая таблица мира', 'New world table'), '', async name => {
            const schema = clone(service.settings), id = 'type_' + uid(), folder = `${fileName(name)}-${id.slice(-6)}`;
            const next: DesignType = { id, name, folder, color: '#8b5cf6', icon: 'database', fields: [
                { id: 'design_state', name: word('Подготовка записи', 'Design readiness'), kind: 'select', card: true, options: [{ value: word('Идея', 'Idea'), color: '#94a3b8' }, { value: word('В работе', 'In progress'), color: '#eab308' }, { value: word('Готово', 'Ready'), color: '#22c55e' }] },
                { id: 'task', name: word('Задача разработки', 'Development task'), kind: 'task' }, { id: 'status', name: word('Статус реализации', 'Implementation status'), kind: 'status' }
            ] }; schema.types.push(next); await service.saveSchema(schema); chooseType(id); new DesignSchemaModal(service, id).open();
        }).open();
    }
    async function saveDraft() { if (!draft || !type) return; const next = clone(draft), id = type.id; await act(async () => { await service.saveWorldView(id, next, draftBaseline); configuring = false; }); }
    function deleteView() {
        if (!view || !dataset || dataset.views.length < 2 || blocked) return;
        const id = view.id, table = typeId;
        new DesignConfirm(service, word('Удалить вид? Записи останутся.', 'Delete this view? Records will remain.'), async () => {
            await service.updateWorld(registry => { const data = registry.datasets.find(dataset => dataset.id === table)!; if (data.views.length < 2) return; data.views = data.views.filter(view => view.id !== id); });
            viewId = service.world?.datasets.find(dataset => dataset.id === table)?.views[0]?.id || ''; configuring = false;
        }).open();
    }
    function reorderColumn(id: string, offset: number) { if (!draft) return; const at = draft.columns.indexOf(id), next = at + offset; if (at < 0 || next < 0 || next >= draft.columns.length) return; [draft.columns[at], draft.columns[next]] = [draft.columns[next]!, draft.columns[at]!]; draft = { ...draft }; }
    function toggleColumn(id: string, checked: boolean) { if (!draft) return; draft.columns = checked ? [...draft.columns, id] : draft.columns.filter(field => field !== id); draft = { ...draft }; }
    function toggleCard(id: string, checked: boolean) { if (!draft) return; draft.cardFields = checked ? [...draft.cardFields, id] : draft.cardFields.filter(field => field !== id); draft = { ...draft }; }
    function toggleSelection(id: string, value: boolean) { selected = new Set(selected); if (value) selected.add(id); else selected.delete(id); }
    function edit(record: DesignEntity) {
        if (editing?.id === record.id && editing.path === record.path) return;
        const open = async () => { if (editing?.id === record.id) { editing = undefined; await tick(); } editing = record; };
        if (editor?.isDirty()) new DesignConfirm(service, tr('design_cancel_edit'), open).open(); else void open();
    }
    function moveSelected() {
        if (!movingTo || !selected.size || blocked) return;
        const ids = [...selected], target = movingTo;
        new DesignConfirm(service, word('Перенести выбранные записи в другую таблицу? Их ID и старые поля сохранятся. Обязательные поля нового типа должны быть заполнены.', 'Move these records to another table? Their IDs and old fields remain. Required destination fields must be filled.'), async () => {
            for (const id of ids) { await service.moveWorldRecord(id, target); selected = new Set([...selected].filter(value => value !== id)); }
            movingTo = ''; revision++;
        }).open();
    }
    async function moveCard(record: DesignEntity, value: string) {
        const field = type?.fields.find(field => field.id === view?.groupBy);
        if (!field || field.kind !== 'select' || blocked) return;
        await act(() => service.updateWorldValue(record.id, field.id, value || undefined, record.raw));
    }
    function drop(event: DragEvent, value: string) { event.preventDefault(); if (blocked) return; const id = event.dataTransfer?.getData('application/x-world-record') || dragId; const record = records.find(record => record.id === id); dragId = ''; if (record) void moveCard(record, value); }
    async function manualMove(record: DesignEntity, offset: number) {
        if (!view || view.sorts.length || search || view.filters.length) return;
        const order = records.map(record => record.id), at = order.indexOf(record.id), next = at + offset;
        if (next < 0 || next >= order.length) return;
        [order[at], order[next]] = [order[next]!, order[at]!];
        const current = clone(view); current.order = [...order, ...view.order.filter(id => !order.includes(id))];
        await act(() => service.saveWorldView(typeId, current));
    }
    async function reorderDataset(id: string, direction: number) { await act(() => service.updateWorld(registry => {
        const at = registry.datasets.findIndex(dataset => dataset.id === id), next = at + direction; if (next >= 0 && next < registry.datasets.length) [registry.datasets[at], registry.datasets[next]] = [registry.datasets[next]!, registry.datasets[at]!];
    })); }
    async function sortBy(id: string) { if (!view) return; const next = clone(view), current = next.sorts.find(sort => sort.field === id); next.sorts = current?.direction === 'desc' ? [] : [{ field: id, direction: current?.direction === 'asc' ? 'desc' : 'asc' }]; await act(() => service.saveWorldView(typeId, next, JSON.stringify(view))); }
    function resizeColumn(node: HTMLElement, id: string) {
        let end: (() => void) | undefined;
        const start = (event: PointerEvent) => {
            if (!view || blocked || busy) return; event.preventDefault(); event.stopPropagation();
            const cell = node.parentElement!, original = cell.getBoundingClientRect().width, x = event.clientX, next = clone(view), baseline = JSON.stringify(view), datasetId = typeId;
            const cells = Array.from(cell.closest('table')!.querySelectorAll('tr:not(.world-group-row)')).flatMap(row => { const target = row.children[(cell as HTMLTableCellElement).cellIndex] as HTMLElement | undefined; return target ? [{ target, width: target.style.width, min: target.style.minWidth, max: target.style.maxWidth }] : []; });
            const move = (event: PointerEvent) => { const width = Math.max(80, Math.min(600, Math.round(original + event.clientX - x))); for (const { target } of cells) target.style.width = target.style.minWidth = target.style.maxWidth = `${width}px`; next.widths = { ...next.widths, [id]: width }; };
            const finish = (event: PointerEvent) => { cleanup(); for (const { target, width, min, max } of cells) { target.style.width = width; target.style.minWidth = min; target.style.maxWidth = max; } if (event.type === 'pointerup') void act(() => service.saveWorldView(datasetId, next, baseline)); };
            const win = node.ownerDocument.defaultView!;
            const cleanup = () => { win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', finish); win.removeEventListener('pointercancel', finish); end = undefined; };
            end = cleanup; win.addEventListener('pointermove', move); win.addEventListener('pointerup', finish); win.addEventListener('pointercancel', finish);
        };
        node.addEventListener('pointerdown', start);
        return { destroy() { end?.(); node.removeEventListener('pointerdown', start); } };
    }
    function panelPosition(node: HTMLElement) {
        const update = () => node.parentElement?.style.setProperty('--world-config-top', `${node.offsetTop + node.offsetHeight + 6}px`);
        const observer = new ResizeObserver(update); observer.observe(node); if (node.parentElement) observer.observe(node.parentElement); update();
        return { destroy() { observer.disconnect(); } };
    }
    function close() { if (editing) editing = undefined; else if (onClose) onClose(); else focus = false; }
    onMount(() => { void service.initializeWorld().then(() => { ready = true; revision++; if (!typeId) chooseType(service.world!.datasets[0]?.id || ''); }).catch(reason => loadingError = String(reason)); });
    onDestroy(unsubscribe);
</script>

<div bind:this={workspace} class="world-workspace" class:design-fullscreen={focus} class:world-focused={focus} use:boardWorkspace={focus}>
    {#if !ready}<div class="design-empty" role="status">{loadingError || word('Загрузка таблиц мира…', 'Loading world tables…')}</div>
    {:else}
        <aside class="world-nav" class:world-nav-open={navigation} aria-label={word('Таблицы мира', 'World tables')}>
            <div class="world-nav-heading"><strong>{word('Мир игры', 'Game world')}</strong><button aria-label={tr('cancel')} class="world-nav-close" on:click={() => navigation = false}>×</button></div>
            {#each [...datasets.filter(dataset => dataset.favorite), ...datasets.filter(dataset => !dataset.favorite)] as data (data.id)}
                {@const table = service.settings.types.find(type => type.id === data.id)}
                {#if table}<div class="world-dataset" class:is-active={typeId === data.id} style:--dataset-color={table.color}>
                    <button class="world-dataset-open" on:click={() => chooseType(data.id)}><span use:icon={table.icon}></span><span>{table.name}</span><small>{refreshed(revision, service.index.all().filter(record => record.type === data.id).length)}</small></button>
                    <button disabled={blocked || busy} aria-label={word('Избранное', 'Favorite')} aria-pressed={data.favorite} on:click={() => void act(() => service.updateWorld(registry => { const dataset = registry.datasets.find(dataset => dataset.id === data.id)!; dataset.favorite = !dataset.favorite; }))}>{data.favorite ? '★' : '☆'}</button>
                    <button disabled={blocked || busy} aria-label={`${tr('design_up')} ${table.name}`} on:click={() => void reorderDataset(data.id, -1)}>↑</button><button disabled={blocked || busy} aria-label={`${tr('design_down')} ${table.name}`} on:click={() => void reorderDataset(data.id, 1)}>↓</button>
                </div>{/if}
            {/each}
            <button class="world-new-table" disabled={blocked} on:click={newTable}><span use:icon={'plus'}></span>{word('Новая таблица', 'New table')}</button>
            <small class="world-source-note">{word('Каждая запись — заметка вашего мира', 'Each record is a note in your world')}</small>
        </aside>
        <main class="world-main">
            {#if refreshed(revision, service.index.duplicates().length)}<p class="world-notice" role="alert">{tr('design_duplicate')}</p>{/if}
            <header class="world-heading"><button class="world-nav-toggle" aria-label={word('Таблицы мира', 'World tables')} on:click={() => navigation = !navigation}><span use:icon={'panel-left'}></span></button>
                {#if onClose}<button aria-label={tr('design_back')} on:click={onClose}>←</button>{/if}
                <span class="world-heading-icon" style:color={type?.color} use:icon={type?.icon || 'database'}></span><h2>{type?.name || word('Таблицы мира', 'World tables')}</h2>
                <button aria-label={tr(focus ? 'design_exit_fullscreen' : 'design_fullscreen')} aria-pressed={focus} on:click={() => focus = !focus}><span use:icon={focus ? 'minimize' : 'maximize'}></span></button>
            </header>
            {#if blocked}<p class="world-notice">{tr('design_read_only')}</p>{/if}
            {#if type && !view}<div class="design-empty"><p>{tr('design_not_found')}</p><button on:click={() => chooseType(typeId)}>{tr('design_back')}</button></div>{/if}
            {#if type && view}
                <nav class="world-views" aria-label={word('Представления', 'Views')}>
                    {#each dataset?.views || [] as saved (saved.id)}<button class:is-active={saved.id === view.id} on:click={() => chooseView(saved.id)}><span use:icon={saved.kind === 'table' ? 'table-2' : saved.kind === 'kanban' ? 'square-kanban' : 'layout-grid'}></span>{saved.name}</button>{/each}
                    <details bind:this={viewMenu}><summary aria-label={word('Новый вид', 'New view')}>+</summary><div class="world-popover">{#each ['table', 'kanban'] as kind}<button disabled={blocked} on:click={() => createView(kind as WorldViewKind)}>{kind === 'table' ? word('Таблица', 'Table') : word('Канбан', 'Kanban')}</button>{/each}</div></details>
                </nav>
                <div class="world-toolbar" use:panelPosition><input type="search" aria-label={tr('design_search')} placeholder={tr('design_search')} bind:value={search} on:input={() => limit = 100} /><span>{records.length}</span>
                    <button aria-expanded={configuring && configPanel === 'view'} on:click={() => configure()}><span use:icon={'sliders-horizontal'}></span>{word('Вид', 'View')}{view.filters.length ? ` · ${view.filters.length}` : ''}</button>
                    <button aria-pressed={view.filters.length > 0} on:click={() => configure('filters')}><span use:icon={'filter'}></span>{word('Фильтр', 'Filter')}{view.filters.length ? ` · ${view.filters.length}` : ''}</button>
                    <button aria-pressed={view.sorts.length > 0} on:click={() => configure('sorts')}><span use:icon={'arrow-up-down'}></span>{word('Сортировка', 'Sort')}</button>
                    <button on:click={() => configure('columns')}><span use:icon={'columns-3'}></span>{word('Столбцы', 'Columns')}</button>
                    <button on:click={() => configure('group')}><span use:icon={'layers'}></span>{word('Группы', 'Groups')}</button>
                    <button class="world-schema-action" disabled={blocked} on:click={() => new DesignSchemaModal(service, typeId).open()}>{word('Поля таблицы', 'Table fields')}</button>
                    {#if onPlaceView}<button class="world-place-action" disabled={blocked} on:click={() => onPlaceView?.(typeId, view!.id)}>{tr('design_place_on_board')}</button>{/if}
                    <button class="mod-cta" disabled={blocked} on:click={() => newRecord()}>{tr('design_new_record_label')}</button>
                </div>
                {#if error}<p class="design-warning" role="alert">{error}</p>{/if}
                {#if configuring && draft}<section class="world-config" aria-label={word('Настройки вида', 'View settings')}>
                    <div class="world-config-title"><strong>{configPanel === 'filters' ? word('Фильтры', 'Filters') : configPanel === 'sorts' ? word('Сортировка', 'Sort') : configPanel === 'columns' ? word('Столбцы', 'Columns') : configPanel === 'group' ? word('Группировка', 'Grouping') : word('Настройки вида', 'View settings')}</strong></div>
                    <fieldset disabled={blocked || busy}>
                        {#if configPanel === 'view'}<label>{tr('design_name')}<input bind:value={draft.name} /></label>
                        <label>{word('Представление', 'Layout')}<select bind:value={draft.kind}><option value="table">{word('Таблица', 'Table')}</option><option value="kanban">{word('Канбан', 'Kanban')}</option></select></label>
                        {/if}{#if configPanel === 'group'}<label>{word('Группировка', 'Group by')}<select bind:value={draft.groupBy}><option value="">—</option>{#each fields.filter(field => draft?.kind !== 'kanban' || field.kind === 'select') as field}<option value={field.id}>{field.name}</option>{/each}</select></label>
                        {/if}{#if configPanel === 'view' && draft.kind === 'kanban'}<label>{word('Обложка', 'Cover')}<select bind:value={draft.coverField}><option value="">—</option>{#each type.fields.filter(field => field.kind === 'image') as field}<option value={field.id}>{field.name}</option>{/each}</select></label>
                        {/if}{#if configPanel === 'columns'}<div class="world-config-columns"><strong>{word('Видимые поля и порядок', 'Visible fields and order')}</strong>
                            {#each [...draft.columns.filter(id => fields.some(field => field.id === id)), ...fields.map(field => field.id).filter(id => !draft?.columns.includes(id))] as id}
                                {@const field = fields.find(field => field.id === id)!}<div><label><input type="checkbox" checked={draft.columns.includes(id)} on:change={event => toggleColumn(id, event.currentTarget.checked)} />{field.name}</label><label>{word("Ширина", "Width")}<input type="number" min="80" max="600" aria-label={`${word("Ширина", "Width")} ${field.name}`} value={draft.widths?.[id] || 170} on:change={event => { draft!.widths = { ...draft!.widths, [id]: Number(event.currentTarget.value) }; draft = { ...draft! }; }} /></label><button aria-label={`${tr('design_up')} ${field.name}`} on:click={() => reorderColumn(id, -1)}>↑</button><button aria-label={`${tr('design_down')} ${field.name}`} on:click={() => reorderColumn(id, 1)}>↓</button><label><input type="checkbox" checked={draft.cardFields.includes(id)} on:change={event => toggleCard(id, event.currentTarget.checked)} />{word('На карточке', 'On card')}</label></div>
                            {/each}
                        </div>
                        {/if}{#if configPanel === 'filters' || configPanel === 'sorts'}<div class="world-config-rules">{#if configPanel === 'filters'}<strong>{word('Фильтры (все условия)', 'Filters (all conditions)')}</strong>
                            {#each draft.filters as filter, index}<div><select aria-label={word('Поле фильтра', 'Filter field')} bind:value={filter.field}>{#each fields as field}<option value={field.id}>{field.name}</option>{/each}</select><select aria-label={word('Условие', 'Condition')} bind:value={filter.op}><option value="contains">{word('содержит', 'contains')}</option><option value="eq">=</option><option value="neq">≠</option><option value="gt">&gt;</option><option value="lt">&lt;</option><option value="empty">{word('пусто', 'empty')}</option><option value="filled">{word('заполнено', 'filled')}</option></select><input aria-label={word('Значение фильтра', 'Filter value')} bind:value={filter.value} disabled={['empty', 'filled'].includes(filter.op)} /><button aria-label={tr('delete')} on:click={() => { draft!.filters = draft!.filters.filter((_, i) => i !== index); draft = { ...draft! }; }}>×</button></div>{/each}
                            <button on:click={() => { draft!.filters = [...draft!.filters, { field: 'title', op: 'contains', value: '' }]; draft = { ...draft! }; }}>+ {word('Фильтр', 'Filter')}</button>
                            {/if}{#if configPanel === 'sorts'}<strong>{word('Сортировка', 'Sort')}</strong>
                            {#each draft.sorts as sort, index}<div><select aria-label={word('Поле сортировки', 'Sort field')} bind:value={sort.field}>{#each fields as field}<option value={field.id}>{field.name}</option>{/each}</select><select aria-label={word('Направление', 'Direction')} bind:value={sort.direction}><option value="asc">↑</option><option value="desc">↓</option></select><button aria-label={tr('delete')} on:click={() => { draft!.sorts = draft!.sorts.filter((_, i) => i !== index); draft = { ...draft! }; }}>×</button></div>{/each}
                            <button on:click={() => { draft!.sorts = [...draft!.sorts, { field: 'title', direction: 'asc' }]; draft = { ...draft! }; }}>+ {word('Сортировка', 'Sort')}</button>
                        {/if}</div>{/if}
                        <div class="world-config-actions"><button class="mod-cta" on:click={() => void saveDraft()}>{tr('save')}</button>{#if configPanel === 'view'}<button disabled={(dataset?.views.length || 0) < 2} on:click={deleteView}>{word('Удалить вид', 'Delete view')}</button><div class="world-config-mobile-actions"><button on:click={() => { configuring = false; new DesignSchemaModal(service, typeId).open(); }}>{word('Поля таблицы', 'Table fields')}</button>{#if onPlaceView}<button on:click={() => { configuring = false; onPlaceView?.(typeId, view!.id); }}>{tr('design_place_on_board')}</button>{/if}</div>{/if}</div>
                    </fieldset><button on:click={() => configuring = false}>{tr('cancel')}</button>
                </section>{/if}
                {#if selected.size}<div class="world-bulk"><strong>{word('Выбрано', 'Selected')}: {selected.size}</strong><select aria-label={word('Перенести в таблицу', 'Move to table')} bind:value={movingTo} disabled={blocked}><option value="">{word('Перенести в таблицу…', 'Move to table…')}</option>{#each service.settings.types.filter(table => table.id !== typeId) as table}<option value={table.id}>{table.name}</option>{/each}</select><button disabled={!movingTo || blocked} on:click={moveSelected}>{word('Перенести', 'Move')}</button><button on:click={() => selected = new Set()}>×</button></div>{/if}
                <div class="world-body">
                    {#if view.kind === 'table'}
                        <table class="world-table"><thead><tr><th><input type="checkbox" aria-label={word('Выбрать все видимые', 'Select visible records')} disabled={blocked} checked={records.slice(0, limit).length > 0 && records.slice(0, limit).every(record => selected.has(record.id))} on:change={event => selected = event.currentTarget.checked ? new Set(records.slice(0, limit).map(record => record.id)) : new Set()} /></th>{#each columns as field}<th class:world-title-column={field.id === 'title'} style:width={`${view.widths?.[field.id] || 170}px`} style:min-width={`${view.widths?.[field.id] || 170}px`} style:max-width={`${view.widths?.[field.id] || 170}px`}><button disabled={blocked || busy} class="world-column-sort" aria-label={`${word("Сортировать", "Sort")} ${field.name}`} on:click={() => void sortBy(field.id)}><span use:icon={fieldIcon(field.kind)}></span>{field.name} {view.sorts.find(sort => sort.field === field.id)?.direction === "asc" ? "↑" : view.sorts.some(sort => sort.field === field.id) ? "↓" : ""}</button><span class="world-column-resize" use:resizeColumn={field.id} aria-hidden="true"></span></th>{/each}<th>{word('Действия', 'Actions')}</th></tr></thead><tbody>
                            {#each records.slice(0, limit) as record, index (record.path)}
                                {#if view.groupBy && (index === 0 || service.displayValue(record, view.groupBy) !== service.displayValue(records[index - 1]!, view.groupBy))}<tr class="world-group-row"><th colspan={columns.length + 2}><button aria-expanded={!collapsedGroups.has(groupName(record))} on:click={() => toggleGroup(groupName(record))}>{collapsedGroups.has(groupName(record)) ? '▸' : '▾'} {groupName(record)} <small>{records.filter(entry => groupName(entry) === groupName(record)).length}</small></button></th></tr>{/if}
                                {#if !view.groupBy || !collapsedGroups.has(groupName(record))}<tr data-world-record={record.id} data-record-path={record.path} class:is-selected={selected.has(record.id)}><td><input type="checkbox" aria-label={`${word('Выбрать', 'Select')} ${record.title}`} disabled={blocked} checked={selected.has(record.id)} on:change={event => toggleSelection(record.id, event.currentTarget.checked)} /></td>{#each columns as field}<td class:world-title-column={field.id === 'title'} style:width={`${view.widths?.[field.id] || 170}px`} style:min-width={`${view.widths?.[field.id] || 170}px`} style:max-width={`${view.widths?.[field.id] || 170}px`}><WorldField {service} {record} {field} readOnly={blocked || !service.index.resolve(record.id)} onNavigate={direction => void navigateCell(record.path, field.id, direction)} /></td>{/each}<td><div class="world-row-actions"><button aria-label={`${tr('design_edit')} ${record.title}`} on:click={() => edit(record)}>↗</button>{#if !view.sorts.length && !view.filters.length && !search}<button disabled={blocked || busy || index === 0} aria-label={`${tr('design_up')} ${record.title}`} on:click={() => void manualMove(record, -1)}>↑</button><button disabled={blocked || busy || index === records.length - 1} aria-label={`${tr('design_down')} ${record.title}`} on:click={() => void manualMove(record, 1)}>↓</button>{/if}</div></td></tr>{/if}
                            {/each}
                        </tbody><tfoot><tr><td></td>{#each columns as field}<td>{#if field.kind === 'number'}{@const summary = worldNumberSummary(records, field.id)}<span title={`${word('Среднее', 'Average')}: ${summary.average ?? '—'} · ${word('Заполнено', 'Filled')}: ${summary.count}`}>Σ {summary.count ? Number(summary.sum.toFixed(6)).toLocaleString(ru ? 'ru' : 'en') : '—'}</span>{:else if field.id === 'title'}<small>{word('Записей', 'Records')}: {records.length}</small>{/if}</td>{/each}<td></td></tr></tfoot></table><button class="world-add-row" disabled={blocked} on:click={() => newRecord()}>+ {tr('design_new_record_label')}</button>
                    {:else if view.kind === 'kanban'}
                        {#if !type.fields.some(field => field.id === view?.groupBy && field.kind === 'select')}<p class="world-notice">{word('Выбери поле типа «Список» в настройках вида для перемещения карточек.', 'Choose a single-select field in view settings to move cards.')}</p>{/if}
                        <div class="world-kanban">{#each groups as group}<section class="world-kanban-column" style:--group-color={group.color} aria-label={group.label} on:dragover|preventDefault on:drop={event => drop(event, group.value)}><header><strong>{group.label}</strong><small>{group.records.length}</small></header><button class="world-kanban-add" disabled={blocked} on:click={() => newRecord(view?.groupBy ? { [view.groupBy]: group.value || undefined } : {})}>+ {tr("design_new_record_label")}</button>
                            {#each group.records.slice(0, limit) as record (record.path)}<article class="world-card" data-world-record={record.id} draggable={!blocked && !busy} on:dragstart={event => { dragId = record.id; event.dataTransfer?.setData('application/x-world-record', record.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }} on:dragend={() => dragId = ''}>
                                {#if view.coverField && service.image(String(record.values[view.coverField] || ''))}<img class="world-cover" src={service.image(String(record.values[view.coverField]))} alt="" loading="lazy" />{/if}
                                <button class="world-card-title" on:click={() => edit(record)}>{record.title}</button>
                                {#each view.cardFields.filter(id => id !== 'title' && id !== view?.groupBy && service.displayValue(record, id)) as id}{@const field = fields.find(field => field.id === id)}{#if field}<div class="world-card-field"><small>{field.name}</small><WorldField {service} {record} {field} readOnly={blocked || !service.index.resolve(record.id)} /></div>{/if}{/each}
                                <select aria-label={`${word('Колонка', 'Column')} ${record.title}`} disabled={blocked || busy || !type.fields.some(field => field.id === view?.groupBy && field.kind === 'select')} value={group.value} on:change={event => void moveCard(record, event.currentTarget.value)}>{#each groups as destination}<option value={destination.value}>{destination.label}</option>{/each}</select>
                            </article>{/each}
                            {#if group.records.length > limit}<button on:click={() => limit += 100}>{word('Показать ещё', 'Show more')}</button>{/if}
                        </section>{/each}</div>
                    {/if}
                    {#if !records.length}<div class="design-empty"><p>{search || view.filters.length ? word('Нет записей по выбранным условиям.', 'No records match these conditions.') : tr('design_empty')}</p><button disabled={blocked} on:click={() => newRecord()}>{tr('design_create')}</button></div>{/if}
                    {#if view.kind !== 'kanban' && records.length > limit}<button class="world-load-more" on:click={() => limit += 100}>{word('Показать ещё', 'Show more')} · {records.length - limit}</button>{/if}
                </div>
            {/if}
        </main>
        {#if editing}<aside class="world-record-panel" aria-label={tr('design_edit')}>
            {#key editing.id}<EntityEditor bind:this={editor} {service} entity={editing} readOnly={blocked} onSaved={entity => { editing = entity; revision++; }} onClose={() => editing = undefined} />{/key}
            {#key editing.id}<WorldTaskLink {service} record={editing} readOnly={blocked} canCreate={() => !editor?.isDirty()} onSaved={entity => { if (!editor?.isDirty()) { editing = entity; editor?.refresh(entity); } revision++; }} />{/key}
            {#if !blocked}<button class="design-delete-note" on:click={() => new DesignConfirm(service, tr('design_delete_entity'), async () => { await service.deleteEntity(editing!); editing = undefined; }).open()}>{tr('design_delete_note')}</button>{/if}
        </aside>{/if}
    {/if}
</div>
