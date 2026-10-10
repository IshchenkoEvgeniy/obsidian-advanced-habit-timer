<script lang="ts">
    import { tick, onDestroy } from 'svelte';
    import type { DesignService } from '../service';
    import type { DesignEntity, DesignField } from '../types';
    export let service: DesignService;
    export let record: DesignEntity;
    export let field: DesignField;
    export let readOnly = false;
    export let onNavigate: ((direction: 'next' | 'previous' | 'up' | 'down') => void) | undefined = undefined;
    export let onEditState: (editing: boolean) => void = () => undefined;
    let editing = false, saving = false, error = '', draft: unknown, expected = '';
    let root: HTMLDivElement;
    let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
    $: onEditState(editing);
    onDestroy(() => onEditState(false));
    $: text = field.id === 'title' ? record.title : service.displayValue(record, field.id);
    $: chips = field.kind === 'select' || field.kind === 'multiselect' ? (Array.isArray(record.values[field.id]) ? record.values[field.id] as string[] : record.values[field.id] ? [String(record.values[field.id])] : []).map(value => ({ value, option: field.options?.find(option => option.value === value) })) : [];
    async function start() {
        if (readOnly || field.kind === 'status') return;
        expected = record.raw; draft = field.id === 'title' ? record.title : record.values[field.id] ?? (field.kind === 'multiselect' ? [] : '');
        editing = true; error = ''; await tick(); input?.focus();
    }
    async function commit() {
        if (saving || !editing || readOnly) return false;
        let value = draft;
        if (field.kind === 'number') value = draft === '' ? undefined : Number(draft);
        const previous = field.id === 'title' ? record.title : record.values[field.id];
        if (JSON.stringify(value) === JSON.stringify(previous) || (value === '' && previous == null)) { editing = false; return true; }
        saving = true; error = '';
        try { await service.updateWorldValue(record.id, field.id, value, expected); editing = false; return true; }
        catch (reason) { error = reason instanceof Error && reason.message.startsWith('design_') ? service.tr(reason.message as 'design_conflict') : String(reason); return false; }
        finally { saving = false; }
    }
    function key(event: KeyboardEvent) {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); editing = false; void tick().then(() => root?.querySelector<HTMLButtonElement>('.world-cell-value')?.focus()); }
        if (event.key === 'Enter' && field.kind !== 'longtext' && field.kind !== 'multiselect') { event.preventDefault(); void commit(); }
        if (event.key === 'Tab') { event.preventDefault(); void commit().then(async saved => { if (saved) { await tick(); moveFocus(event.shiftKey ? 'previous' : 'next'); } }); }
    }
    function leave(event: FocusEvent) {
        // Replacing the focused display button with an input also emits focusout.
        if (!editing || event.target !== input) return;
        const next = event.relatedTarget;
        if (!(next && 'nodeType' in next && root.contains(next as Node)) && !error) void commit();
    }
    function moveFocus(direction: 'next' | 'previous' | 'up' | 'down') {
        if (onNavigate) { onNavigate(direction); return; }
        const container = root?.closest('.world-card, .design-item');
        const fields = Array.from(container?.querySelectorAll<HTMLElement>('.world-cell') || []), index = fields.indexOf(root);
        const step = direction === 'previous' || direction === 'up' ? -1 : 1;
        for (let i = index + step; i >= 0 && i < fields.length; i += step) {
            const button = fields[i]!.querySelector<HTMLButtonElement>('.world-cell-value');
            if (button && !button.disabled) { button.focus(); return; }
        }
        root?.querySelector<HTMLButtonElement>('.world-cell-value')?.focus();
    }
    function navigate(event: KeyboardEvent) {
        const direction = ({ ArrowLeft: 'previous', ArrowRight: 'next', ArrowUp: 'up', ArrowDown: 'down' } as const)[event.key as 'ArrowLeft'];
        if (direction) { event.preventDefault(); moveFocus(direction); }
    }
    function copyCell(event: ClipboardEvent) {
        if (editing || !root?.contains(root.ownerDocument.activeElement)) return;
        event.preventDefault(); event.stopPropagation(); event.clipboardData?.setData('text/plain', text || '');
    }
    async function pasteCell(event: ClipboardEvent) {
        if (editing || readOnly || !['text', 'longtext', 'number'].includes(field.kind)) return;
        const value = event.clipboardData?.getData('text/plain'); if (value === undefined) return;
        event.preventDefault(); event.stopPropagation(); expected = record.raw; draft = value; editing = true; error = '';
        await tick(); input?.focus();
    }
</script>

<div bind:this={root} class="world-cell" class:world-cell-editing={editing} data-world-field={field.id} on:focusout={leave} on:copy={copyCell} on:paste={pasteCell}>
    {#if editing}
        <fieldset disabled={readOnly} class="world-editor-fields">
        {#if field.kind === 'longtext'}<textarea bind:this={input} bind:value={draft} aria-label={field.name} disabled={saving} on:keydown={key}></textarea>
        {:else if field.kind === 'checkbox'}<input bind:this={input} type="checkbox" checked={Boolean(draft)} aria-label={field.name} disabled={saving} on:change={event => { draft = event.currentTarget.checked; void commit(); }} on:keydown={key} />
        {:else if ['select', 'multiselect', 'entity', 'task'].includes(field.kind)}
            <select bind:this={input} multiple={field.kind === 'multiselect'} value={draft} aria-label={field.name} disabled={saving} on:keydown={key} on:change={event => { draft = field.kind === 'multiselect' ? Array.from(event.currentTarget.selectedOptions).map(option => option.value) : event.currentTarget.value; if (field.kind !== 'multiselect') void commit(); }}>
                {#if field.kind !== 'multiselect'}<option value="">—</option>{/if}
                {#if field.kind === 'entity'}
                    {#if draft && !service.index.resolve(String(draft))}<option value={String(draft)}>{service.tr('design_not_found')} · {String(draft)}</option>{/if}
                    {#each service.index.all().filter(entity => !field.targetType || entity.type === field.targetType) as entity}<option value={entity.id}>{entity.title}</option>{/each}
                {:else if field.kind === 'task'}
                    {#if draft && !service.tasks.some(task => task.id === draft)}<option value={String(draft)}>{service.tr('design_not_found')}</option>{/if}
                    {#each service.tasks as task}<option value={task.id}>{service.taskText(task.id)}</option>{/each}
                {:else}
                    {#if field.kind === 'select' && draft && !field.options?.some(option => option.value === draft)}<option value={String(draft)}>{String(draft)}</option>{/if}
                    {#each field.options || [] as option}<option value={option.value}>{service.optionLabel(option)}</option>{/each}
                {/if}
            </select>
        {:else}<input bind:this={input} type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'} value={String(draft ?? '')} min={field.min} max={field.max} step={field.step ?? 'any'} aria-label={field.name} disabled={saving} on:input={event => draft = event.currentTarget.value} on:keydown={key} />{/if}
        <div class="world-cell-actions"><button disabled={saving} type="button" aria-label={service.tr('save')} on:click={() => void commit()}>✓</button><button disabled={saving} type="button" aria-label={service.tr('cancel')} on:click={() => editing = false}>×</button></div>
        {#if error}<small class="design-warning" role="alert">{error}</small>{/if}
        </fieldset>
    {:else}<button class="world-cell-value" class:world-title-value={field.id === 'title'} class:is-empty={!text} type="button" disabled={readOnly || field.kind === 'status'} aria-label={`${field.name}: ${text || '—'}`} title={field.kind === 'status' ? service.tr('design_readonly') : text} on:click={start} on:keydown={navigate}>
        {#if chips.length}<span class="world-chips">{#each chips as chip}<span class="world-chip" style:--chip-color={chip.option?.color || '#94a3b8'}>{chip.option ? service.optionLabel(chip.option) : chip.value}</span>{/each}</span>
        {:else if field.kind === 'checkbox'}<span class="world-boolean" class:is-checked={Boolean(record.values[field.id])}>{record.values[field.id] ? '✓' : ''}</span>
        {:else if field.kind === 'image' && service.image(String(record.values[field.id] || ''))}<img class="world-cell-image" src={service.image(String(record.values[field.id]))} alt={text} loading="lazy" />
        {:else}{#if text && ['entity', 'task'].includes(field.kind)}<span class="world-relation-mark" aria-hidden="true">↗</span>{/if}{text || '—'}{/if}
    </button>
        {#if field.kind === 'task' && service.tasks.some(task => task.id === record.values[field.id])}<button type="button" aria-label={service.plugin.settings.language === 'ru' ? 'Открыть задачу разработки' : 'Open development task'} on:click={() => void service.openTask(String(record.values[field.id])).catch(error => service.report(error))}>↗</button>{/if}
    {/if}
</div>
