<script lang="ts">
    import { setIcon, TFile } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import { t } from '../../i18n';
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

    function hashHue(value: string): number {
        let hash = 0;
        for (let index = 0; index < value.length; index++) hash = value.charCodeAt(index) + ((hash << 5) - hash);
        return Math.abs(hash) % 360;
    }
    function statusColor(task: ProjectTask): string {
        const last = ctx.columns[ctx.columns.length - 1];
        const source = task.status === last ? 'done' : task.status;
        return `hsl(${source === 'done' ? 142 : hashHue(task.status)}, 45%, 45%)`;
    }
    function isTaskDone(task: ProjectTask): boolean {
        return task.status === ctx.columns[ctx.columns.length - 1];
    }
    function isOverdue(task: ProjectTask): boolean {
        return Boolean(task.endDate && task.endDate.slice(0, 10) < localDateKey(new Date()) && !isTaskDone(task));
    }
    function localDateKey(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function priorityLabel(value: string): string {
        const keys: Record<string, 'priority_low' | 'priority_medium' | 'priority_high'> = {
            low: 'priority_low', medium: 'priority_medium', high: 'priority_high'
        };
        return keys[value] ? t(lang, keys[value]) : value;
    }
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
    function createTask(): void {
        new TaskEditorModal(plugin.app, plugin, {}, ctx.columns, false, async data => {
            await dataEngine.createTask(scope, data);
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

{#if ctx.filteredTasks.length}
    <div class="gallery-grid">
        {#each ctx.filteredTasks as task (task.id)}
            <div class="gallery-card" class:selected={ctx.selectedTasks.has(task.id)} class:done={isTaskDone(task)} tabindex="0" role="button"
                on:click={(event) => editTask(task, event)}
                on:keydown={(event) => event.key === 'Enter' && editTask(task, event as unknown as MouseEvent)}>
                <div class="visual">
                    {#if imageUrl(task)}
                        <img src={imageUrl(task)} alt="" loading="lazy" />
                        {#if images(task).length > 1}
                            <button class="image-nav previous" title={t(lang, 'gallery_prev_image')} aria-label={t(lang, 'gallery_prev_image')} on:click={(event) => moveImage(task, -1, event)}><span use:icon={'chevron-left'}></span></button>
                            <button class="image-nav next" title={t(lang, 'gallery_next_image')} aria-label={t(lang, 'gallery_next_image')} on:click={(event) => moveImage(task, 1, event)}><span use:icon={'chevron-right'}></span></button>
                            <span class="image-count">{(imageIndexes[task.id] || 0) + 1}/{images(task).length}</span>
                        {/if}
                    {:else}
                        <div class="poster"><strong>{task.name}</strong></div>
                    {/if}
                </div>
                <div class="gallery-body">
                    <div class="badges">
                        <span class="status" style={`--status-color:${statusColor(task)}`}>{task.status}</span>
                        {#if task.priority}<span class={`pill priority ${task.priority}`}>{priorityLabel(task.priority)}</span>{/if}
                        {#if isOverdue(task)}<span class="pill overdue">{t(lang, 'board_overdue')}</span>{/if}
                    </div>
                    <h3>{task.name}</h3>
                    {#if task.habitName}<p class="habit">{task.habitName}</p>{/if}
                    <div class="meta">
                        <span>{plugin.formatTime(task.timeSpentSec)}</span>
                        {#if task.endDate}<span class:overdue-text={isOverdue(task)}>{task.endDate.slice(0, 10)}</span>{/if}
                    </div>
                    {#if task.subtasks?.length}
                        <div class="progress-row">
                            <div class="progress"><span style={`width:${progress(task)}%`}></span></div>
                            <small>{task.subtasks.filter(subtask => subtask.checked).length}/{task.subtasks.length}</small>
                        </div>
                    {/if}
                </div>
                <div class="actions">
                    <button title={t(lang, 'board_open_note')} aria-label={t(lang, 'board_open_note')} on:click={(event) => stop(event, () => void plugin.app.workspace.getLeaf(false).openFile(task.file))}><span use:icon={'file-text'}></span></button>
                    <button title={t(lang, 'board_start_timer')} aria-label={t(lang, 'board_start_timer')} disabled={!task.habitName} on:click={(event) => stop(event, () => void dataEngine.startTimerForTask(task, scope.sourceType === 'file'))}><span use:icon={'play'}></span></button>
                </div>
            </div>
        {/each}
    </div>
{:else}
    <div class="gallery-empty">
        <span class="empty-icon" use:icon={'images'}></span>
        <h3>{t(lang, 'gallery_empty_title')}</h3>
        <p>{t(lang, 'gallery_empty_hint')}</p>
        <button class="empty-action" on:click={createTask}><span use:icon={'plus'}></span>{t(lang, 'add_new_task')}</button>
    </div>
{/if}

<style>
    .gallery-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:12px; }
    .gallery-card { position:relative; min-height:290px; overflow:hidden; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); cursor:pointer; transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
    .gallery-card:hover,.gallery-card:focus-visible { border-color:var(--background-modifier-border-hover); box-shadow:var(--shadow-m); transform:translateY(-2px); }
    .gallery-card.selected { box-shadow:inset 0 0 0 2px var(--interactive-accent), var(--shadow-s); }
    .gallery-card.done h3 { color:var(--text-muted); text-decoration:line-through; }

    .visual { position:relative; height:150px; overflow:hidden; background:var(--background-secondary-alt); }
    .visual img { width:100%; height:100%; object-fit:cover; }
    .poster { display:flex; align-items:flex-end; height:100%; padding:16px; background:linear-gradient(160deg, var(--background-secondary) 0%, var(--background-secondary-alt) 100%); }
    .poster strong { display:-webkit-box; overflow:hidden; color:var(--text-faint); font-size:1.02rem; line-height:1.25; overflow-wrap:anywhere; -webkit-box-orient:vertical; -webkit-line-clamp:3; }
    .image-nav { position:absolute; top:50%; width:28px; height:28px; padding:5px; transform:translateY(-50%); background:rgba(20,20,24,.8); color:#fff; }
    .image-nav.previous { left:5px; }
    .image-nav.next { right:5px; }
    .image-nav span { display:block; width:16px; height:16px; }
    .image-count { position:absolute; right:5px; bottom:5px; padding:2px 6px; border-radius:999px; background:rgba(20,20,24,.8); color:#fff; font-size:.65rem; }

    .gallery-body { padding:11px 11px 45px; }
    .badges { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:8px; }
    .status { padding:2px 8px; border-radius:999px; background:color-mix(in srgb, var(--status-color) 13%, transparent); color:var(--status-color); font-size:.62rem; font-weight:600; }
    .pill { display:inline-flex; align-items:center; padding:1px 8px; border-radius:999px; font-size:.58rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; border:1px solid currentColor; background:var(--background-secondary); }
    .pill.priority.low { color:var(--text-success); background:color-mix(in srgb, var(--text-success) 12%, transparent); }
    .pill.priority.medium { color:var(--text-warning); background:color-mix(in srgb, var(--text-warning) 14%, transparent); }
    .pill.priority.high { color:var(--text-error); background:color-mix(in srgb, var(--text-error) 12%, transparent); }
    .pill.overdue { color:var(--text-error); background:color-mix(in srgb, var(--text-error) 12%, transparent); }

    h3 { margin:0 0 5px; font-size:.92rem; line-height:1.25; overflow-wrap:anywhere; }
    .habit { margin:0 0 8px; color:var(--text-accent); font-size:.72rem; }
    .meta { display:flex; justify-content:space-between; gap:8px; color:var(--text-muted); font-size:.69rem; }
    .overdue-text { color:var(--text-error); font-weight:600; }
    .progress-row { display:flex; align-items:center; gap:8px; margin-top:9px; }
    .progress { flex:1; height:5px; overflow:hidden; border-radius:3px; background:var(--background-modifier-border); }
    .progress span { display:block; height:100%; border-radius:3px; background:var(--interactive-accent); }
    small { flex-shrink:0; color:var(--text-muted); }

    .actions { position:absolute; right:8px; bottom:8px; display:flex; gap:4px; }
    .actions button { width:29px; height:29px; padding:6px; }
    .actions span { display:block; width:16px; height:16px; }

    .gallery-empty { display:flex; flex-direction:column; align-items:center; gap:6px; margin:10vh auto 0; max-width:400px; padding:38px 22px; border:1px dashed var(--background-modifier-border); border-radius:var(--radius-xl); background:var(--background-primary); text-align:center; }
    .empty-icon { margin-bottom:6px; color:var(--text-faint); }
    .empty-icon :global(svg) { width:34px; height:34px; }
    .gallery-empty h3 { margin:0; color:var(--text-normal); font-size:.96rem; }
    .gallery-empty p { margin:0 0 10px; color:var(--text-muted); font-size:.78rem; }
    .empty-action { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:var(--radius-m); }
    .empty-action span { display:block; width:14px; height:14px; }
</style>
