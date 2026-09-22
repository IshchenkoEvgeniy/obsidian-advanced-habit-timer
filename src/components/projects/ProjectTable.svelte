<script lang="ts">
    import { setIcon } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import { t, type TranslationKey } from '../../i18n';
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
    const COLUMNS: ColumnId[] = ['select', 'name', 'status', 'habit', 'priority', 'start', 'due', 'spent', 'estimated', 'remaining', 'actions'];

    let visible = new Set<ColumnId>(COLUMNS);
    let sortId: SortId = 'name';
    let sortDirection: 'asc' | 'desc' = 'asc';
    let saving = new Set<string>();

    $: lang = plugin.settings.language;
    $: habits = [...new Set(ctx.allTasks.map(task => task.habitName).filter((value): value is string => Boolean(value)))].sort();
    $: sortedTasks = [...ctx.filteredTasks].sort(compareTasks);
    $: totalSpent = sortedTasks.reduce((sum, task) => sum + task.timeSpentSec, 0);
    $: totalEstimated = sortedTasks.reduce((sum, task) => sum + (task.timeEstimatedSec || 0), 0);
    $: statusColor = (name: string) => `hsl(${hashHue(name)}, 45%, 48%)`;

    function hashHue(value: string): number {
        let hash = 0;
        for (let index = 0; index < value.length; index++) hash = value.charCodeAt(index) + ((hash << 5) - hash);
        return Math.abs(hash) % 360;
    }
    function label(id: ColumnId): string {
        const keys: Record<ColumnId, TranslationKey> = {
            select: 'table_col_select', name: 'table_col_name', status: 'table_col_status',
            habit: 'table_col_habit', priority: 'table_col_priority', start: 'table_col_start',
            due: 'table_col_due', spent: 'table_col_spent', estimated: 'table_col_estimated',
            remaining: 'table_col_remaining', actions: 'table_col_actions'
        };
        return t(lang, keys[id]);
    }
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
        if (!value) return t(lang, 'priority_none');
        const keys: Record<string, 'priority_low' | 'priority_medium' | 'priority_high'> = {
            low: 'priority_low', medium: 'priority_medium', high: 'priority_high'
        };
        return keys[value] ? t(lang, keys[value]) : value;
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

{#if sortedTasks.length}
    <div class="table-toolbar">
        <strong>{t(lang, 'table_tasks_count', [sortedTasks.length])}</strong>
        <details>
            <summary>{t(lang, 'table_columns_toggle')}</summary>
            <div class="column-menu">
                {#each COLUMNS as id}
                    <label><input type="checkbox" checked={visible.has(id)} on:change={() => toggleColumn(id)} /> {label(id)}</label>
                {/each}
            </div>
        </details>
    </div>

    <div class="table-scroll">
        <table>
            <thead><tr>
                {#each COLUMNS as id}
                    {#if visible.has(id)}
                        <th class:compact={id === 'select' || id === 'actions'}>
                            {#if id === 'select'}<span class="sr-only">{label(id)}</span>
                            {:else if id === 'actions'}{label(id)}
                            {:else}
                                <button on:click={() => toggleSort(id as SortId)}>
                                    {label(id)}
                                    <span class="sort-icon" use:icon={sortId === id ? (sortDirection === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevrons-up-down'}></span>
                                </button>
                            {/if}
                        </th>
                    {/if}
                {/each}
            </tr></thead>
            <tbody>
                {#each sortedTasks as task (task.id)}
                    <tr class:saving={saving.has(task.id)}>
                        {#if visible.has('select')}<td class="compact"><input type="checkbox" checked={ctx.selectedTasks.has(task.id)} aria-label={t(lang, 'board_select')} on:change={(event) => toggleSelected(task, event.currentTarget.checked)} /></td>{/if}
                        {#if visible.has('name')}<td class="name"><input value={task.name} on:change={(event) => void save(task, { name: event.currentTarget.value.trim() || task.name })} /></td>{/if}
                        {#if visible.has('status')}
                            <td>
                                <span class="status-cell" style={`--status-color:${statusColor(task.status)}`}>
                                    <i class="dot" aria-hidden="true"></i>
                                    <select value={task.status} on:change={(event) => void save(task, { status: event.currentTarget.value })}>{#each ctx.columns as status}<option value={status}>{status}</option>{/each}</select>
                                </span>
                            </td>
                        {/if}
                        {#if visible.has('habit')}<td><select value={task.habitName || ''} on:change={(event) => void save(task, { habitName: event.currentTarget.value })}><option value="">—</option>{#each habits as habit}<option value={habit}>{habit}</option>{/each}</select></td>{/if}
                        {#if visible.has('priority')}
                            <td>
                                <span class={`priority-cell ${task.priority || 'none'}`}>
                                    <select value={task.priority || ''} on:change={(event) => void save(task, { priority: event.currentTarget.value || undefined })}>{#each ['', 'low', 'medium', 'high'] as value}<option value={value}>{priorityLabel(value)}</option>{/each}</select>
                                </span>
                            </td>
                        {/if}
                        {#if visible.has('start')}<td><input class="date" type="date" value={task.startDate || ''} on:change={(event) => void save(task, { startDate: event.currentTarget.value })} /></td>{/if}
                        {#if visible.has('due')}<td><input class="date" type="date" value={task.endDate || ''} on:change={(event) => void save(task, { endDate: event.currentTarget.value })} /></td>{/if}
                        {#if visible.has('spent')}<td class="mono">{plugin.formatTime(task.timeSpentSec)}</td>{/if}
                        {#if visible.has('estimated')}<td><input class="duration mono" value={task.timeEstimatedSec ? plugin.formatTime(task.timeEstimatedSec) : ''} placeholder="00:00:00" on:change={(event) => void save(task, { timeEstimated: event.currentTarget.value.trim() })} /></td>{/if}
                        {#if visible.has('remaining')}<td class:overdue={(remaining(task) || 0) < 0} class="mono">{remaining(task) === null ? '—' : `${remaining(task)! < 0 ? '+' : ''}${plugin.formatTime(Math.abs(remaining(task)!))}`}</td>{/if}
                        {#if visible.has('actions')}<td class="actions compact">
                            <button title={t(lang, 'board_open_note')} aria-label={t(lang, 'board_open_note')} on:click={() => void plugin.app.workspace.getLeaf(false).openFile(task.file)}><span use:icon={'file-text'}></span></button>
                            <button title={t(lang, 'board_start_timer')} aria-label={t(lang, 'board_start_timer')} disabled={!task.habitName} on:click={() => void dataEngine.startTimerForTask(task, scope.sourceType === 'file')}><span use:icon={'play'}></span></button>
                        </td>{/if}
                    </tr>
                {/each}
            </tbody>
            <tfoot><tr>
                {#each COLUMNS as id}
                    {#if visible.has(id)}<td>{id === 'name' ? t(lang, 'table_total') : id === 'spent' ? plugin.formatTime(totalSpent) : id === 'estimated' ? plugin.formatTime(totalEstimated) : ''}</td>{/if}
                {/each}
            </tr></tfoot>
        </table>
    </div>
{:else}
    <div class="table-empty">
        <span class="empty-icon" use:icon={'inbox'}></span>
        <h3>{t(lang, 'table_empty_title')}</h3>
        <p>{t(lang, 'table_empty_hint')}</p>
    </div>
{/if}

<style>
    .table-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
    .table-toolbar strong { color:var(--text-normal); font-size:.82rem; }
    details { position:relative; }
    summary { cursor:pointer; }
    .column-menu { position:absolute; right:0; z-index:10; display:grid; grid-template-columns:repeat(2,minmax(130px,1fr)); gap:7px; width:320px; padding:12px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m); background:var(--background-secondary); box-shadow:var(--shadow-m); }
    .column-menu label { display:flex; align-items:center; gap:5px; font-size:.8rem; }

    .table-scroll { height:calc(100% - 38px); overflow:auto; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); }
    table { width:100%; border-collapse:collapse; font-size:.82rem; }
    th { position:sticky; top:0; z-index:2; padding:9px; background:var(--background-secondary); text-align:left; white-space:nowrap; }
    th button { display:inline-flex; align-items:center; gap:4px; height:auto; padding:0; border:0; box-shadow:none; background:transparent; color:var(--text-normal); font-weight:600; }
    .sort-icon { display:block; width:12px; height:12px; color:var(--text-faint); }
    td { padding:6px 9px; border-top:1px solid var(--background-modifier-border); white-space:nowrap; }
    tbody tr:hover { background:var(--background-modifier-hover); }
    tr.saving { opacity:.55; pointer-events:none; }
    td.name { min-width:220px; }
    td.name input { width:100%; min-width:180px; }
    td select, td input { height:28px; font-size:.8rem; }
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

    .status-cell { display:inline-flex; align-items:center; gap:7px; }
    .status-cell .dot { display:block; width:8px; height:8px; border-radius:50%; background:var(--status-color); }
    .priority-cell.none select { color:var(--text-muted); }
    .priority-cell.low select { color:var(--text-success); }
    .priority-cell.medium select { color:var(--text-warning); }
    .priority-cell.high select { color:var(--text-error); }

    .table-empty { display:flex; flex-direction:column; align-items:center; gap:6px; margin:10vh auto 0; max-width:380px; padding:38px 22px; border:1px dashed var(--background-modifier-border); border-radius:var(--radius-xl); background:var(--background-primary); text-align:center; }
    .empty-icon { margin-bottom:6px; color:var(--text-faint); }
    .empty-icon :global(svg) { width:34px; height:34px; }
    .table-empty h3 { margin:0; color:var(--text-normal); font-size:.96rem; }
    .table-empty p { margin:0; color:var(--text-muted); font-size:.78rem; }
</style>
