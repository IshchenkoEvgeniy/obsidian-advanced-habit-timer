<script lang="ts">
    import { Notice } from 'obsidian';
    import type HabitTimerPlugin from '../../main';
    import { checklistStageNames } from '../../projects/native-checklist';
    import type { ProjectDataEngine } from '../../projects/project-data';
    import type { ProjectScopeDefinition, TaskData } from '../../projects/types';
    import type { ViewContext } from '../../projects/views/base-view';
    import ProjectTaskComposer from './ProjectTaskComposer.svelte';

    export let plugin: HabitTimerPlugin;
    export let dataEngine: ProjectDataEngine;
    export let scope: ProjectScopeDefinition;
    export let ctx: ViewContext;
    export let initialData: Partial<TaskData> = {};
    export let onClose: () => void;
    export let busy = false;

    let name = initialData.name || '';
    let status = initialData.status || ctx.columns[0] || 'Backlog';
    let section = initialData.section || '';
    let priority = initialData.priority || '';
    let startDate = initialData.startDate || '';
    let dueDate = initialData.endDate || '';
    let estimate = initialData.timeEstimated || '';
    let tags = initialData.tags || '';
    let habit = initialData.habitName || '';
    let description = initialData.description || '';

    $: lang = plugin.settings.language;
    $: stages = checklistStageNames(ctx.allTasks, ctx.stages);
    $: habits = (plugin.settings.properties || [])
        .filter(property => property.type === 'timer' || !property.type).map(property => property.name);

    async function create(): Promise<void> {
        if (busy || !name.trim()) return;
        busy = true;
        try {
            const data: Partial<TaskData> = { name: name.trim(), status, section: section || undefined,
                priority, startDate, endDate: dueDate, timeEstimated: estimate, tags,
                habitName: habit, description: description.trim() };
            await dataEngine.createTask(scope, data, section ? { kind: 'stage', section } : { kind: 'root' });
            onClose();
            ctx.onRefresh();
        } catch (error) {
            new Notice(String(error));
        } finally {
            busy = false;
        }
    }
</script>

<ProjectTaskComposer {scope} {lang} statuses={ctx.columns} {stages} {habits}
    showStage={scope.sourceType === 'file'} {busy}
    bind:name bind:status bind:section bind:priority bind:startDate bind:dueDate
    bind:estimate bind:tags bind:habit bind:description
    onCreate={() => void create()} onCancel={() => { if (!busy) onClose(); }} />
