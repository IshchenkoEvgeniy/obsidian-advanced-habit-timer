<script lang="ts">
    import { setIcon } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import type { ProjectDataEngine } from '../../projects/project-data';
    import { projectTaskToData } from '../../projects/task-data';
    import type { ProjectScopeDefinition, ProjectTask } from '../../projects/types';
    import type { ViewContext } from '../../projects/views/base-view';

    export let plugin: HabitTimerPlugin;
    export let dataEngine: ProjectDataEngine;
    export let scope: ProjectScopeDefinition;
    export let ctx: ViewContext;

    type ColumnId = 'select' | 'name' | 'status' | 'habit' | 'priority' | 'start' | 'due' | 'spent' | 'estimated' | 'remaining' | 'actions';
    type SortId = Exclude<ColumnId, 'select' | 'actions'>;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };
    const labels: Record<ColumnId, { ru: string; en: string }> = {
        select: { ru: 'Выбор', en: 'Select' }, name: { ru: 'Задача', en: 'Task' },
        status: { ru: 'Статус', en: 'Status' }, habit: { ru: 'Привычка', en: 'Habit' },
        priority: { ru: 'Приоритет', en: 'Priority' }, start: { ru: 'Начало', en: 'Start' },
        due: { ru: 'Срок', en: 'Due' }, spent: { ru: 'Потрачено', en: 'Spent' },
        estimated: { ru: 'Оценка', en: 'Estimate' }, remaining: { ru: 'Осталось', en: 'Remaining' },
        actions: { ru: 'Действия', en: 'Actions' }
    };

    let visible = new Set<ColumnId>(Object.keys(labels) as ColumnId[]);
    let sortId: SortId = 'name';
    let sortDirection: 'asc' | 'desc' = 'asc';
    let saving = new Set<string>();

    $: lang = plugin.settings.language;
    $: habits = [...new Set(ctx.allTasks.map(task => task.habitName).filter((value): value is string => Boolean(value)))].sort();
    $: sortedTasks = [...ctx.filteredTasks].sort(compareTasks);
    $: totalSpent = sortedTasks.reduce((sum, task) => sum + task.timeSpentSec, 0);
    $: totalEstimated = sortedTasks.reduce((sum, task) => sum + (task.timeEstimatedSec || 0), 0);

    function label(id: ColumnId): string { return labels[id][lang]; }
    function toggleColumn(id: ColumnId): void {
        if (visible.has(id)) visible.delete(id); else visible.add(id);
        visible = new Set(visible);
    }
    function toggleSort(id: SortId): void {
        if (sortId === id) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        else { sortId = id; sortDirection = 'asc'; }
    }
    function sortValue(task: ProjectTask): string | number {
        if (sortId === 'name') return task.name.toLowerCase();
        if (sortId === 'status') return task.status.toLowerCase();
        if (sortId === 'habit') return task.habitName?.toLowerCase() || '';
        if (sortId === 'priority') return ({ high: 3, medium: 2, low: 1 } as Record<string, number>)[task.priority || ''] || 0;
        if (sortId === 'start') return task.startDate || '';
        if (sortId === 'due') return task.endDate || '';
        if (sortId === 'spent') return task.timeSpentSec;
        if (sortId === 'estimated') return task.timeEstimatedSec || 0;
        return (task.timeEstimatedSec || 0) - task.timeSpentSec;
    }
    function compareTasks(a: ProjectTask, b: ProjectTask): number {
        const left = sortValue(a); const right = sortValue(b);
        const result = typeof left === 'number' && typeof right === 'number'
            ? left - right : String(left).localeCompare(String(right));
        return sortDirection === 'asc' ? result : -result;
    }
    function priorityLabel(value: string): string {
        if (!value) return lang === 'ru' ? 'Нет' : 'None';
        const values: Record<string, { ru: string; en: string }> = {
            low: { ru: 'Низкий', en: 'Low' }, medium: { ru: 'Средний', en: 'Medium' }, high: { ru: 'Высокий', en: 'High' }
        };
        return values[value]?.[lang] || value;
    }
    async function save(task: ProjectTask, changes: Parameters<typeof projectTaskToData>[2]): Promise<void> {
        saving.add(task.id); saving = new Set(saving);
        try {
            const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), changes);
            await dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, ctx.columns, task.blockId);
            ctx.onRefresh();
        } finally {
            saving.delete(task.id); saving = new Set(saving);
        }
    }
    function toggleSelected(task: ProjectTask, checked: boolean): void {
        if (checked) ctx.selectedTasks.add(task.id); else ctx.selectedTasks.delete(task.id);
        ctx.onSelectionChange?.();
    }
    function remaining(task: ProjectTask): number | null {
        if (!task.timeEstimatedSec) return null;
        return task.timeEstimatedSec - task.timeSpentSec;
    }
</script>

<div class="table-toolbar">
    <strong>{lang === 'ru' ? `${sortedTasks.length} задач` : `${sortedTasks.length} tasks`}</strong>
    <details>
        <summary>{lang === 'ru' ? 'Колонки' : 'Columns'}</summary>
        <div class="column-menu">
            {#each Object.keys(labels) as id}
                <label><input type="checkbox" checked={visible.has(id as ColumnId)} on:change={() => toggleColumn(id as ColumnId)} /> {label(id as ColumnId)}</label>
            {/each}
        </div>
    </details>
</div>

<div class="table-scroll">
    <table>
        <thead><tr>
            {#each Object.keys(labels) as rawId}
                {@const id = rawId as ColumnId}
                {#if visible.has(id)}
                    <th class:compact={id === 'select' || id === 'actions'}>
                        {#if id === 'select'}<span class="sr-only">{label(id)}</span>
                        {:else if id === 'actions'}{label(id)}
                        {:else}<button on:click={() => toggleSort(id as SortId)}>{label(id)}{sortId === id ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</button>{/if}
                    </th>
                {/if}
            {/each}
        </tr></thead>
        <tbody>
            {#each sortedTasks as task (task.id)}
                <tr class:saving={saving.has(task.id)}>
                    {#if visible.has('select')}<td class="compact"><input type="checkbox" checked={ctx.selectedTasks.has(task.id)} aria-label={lang === 'ru' ? 'Выбрать задачу' : 'Select task'} on:change={(event) => toggleSelected(task, event.currentTarget.checked)} /></td>{/if}
                    {#if visible.has('name')}<td class="name"><input value={task.name} on:change={(event) => void save(task, { name: event.currentTarget.value.trim() || task.name })} /></td>{/if}
                    {#if visible.has('status')}<td><select value={task.status} on:change={(event) => void save(task, { status: event.currentTarget.value })}>{#each ctx.columns as status}<option value={status}>{status}</option>{/each}</select></td>{/if}
                    {#if visible.has('habit')}<td><select value={task.habitName || ''} on:change={(event) => void save(task, { habitName: event.currentTarget.value })}><option value="">—</option>{#each habits as habit}<option value={habit}>{habit}</option>{/each}</select></td>{/if}
                    {#if visible.has('priority')}<td><select class="priority {task.priority || 'none'}" value={task.priority || ''} on:change={(event) => void save(task, { priority: event.currentTarget.value || undefined })}>{#each ['', 'low', 'medium', 'high'] as value}<option value={value}>{priorityLabel(value)}</option>{/each}</select></td>{/if}
                    {#if visible.has('start')}<td><input class="date" type="date" value={task.startDate || ''} on:change={(event) => void save(task, { startDate: event.currentTarget.value })} /></td>{/if}
                    {#if visible.has('due')}<td><input class="date" type="date" value={task.endDate || ''} on:change={(event) => void save(task, { endDate: event.currentTarget.value })} /></td>{/if}
                    {#if visible.has('spent')}<td class="mono">{plugin.formatTime(task.timeSpentSec)}</td>{/if}
                    {#if visible.has('estimated')}<td><input class="duration mono" value={task.timeEstimatedSec ? plugin.formatTime(task.timeEstimatedSec) : ''} placeholder="00:00:00" on:change={(event) => void save(task, { timeEstimated: event.currentTarget.value.trim() })} /></td>{/if}
                    {#if visible.has('remaining')}<td class:overdue={(remaining(task) || 0) < 0} class="mono">{remaining(task) === null ? '—' : `${remaining(task)! < 0 ? '+' : ''}${plugin.formatTime(Math.abs(remaining(task)!))}`}</td>{/if}
                    {#if visible.has('actions')}<td class="actions compact">
                        <button title={lang === 'ru' ? 'Открыть заметку' : 'Open note'} on:click={() => void plugin.app.workspace.getLeaf(false).openFile(task.file)}><span use:icon={'file-text'}></span></button>
                        <button title={lang === 'ru' ? 'Запустить таймер' : 'Start timer'} disabled={!task.habitName} on:click={() => void dataEngine.startTimerForTask(task, scope.sourceType === 'file')}><span use:icon={'play'}></span></button>
                    </td>{/if}
                </tr>
            {/each}
        </tbody>
        <tfoot><tr>
            {#each Object.keys(labels) as rawId}
                {@const id = rawId as ColumnId}
                {#if visible.has(id)}<td>{id === 'name' ? (lang === 'ru' ? 'Итого' : 'Total') : id === 'spent' ? plugin.formatTime(totalSpent) : id === 'estimated' ? plugin.formatTime(totalEstimated) : ''}</td>{/if}
            {/each}
        </tr></tfoot>
    </table>
</div>

<style>
    .table-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
    details { position:relative; }
    summary { cursor:pointer; }
    .column-menu { position:absolute; right:0; z-index:10; display:grid; grid-template-columns:repeat(2,minmax(130px,1fr)); gap:7px; width:320px; padding:10px; border:1px solid var(--background-modifier-border); background:var(--background-secondary); box-shadow:var(--shadow-s); }
    .column-menu label { display:flex; align-items:center; gap:5px; font-size:.8rem; }
    .table-scroll { height:calc(100% - 38px); overflow:auto; border:1px solid var(--background-modifier-border); }
    table { width:100%; border-collapse:collapse; font-size:.82rem; }
    th { position:sticky; top:0; z-index:2; padding:7px; background:var(--background-secondary); text-align:left; white-space:nowrap; }
    th button { height:auto; padding:0; border:0; box-shadow:none; background:transparent; color:var(--text-normal); font-weight:600; }
    td { padding:5px 7px; border-top:1px solid var(--background-modifier-border); white-space:nowrap; }
    tbody tr:hover { background:var(--background-modifier-hover); }
    tr.saving { opacity:.55; pointer-events:none; }
    td.name { min-width:220px; }
    td.name input { width:100%; min-width:180px; }
    td select,td input { height:28px; font-size:.8rem; }
    .date { width:128px; }
    .duration { width:88px; }
    .mono { font-family:var(--font-monospace); }
    .overdue { color:var(--text-error); }
    .compact { width:1%; }
    .actions { display:flex; gap:3px; }
    .actions button { width:28px; height:28px; padding:5px; }
    .actions span { display:block; width:16px; height:16px; }
    tfoot td { position:sticky; bottom:0; background:var(--background-secondary); color:var(--text-accent); font-weight:600; }
    .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
</style>
