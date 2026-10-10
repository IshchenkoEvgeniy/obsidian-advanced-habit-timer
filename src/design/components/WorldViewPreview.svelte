<script lang="ts">
    import { onDestroy, tick } from 'svelte';
    import { setIcon } from 'obsidian';
    import type { DesignService } from '../service';
    import type { DesignEntity, DesignField } from '../types';
    import { queryWorld, kanbanColumns, worldFields, worldCreationDefaults } from '../world-views';
    import { NewDesignEntityModal, DesignEntityModal } from '../modals';
    import { canvasScroll } from '../canvas-scroll';
    import WorldField from './WorldField.svelte';
    export let service: DesignService;
    export let reference: { typeId: string; viewId: string };
    export let dataVersion = 0, zoom = 1;
    export let compact = false, readOnly = false, interacting = true;
    export let onOpen: () => void;
    export let onChangeView: (viewId: string) => void = () => undefined;
    let root: HTMLDivElement, pane: HTMLDivElement, search = '', localVersion = 0, limit = 30, busy = false, error = '';
    let activeEditors = new Set<string>();
    let dragRecord: { id: string; raw: string } | undefined;
    const word = (ru: string, en: string) => service.plugin.settings.language === 'ru' ? ru : en;
    const icon = (node: HTMLElement, name: string) => { setIcon(node, name); };
    function refreshed<T>(_version: number, value: T) { return value; }
    const unsubscribe = service.subscribe(() => localVersion++); onDestroy(unsubscribe);
    $: version = dataVersion + localVersion;
    $: type = refreshed(version, service.settings.types.find(type => type.id === reference.typeId));
    $: dataset = refreshed(version, service.world?.datasets.find(dataset => dataset.id === reference.typeId));
    $: view = dataset?.views.find(view => view.id === reference.viewId);
    $: records = refreshed(version, type && view ? queryWorld(service.index.all(), type, view, search, (record, field) => service.displayValue(record, field)) : []);
    $: fields = type && view ? view.columns.map(id => worldFields(type!).find(field => field.id === id)).filter((field): field is DesignField => Boolean(field)) : [];
    $: cardFields = type && view ? view.cardFields.map(id => worldFields(type!).find(field => field.id === id)).filter((field): field is DesignField => Boolean(field) && field!.id !== 'title' && field!.id !== view!.groupBy) : [];
    $: groupField = type?.fields.find(field => field.id === view?.groupBy);
    $: columns = kanbanColumns(records, groupField, service.optionLabel.bind(service));
    $: shown = records.slice(0, limit);
    $: titleField = { id: 'title', name: service.tr('design_name'), kind: 'text' } as DesignField;
    $: detailed = !compact || activeEditors.size > 0;
    function editor(key: string, editing: boolean) {
        if (activeEditors.has(key) === editing) return;
        activeEditors = new Set(activeEditors); if (editing) activeEditors.add(key); else activeEditors.delete(key);
    }
    async function navigate(id: string, field: string, direction: 'next' | 'previous' | 'up' | 'down') {
        let r = shown.findIndex(record => record.id === id), c = fields.findIndex(candidate => candidate.id === field);
        const step = () => { if (direction === 'up' || direction === 'down') r += direction === 'up' ? -1 : 1; else { c += direction === 'previous' ? -1 : 1; if (c < 0) { r--; c = fields.length - 1; } if (c >= fields.length) { r++; c = 0; } } };
        step(); await tick();
        while (shown[r] && fields[c]) {
            const row = Array.from(root.querySelectorAll<HTMLElement>('tr[data-record-path]')).find(node => node.dataset.recordPath === shown[r]!.path);
            const button = row?.querySelector<HTMLButtonElement>(`[data-world-field="${CSS.escape(fields[c]!.id)}"] .world-cell-value`);
            if (button && !button.disabled) { button.focus(); return; } step();
        }
    }
    async function changeView(value: string) { search = ''; limit = 30; onChangeView(value); await tick(); if (pane) { pane.scrollLeft = 0; pane.scrollTop = 0; } }
    function create(value?: string) {
        if (!type || !view || readOnly || !interacting) return;
        const defaults = worldCreationDefaults(type, view), extra = value !== undefined && groupField?.kind === 'select' ? { [groupField.id]: value || undefined } : {};
        new NewDesignEntityModal(service, () => localVersion++, false, type.id, { ...defaults.values, ...extra }, defaults.title).open();
    }
    function open(record: DesignEntity) { new DesignEntityModal(service, service.index.resolve(record.id) || record, readOnly).open(); }
    function beginDrag(event: DragEvent, record: DesignEntity) {
        if (readOnly || !interacting || groupField?.kind !== 'select') { event.preventDefault(); return; }
        dragRecord = { id: record.id, raw: record.raw };
        event.stopPropagation(); event.dataTransfer?.setData('application/x-world-canvas-record', JSON.stringify({ id: record.id, type: record.type, raw: record.raw }));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    }
    function dragOver(event: DragEvent) { if (!readOnly && interacting && groupField?.kind === 'select' && event.dataTransfer?.types.includes('application/x-world-canvas-record')) { event.preventDefault(); event.stopPropagation(); } }
    async function drop(event: DragEvent, value: string) {
        if (!event.dataTransfer?.types.includes('application/x-world-canvas-record')) return;
        event.preventDefault(); event.stopPropagation();
        if (readOnly || !interacting || busy || groupField?.kind !== 'select') return;
        try {
            const data = JSON.parse(event.dataTransfer.getData('application/x-world-canvas-record')), record = service.index.resolve(data.id);
            if (!record || record.type !== reference.typeId) return;
            busy = true; error = ''; await service.updateWorldValue(record.id, groupField.id, value || undefined, dragRecord?.id === record.id ? dragRecord.raw : data.raw);
        } catch (reason) { error = String(reason); }
        finally { busy = false; dragRecord = undefined; }
    }
</script>

<div bind:this={root} class="design-world-preview design-world-widget" class:design-widget-passive={!interacting} use:canvasScroll={{ enabled: interacting, zoom }}>
    <div class="design-widget-heading" title={word('Перетащи заголовок, чтобы переместить представление', 'Drag the header to move the view')}>
        <span class="design-widget-grip" use:icon={'grip-vertical'}></span><strong>{type?.name || reference.typeId}</strong><small>{records.length}</small>
        <button class="design-widget-icon" aria-label={word('Открыть таблицу полностью', 'Open full table')} title={word('Открыть таблицу полностью', 'Open full table')} on:click|stopPropagation={onOpen} disabled={!view}><span use:icon={'maximize-2'}></span></button>
    </div>
    {#if view}
        {#if detailed}
            <div class="design-world-widget-toolbar design-widget-body" data-canvas-interactive>
                <select aria-label={word('Вид записей на доске', 'Canvas record view')} value={view.id} disabled={readOnly || !interacting} on:change={event => void changeView(event.currentTarget.value)}>{#each dataset?.views || [] as candidate}<option value={candidate.id}>{candidate.name}</option>{/each}</select>
                <input type="search" aria-label={word('Поиск записей в карточке', 'Search widget records')} placeholder={service.tr('design_search')} bind:value={search} />
            </div>
            <div bind:this={pane} class="design-world-widget-scroll design-widget-body" data-canvas-interactive>
                {#if view.kind === 'kanban'}
                    <div class="design-world-preview-kanban">
                        {#each columns as column}<section class="design-world-preview-lane" aria-label={column.label} data-world-column={column.value} style:--lane-color={column.color} on:dragover={dragOver} on:drop={event => void drop(event, column.value)}>
                            <header><strong>{column.label}</strong><small>{column.records.length}</small></header>
                            {#if !readOnly}<button class="design-world-lane-add" disabled={busy} aria-label={`${service.tr('design_new_record_label')}: ${column.label}`} on:click={() => create(column.value)}>+</button>{/if}
                            {#each column.records.filter(record => shown.includes(record)) as record (record.path)}<article class="world-card" data-world-record={record.id}>
                                <div class="design-world-record-actions"><button class="design-widget-icon" draggable={!readOnly && groupField?.kind === 'select'} disabled={readOnly || groupField?.kind !== 'select'} aria-label={`${word('Перенести запись', 'Move record')}: ${record.title}`} on:dragstart={event => beginDrag(event, record)} on:dragend={() => dragRecord = undefined}><span use:icon={'grip-vertical'}></span></button><button class="design-widget-icon" aria-label={`${word('Открыть запись', 'Open record')}: ${record.title}`} on:click={() => open(record)}>↗</button></div>
                                <WorldField {service} {record} field={titleField} readOnly={readOnly || !interacting} onEditState={editing => editor(record.path + ':title', editing)} />
                                {#each cardFields as field (field.id)}<div class="world-card-field"><small>{field.name}</small><WorldField {service} {record} {field} readOnly={readOnly || !interacting} onEditState={editing => editor(record.path + ':' + field.id, editing)} /></div>{/each}
                                {#if groupField?.kind === 'select'}<div class="world-card-field"><small>{groupField.name}</small><WorldField {service} {record} field={groupField} readOnly={readOnly || busy || !interacting} onEditState={editing => editor(record.path + ':' + groupField!.id, editing)} /></div>{/if}
                            </article>{/each}
                        </section>{/each}
                    </div>
                {:else}
                    <table class="world-table"><thead><tr>{#each fields as field}<th style:width={`${view.widths?.[field.id] || (field.id === 'title' ? 160 : 120)}px`}>{field.name}</th>{/each}<th></th></tr></thead><tbody>
                        {#each shown as record (record.path)}<tr data-record-path={record.path} data-world-record={record.id}>
                            {#each fields as field (field.id)}<td><WorldField {service} {record} {field} readOnly={readOnly || !interacting} onNavigate={direction => void navigate(record.id, field.id, direction)} onEditState={editing => editor(record.path + ':' + field.id, editing)} /></td>{/each}
                            <td><button class="design-widget-icon" aria-label={`${word('Открыть запись', 'Open record')}: ${record.title}`} on:click={() => open(record)}>↗</button></td>
                        </tr>{/each}
                    </tbody></table>
                {/if}
                {#if !records.length}<p class="design-widget-empty">{word('Нет записей по выбранным условиям', 'No records match these conditions')}</p>{/if}
                {#if records.length > limit}<button class="design-world-show-more" on:click={() => limit += 30}>{word('Показать ещё', 'Show more')} ({records.length - limit})</button>{/if}
            </div>
            {#if !readOnly}<button class="design-world-widget-add design-widget-body" on:click={() => create()}>+ {service.tr('design_new_record_label')}</button>{/if}
        {:else}<div class="design-widget-summary"><small>{view.name} · {records.length}</small>{#each records.slice(0, 4) as record}<div>{record.title}</div>{/each}</div>{/if}
    {:else}<small class="design-widget-empty">{service.tr('design_not_found')}</small>{/if}
    {#if error}<small class="design-warning" role="alert">{error}</small>{/if}
</div>
