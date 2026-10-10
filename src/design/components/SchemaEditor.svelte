<script lang="ts">
    import type { DesignService } from '../service';
    import { FIELD_KINDS, clone, uid, DesignError, type DesignSettings, type DesignType, type DesignField } from '../types';
    import type { TranslationKey } from '../../i18n';
    export let service: DesignService;
    export let onClose: () => void;
    export let initialType = '';
    let schema: DesignSettings = clone(service.settings), selected = initialType || schema.types[0]?.id || '', error = '', importText = '', importing = false, busy = false;
    let confirmType = '';
    const expectedTypes = JSON.stringify(schema.types);
    const tr = service.tr.bind(service);
    $: type = schema.types.find(type => type.id === selected);
    function update() { schema = { ...schema }; }
    function move<T>(items: T[], index: number, direction: number) { const next = index + direction; if (next < 0 || next >= items.length) return; [items[index], items[next]] = [items[next]!, items[index]!]; update(); }
    function addType() { const type: DesignType = { id: 'type_' + uid(), name: tr('design_add_type'), folder: tr('design_add_type') + '-' + schema.types.length, color: '#8b5cf6', icon: 'file', fields: [] }; schema.types.push(type); selected = type.id; update(); }
    function addField(type: DesignType) { type.fields.push({ id: 'field_' + uid(), name: tr('design_add_field'), kind: 'text', card: true }); update(); }
    async function save() { busy = true; error = ''; try { await service.saveSchema(importing ? JSON.parse(importText) : schema, expectedTypes); onClose(); } catch (e) { error = e instanceof DesignError ? `${tr(e.key)}${e.detail ? ': ' + e.detail : ''}` : e instanceof Error ? e.message : String(e); } finally { busy = false; } }
    function options(field: DesignField, text: string) { field.options = text.split('\n').filter(line => line.trim()).map(line => { const pieces = line.split('|'), value = pieces[0]!.trim(); return { value, color: pieces[1]?.trim() || '#8b5cf6', labelKey: field.options?.find(option => option.value === value)?.labelKey }; }); update(); }
</script>
<div class="design-schema">
    <div class="design-inline"><h2>{tr('design_schema')}</h2><button on:click={() => { importing = !importing; }}>{tr('design_import')}</button><button on:click={() => void service.exportSchema().catch(e => service.report(e))}>{tr('design_export')}</button></div>
    {#if importing}<label>{tr('design_import_hint')}<textarea rows="20" bind:value={importText}></textarea></label>
    {:else}
        <label>{tr('design_root')}<input bind:value={schema.root} /></label>
        <label>{tr('design_project')}<select bind:value={schema.projectId}><option value="">{tr('design_auto')}</option>{#each service.plugin.settings.projectScopes as project}<option value={project.id}>{project.name}</option>{/each}</select></label>
        <div class="design-schema-columns"><div class="design-type-list">
            {#each schema.types as item, index (item.id)}<div class="design-inline"><button class:mod-cta={selected === item.id} on:click={() => selected = item.id}>{item.name}</button><button title={tr('design_up')} on:click={() => move(schema.types, index, -1)}>↑</button><button title={tr('design_down')} on:click={() => move(schema.types, index, 1)}>↓</button></div>{/each}
            <button on:click={addType}>{tr('design_add_type')}</button>
        </div><div>
            {#if type}
                <label>{tr('design_id')}<input readonly value={type.id} /></label>
                <label>{tr('design_name')}<input bind:value={type.name} on:input={update} /></label>
                <label>{tr('design_folder')}<input bind:value={type.folder} /></label>
                <div class="design-inline"><label>{tr('design_color')}<input type="color" bind:value={type.color} /></label><label>{tr('design_icon')}<input bind:value={type.icon} /></label><button on:click={() => confirmType = type!.id}>{tr('delete')}</button></div>
                {#if confirmType === type.id}<p class="design-warning">{tr('design_delete_type')}</p><button on:click={() => { schema.types = schema.types.filter(item => item.id !== confirmType); selected = schema.types[0]?.id || ''; confirmType = ''; update(); }}>{tr('design_confirm')}</button><button on:click={() => confirmType = ''}>{tr('cancel')}</button>{/if}
                {#each type.fields as field, index (field.id)}<fieldset>
                    <div class="design-inline"><input aria-label={tr('design_name')} bind:value={field.name} /><select aria-label={tr('design_type')} bind:value={field.kind} disabled={service.fieldHasData(type.id, field.id)} title={service.fieldHasData(type.id, field.id) ? tr('design_kind_locked') : ''}>{#each FIELD_KINDS as kind}<option value={kind}>{tr(('design_kind_' + kind) as TranslationKey)}</option>{/each}</select>
                        <button title={tr('design_up')} on:click={() => move(type!.fields, index, -1)}>↑</button><button title={tr('design_down')} on:click={() => move(type!.fields, index, 1)}>↓</button><button on:click={() => { type!.fields.splice(index, 1); update(); }}>{tr('delete')}</button></div>
                    <small>{tr('design_id')}: {field.id}</small>
                    <div class="design-inline"><label><input type="checkbox" bind:checked={field.required} />{tr('design_required_label')}</label><label><input type="checkbox" bind:checked={field.card} />{tr('design_on_card')}</label></div>
                    {#if field.kind === 'select' || field.kind === 'multiselect'}<label>{tr('design_options')}<textarea rows="3" value={(field.options || []).map(option => option.value + ' | ' + option.color).join('\n')} on:change={event => options(field, event.currentTarget.value)}></textarea></label>{/if}
                    {#if field.kind === 'number'}<div class="design-inline"><label>{tr('design_min')}<input type="number" bind:value={field.min} /></label><label>{tr('design_max')}<input type="number" bind:value={field.max} /></label><label>{tr('design_step')}<input type="number" bind:value={field.step} /></label></div>{/if}
                    {#if field.kind === 'entity'}<label>{tr('design_target_type')}<select bind:value={field.targetType}><option value="">{tr('design_all')}</option>{#each schema.types as target}<option value={target.id}>{target.name}</option>{/each}</select></label>{/if}
                </fieldset>{/each}
                <button on:click={() => addField(type!)}>{tr('design_add_field')}</button>
            {/if}
        </div></div>
    {/if}
    {#if error}<p role="alert" class="design-warning">{error}</p>{/if}
    <div class="design-inline"><button class="mod-cta" disabled={busy} on:click={save}>{tr('save')}</button><button on:click={onClose}>{tr('cancel')}</button></div>
</div>
