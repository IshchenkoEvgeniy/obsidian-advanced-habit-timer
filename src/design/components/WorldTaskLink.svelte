<script lang="ts">
    import { onMount } from 'svelte';
    import type { DesignService } from '../service';
    import type { DesignEntity } from '../types';
    export let service: DesignService;
    export let record: DesignEntity;
    export let readOnly = false;
    export let onSaved: (record: DesignEntity) => void;
    export let canCreate: () => boolean = () => true;
    let creating = false, busy = false, name = record.title, section = '', error = '', stages: { title: string }[] = [];
    const ru = service.plugin.settings.language === 'ru';
    $: fields = service.settings.types.find(type => type.id === record.type)?.fields.filter(field => field.kind === 'task') || [];
    onMount(() => { const project = service.project(); if (project && service.plugin.projectEngine.loadStages) void service.plugin.projectEngine.loadStages(project).then(value => stages = value).catch(reason => service.report(reason)); });
    async function create() {
        if (busy || readOnly) return;
        if (!canCreate()) { error = ru ? 'Сначала сохрани изменения записи.' : 'Save the record changes first.'; return; }
        busy = true; error = '';
        try { const saved = await service.createLinkedTask(record.id, name, section); onSaved(saved); creating = false; }
        catch (reason) { error = String(reason); }
        finally { busy = false; }
    }
</script>
{#if fields.length && service.project()}<section class="world-task-link">
    <strong>{ru ? 'Связь с планом разработки' : 'Development plan link'}</strong>
    {#each fields as field}{#if record.values[field.id]}<button on:click={() => void service.openTask(String(record.values[field.id])).catch(error => service.report(error))}>{service.taskText(String(record.values[field.id]))} ↗</button>{/if}{/each}
    {#if !record.values[fields[0]!.id] && !readOnly}
        {#if creating}<label>{ru ? 'Название задачи' : 'Task name'}<input bind:value={name} disabled={busy} /></label><label>{ru ? 'Этап' : 'Stage'}<select bind:value={section} disabled={busy}><option value="">{ru ? 'Без этапа' : 'No stage'}</option>{#each stages as stage}<option value={stage.title}>{stage.title}</option>{/each}</select></label><div class="design-inline"><button class="mod-cta" disabled={busy || !name.trim()} on:click={() => void create()}>{ru ? 'Создать и связать' : 'Create and link'}</button><button disabled={busy} on:click={() => creating = false}>{service.tr('cancel')}</button></div>
        {:else}<button on:click={() => creating = true}>{ru ? 'Создать задачу по записи' : 'Create task from record'}</button>{/if}
    {/if}
    {#if error}<p class="design-warning" role="alert">{error}</p>{/if}
</section>{/if}
