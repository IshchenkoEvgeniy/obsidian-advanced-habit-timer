<script lang="ts">
    import { setIcon, TFile } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import { TaskEditorModal } from '../../projects/modals/task-editor';
    import type { ProjectDataEngine } from '../../projects/project-data';
    import { projectTaskToData } from '../../projects/task-data';
    import type { ProjectScopeDefinition, ProjectTask } from '../../projects/types';
    import type { ViewContext } from '../../projects/views/base-view';

    export let plugin: HabitTimerPlugin;
    export let dataEngine: ProjectDataEngine;
    export let scope: ProjectScopeDefinition;
    export let ctx: ViewContext;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };
    let imageIndexes: Record<string, number> = {};

    $: lang = plugin.settings.language;

    function images(task: ProjectTask): string[] {
        return [...new Set([...(task.images || []), task.cover || ''].filter(Boolean))];
    }
    function imageUrl(task: ProjectTask): string {
        const values = images(task);
        const source = values[imageIndexes[task.id] || 0];
        if (!source) return '';
        if (/^(https?:|app:|data:)/.test(source)) return source;
        const target = plugin.app.metadataCache.getFirstLinkpathDest(source, task.file.path);
        return target instanceof TFile ? plugin.app.vault.getResourcePath(target) : source;
    }
    function moveImage(task: ProjectTask, direction: -1 | 1, event: MouseEvent): void {
        event.stopPropagation();
        const count = images(task).length;
        if (count < 2) return;
        imageIndexes = { ...imageIndexes, [task.id]: ((imageIndexes[task.id] || 0) + direction + count) % count };
    }
    function editTask(task: ProjectTask, event: MouseEvent): void {
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
            if (ctx.selectedTasks.has(task.id)) ctx.selectedTasks.delete(task.id); else ctx.selectedTasks.add(task.id);
            ctx.onSelectionChange?.();
            return;
        }
        const initial = projectTaskToData(task, seconds => plugin.formatTime(seconds));
        new TaskEditorModal(plugin.app, plugin, initial, ctx.columns, true, async data => {
            await dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, ctx.columns, task.blockId);
            ctx.onRefresh();
        }).open();
    }
    function stop(event: MouseEvent, callback: () => void): void {
        event.stopPropagation();
        callback();
    }
    function progress(task: ProjectTask): number {
        if (!task.subtasks?.length) return 0;
        return Math.round(task.subtasks.filter(subtask => subtask.checked).length / task.subtasks.length * 100);
    }
</script>

<div class="gallery-grid">
    {#each ctx.filteredTasks as task (task.id)}
        <div class="gallery-card" class:selected={ctx.selectedTasks.has(task.id)} tabindex="0" role="button"
            on:click={(event) => editTask(task, event)}
            on:keydown={(event) => event.key === 'Enter' && editTask(task, event as unknown as MouseEvent)}>
            <div class="visual">
                {#if imageUrl(task)}
                    <img src={imageUrl(task)} alt="" loading="lazy" />
                    {#if images(task).length > 1}
                        <button class="image-nav previous" title={lang === 'ru' ? 'Предыдущее изображение' : 'Previous image'} on:click={(event) => moveImage(task, -1, event)}><span use:icon={'chevron-left'}></span></button>
                        <button class="image-nav next" title={lang === 'ru' ? 'Следующее изображение' : 'Next image'} on:click={(event) => moveImage(task, 1, event)}><span use:icon={'chevron-right'}></span></button>
                        <span class="image-count">{(imageIndexes[task.id] || 0) + 1}/{images(task).length}</span>
                    {/if}
                {:else}
                    <div class="poster"><span>{task.status}</span><strong>{task.name}</strong></div>
                {/if}
            </div>
            <div class="gallery-body">
                <div class="badges">
                    <span class="status">{task.status}</span>
                    {#if task.priority}<span class="priority {task.priority}">{task.priority}</span>{/if}
                </div>
                <h3>{task.name}</h3>
                {#if task.habitName}<p class="habit">{task.habitName}</p>{/if}
                <div class="meta">
                    <span>{plugin.formatTime(task.timeSpentSec)}</span>
                    {#if task.endDate}<span>{task.endDate}</span>{/if}
                </div>
                {#if task.subtasks?.length}
                    <div class="progress"><span style:width={`${progress(task)}%`}></span></div>
                    <small>{task.subtasks.filter(subtask => subtask.checked).length}/{task.subtasks.length}</small>
                {/if}
            </div>
            <div class="actions">
                <button title={lang === 'ru' ? 'Открыть заметку' : 'Open note'} on:click={(event) => stop(event, () => void plugin.app.workspace.getLeaf(false).openFile(task.file))}><span use:icon={'file-text'}></span></button>
                <button title={lang === 'ru' ? 'Запустить таймер' : 'Start timer'} disabled={!task.habitName} on:click={(event) => stop(event, () => void dataEngine.startTimerForTask(task, scope.sourceType === 'file'))}><span use:icon={'play'}></span></button>
            </div>
        </div>
    {/each}
</div>

{#if !ctx.filteredTasks.length}<div class="empty">{lang === 'ru' ? 'Нет задач' : 'No tasks'}</div>{/if}

<style>
    .gallery-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:12px; }
    .gallery-card { position:relative; min-height:290px; overflow:hidden; border:1px solid var(--background-modifier-border); border-radius:7px; background:var(--background-secondary); cursor:pointer; }
    .gallery-card:hover,.gallery-card:focus-visible { border-color:var(--interactive-accent); }
    .gallery-card.selected { box-shadow:inset 0 0 0 2px var(--interactive-accent); }
    .visual { position:relative; height:150px; overflow:hidden; background:var(--background-primary-alt); }
    .visual img { width:100%; height:100%; object-fit:cover; }
    .poster { display:flex; flex-direction:column; gap:12px; height:100%; padding:22px; background:var(--background-primary-alt); }
    .poster span { color:var(--text-accent); font-size:.68rem; text-transform:uppercase; }
    .poster strong { display:-webkit-box; overflow:hidden; color:var(--text-muted); font-size:1.05rem; line-height:1.25; overflow-wrap:anywhere; -webkit-box-orient:vertical; -webkit-line-clamp:3; }
    .image-nav { position:absolute; top:50%; width:28px; height:28px; padding:5px; transform:translateY(-50%); background:rgba(20,20,24,.8); color:#fff; }
    .image-nav.previous { left:5px; }.image-nav.next { right:5px; }
    .image-nav span { display:block; width:16px; height:16px; }
    .image-count { position:absolute; right:5px; bottom:5px; padding:2px 5px; border-radius:3px; background:rgba(20,20,24,.8); color:#fff; font-size:.65rem; }
    .gallery-body { padding:11px 11px 45px; }
    .badges { display:flex; gap:5px; margin-bottom:7px; }
    .badges span { padding:2px 5px; border-radius:3px; background:var(--background-primary); color:var(--text-muted); font-size:.63rem; }
    .priority.high { color:var(--text-error); }.priority.medium { color:var(--text-warning); }.priority.low { color:var(--text-success); }
    h3 { margin:0 0 5px; font-size:.92rem; line-height:1.25; overflow-wrap:anywhere; }
    .habit { margin:0 0 8px; color:var(--text-accent); font-size:.72rem; }
    .meta { display:flex; justify-content:space-between; gap:8px; color:var(--text-muted); font-size:.69rem; }
    .progress { height:4px; margin-top:9px; overflow:hidden; background:var(--background-modifier-border); }
    .progress span { display:block; height:100%; background:var(--interactive-accent); }
    small { color:var(--text-muted); }
    .actions { position:absolute; right:8px; bottom:8px; display:flex; gap:4px; }
    .actions button { width:29px; height:29px; padding:6px; }
    .actions span { display:block; width:16px; height:16px; }
    .empty { padding:50px; color:var(--text-muted); text-align:center; }
</style>
