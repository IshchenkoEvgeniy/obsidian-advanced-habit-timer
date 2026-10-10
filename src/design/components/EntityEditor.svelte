<script lang="ts">
    import { Component, MarkdownRenderer, TFile } from 'obsidian';
    import type { DesignService } from '../service';
    import { clone, DesignError, type DesignEntity } from '../types';
    import { longValue, replaceLongValue } from '../markdown';
    export let service: DesignService;
    export let entity: DesignEntity | undefined = undefined;
    export let onSaved: (entity: DesignEntity, add: boolean) => void;
    export let onClose: () => void;
    export let currentBoard = false;
    export let initialType = '';
    export let readOnly = false;
    export let initialValues: Record<string, unknown> = {};
    export let initialTitle = '';
    let typeId = entity?.type || initialType || service.settings.types[0]?.id || '';
    let title = entity?.title || initialTitle;
    let values: Record<string, unknown> = clone(entity?.values || initialValues);
    let body = entity?.body || '';
    let add = currentBoard, preview = false, saving = false, error = '', conflict = false;
    let confirmingClose = false;
    const draft = () => JSON.stringify([typeId, title, values, body]);
    let baseline = draft();
    export function isDirty() { return draft() !== baseline; }
    function requestClose() { if (isDirty() && !readOnly) confirmingClose = true; else onClose(); }
    const tr = service.tr.bind(service);
    $: type = service.settings.types.find(type => type.id === typeId);
    export function refresh(latest: DesignEntity) { if (saving || draft() !== baseline) return; entity = latest; typeId = latest.type; title = latest.title; values = clone(latest.values); body = latest.body; baseline = draft(); conflict = false; error = ''; }
    function setValue(id: string, value: unknown) { values = { ...values, [id]: value }; const field = type?.fields.find(field => field.id === id); if (field?.kind === 'longtext') body = replaceLongValue(body, field.name, String(value || ''), field.id); }
    function updateBody(value: string) { body = value; for (const field of type?.fields.filter(field => field.kind === 'longtext') || []) values[field.id] = longValue(body, field.name, field.id); values = { ...values }; }
    async function save() {
        if (saving || readOnly) return; saving = true; error = '';
        try { const result = entity ? await service.saveEntity({ ...entity, values, body }, title) : await service.createEntity(typeId, title, values, body); entity = result; title = result.title; values = clone(result.values); body = result.body; baseline = draft(); conflict = false; onSaved(result, add); }
        catch (e) { conflict = e instanceof DesignError && e.key === 'design_conflict'; error = e instanceof DesignError ? `${tr(e.key)}${e.detail ? ': ' + e.detail : ''}` : String(e); }
        finally { saving = false; }
    }
    async function resolveConflict(local: boolean) {
        if (!entity) return;
        const path = service.index.resolve(entity.id)?.path || entity.path, file = service.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) { error = tr('design_not_found'); return; }
        await service.refreshFile(file); const latest = service.index.resolve(entity.id); if (!latest) { error = tr('design_not_found'); return; }
        entity = latest;
        if (local) { conflict = false; await save(); }
        else { title = latest.title; values = clone(latest.values); body = latest.body; typeId = latest.type; baseline = draft(); conflict = false; error = ''; }
    }
    /** A new record of the same type with this record's values and body (L20). */
    async function similar() {
        if (!entity || saving || readOnly) return; saving = true; error = '';
        try { const copy = await service.createEntity(typeId, `${title} (${tr('design_copy')})`, clone(values), body); onSaved(copy, false); }
        catch (e) { error = e instanceof DesignError ? `${tr(e.key)}${e.detail ? ': ' + e.detail : ''}` : String(e); }
        finally { saving = false; }
    }
    function renderMarkdown(node: HTMLElement, text: string) {
        const owner = new Component(); owner.load(); let generation = 0;
        const render = (value: string) => { const serial = ++generation; const container = document.createElement('div'); void MarkdownRenderer.render(service.plugin.app, value, container, entity?.path || service.settings.root, owner).then(() => { if (serial === generation) node.replaceChildren(container); }); };
        render(text); return { update: render, destroy() { generation++; owner.unload(); } };
    }
</script>

<form class="design-editor" on:submit|preventDefault={save}>
    <div class="design-editor-heading"><h3>{entity ? tr('design_edit') : tr('design_new_record_label')}</h3><button type="button" on:click={requestClose} aria-label={tr('cancel')}>×</button></div>
    {#if confirmingClose}<div class="design-warning" role="alert">{tr('design_cancel_edit')}<button type="button" on:click={onClose}>{tr('design_confirm')}</button><button type="button" on:click={() => confirmingClose = false}>{tr('cancel')}</button></div>{/if}
    <fieldset disabled={readOnly} class="world-editor-fields">
    <label>{tr('design_name')}<input bind:value={title} required /></label>
    <label>{tr('design_type')}<select bind:value={typeId} disabled={Boolean(entity)} on:change={() => { values = {}; }}>
        {#if entity && !type}<option value={typeId}>{tr('design_untyped')}</option>{/if}
        {#each service.settings.types as type}<option value={type.id}>{type.name}</option>{/each}
    </select></label>
    {#if !type}<p class="design-warning">{tr('design_no_type_warning')}</p>{/if}
    {#each type?.fields || [] as field (field.id)}
        <label>{field.name}{field.required ? ' *' : ''}
            {#if field.kind === 'longtext'}<textarea rows="3" value={String(values[field.id] ?? '')} on:input={event => setValue(field.id, event.currentTarget.value)}></textarea>
            {:else if field.kind === 'checkbox'}<input type="checkbox" checked={Boolean(values[field.id])} on:change={event => setValue(field.id, event.currentTarget.checked)} />
            {:else if field.kind === 'select' || field.kind === 'multiselect'}
                <select multiple={field.kind === 'multiselect'} value={field.kind === 'multiselect' ? (Array.isArray(values[field.id]) ? values[field.id] : []) : String(values[field.id] ?? '')} on:change={event => setValue(field.id, field.kind === 'multiselect' ? Array.from(event.currentTarget.selectedOptions).map(option => option.value) : event.currentTarget.value)}>
                    {#if field.kind === 'select'}<option value="">—</option>{#if values[field.id] && !field.options?.some(option => option.value === values[field.id])}<option value={String(values[field.id])}>{String(values[field.id])}</option>{/if}{/if}{#each field.options || [] as option}<option value={option.value}>{service.optionLabel(option)}</option>{/each}
                </select>
            {:else if field.kind === 'entity'}<select value={String(values[field.id] || '')} on:change={event => setValue(field.id, event.currentTarget.value)}><option value="">—</option>
                {#if values[field.id] && !service.index.resolve(String(values[field.id]))}<option value={String(values[field.id])}>{tr('design_not_found')}</option>{/if}
                {#each service.index.all().filter(record => !field.targetType || record.type === field.targetType) as record}<option value={record.id}>{record.title}</option>{/each}</select>
            {:else if field.kind === 'task'}<select value={String(values[field.id] || '')} on:change={event => setValue(field.id, event.currentTarget.value)}><option value="">—</option>
                {#if values[field.id] && !service.tasks.some(task => task.id === values[field.id])}<option value={String(values[field.id])}>{tr('design_not_found')}</option>{/if}
                {#each service.tasks as task}<option value={task.id}>{service.taskText(task.id)}</option>{/each}</select>
            {:else if field.kind === 'status'}<input readonly value={service.displayValue({ id: '', type: typeId, path: '', title, raw: '', body, ...entity, values }, field.id)} title={tr('design_readonly')} />
            {:else if field.kind === 'number'}<input type="number" value={values[field.id] as number} min={field.min} max={field.max} step={field.step || 'any'} on:input={event => setValue(field.id, event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value))} />
            {:else if field.kind === 'date'}<input type="date" value={String(values[field.id] || '')} on:input={event => setValue(field.id, event.currentTarget.value)} />
            {:else}<input value={String(values[field.id] || '')} on:input={event => setValue(field.id, event.currentTarget.value)} />{/if}
        </label>
    {/each}
    <div class="design-inline"><span>{tr('design_body')}</span><button type="button" on:click={() => preview = !preview}>{tr(preview ? 'design_edit' : 'design_preview')}</button></div>
    {#if preview}<div class="design-markdown" use:renderMarkdown={body}></div>{:else}<textarea class="design-note-body" rows="10" value={body} on:input={event => updateBody(event.currentTarget.value)}></textarea>{/if}
    {#if !entity && currentBoard}<label class="design-inline"><input type="checkbox" bind:checked={add} />{tr('design_add_current')}</label>{/if}
    {#if error}<p class="design-warning" role="alert">{error}</p>{/if}
    {#if conflict}<div class="design-inline"><button type="button" on:click={() => void resolveConflict(false).catch(e => service.report(e))}>{tr('design_reload')}</button><button type="button" on:click={() => void resolveConflict(true).catch(e => service.report(e))}>{tr('design_keep_local')}</button></div>{/if}
    <div class="design-inline"><button class="mod-cta" type="submit" disabled={saving || !title.trim() || !typeId}>{tr(saving ? 'design_saving' : 'save')}</button>
        {#if entity}<button type="button" on:click={() => { const file = service.plugin.app.vault.getAbstractFileByPath(entity!.path); if (file instanceof TFile) void service.plugin.app.workspace.getLeaf('tab').openFile(file); }}>{tr('design_open_note')}</button>{/if}
        {#if entity}<button type="button" on:click={() => void similar()}>{tr('design_similar_record')}</button>{/if}
    </div>
    </fieldset>
</form>
