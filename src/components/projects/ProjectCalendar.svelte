<script lang="ts">
    import { setIcon } from 'obsidian';
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

    interface CalendarDay { date: Date; key: string; day: number; inMonth: boolean; today: boolean; }

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };
    let cursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let dragOver = '';

    $: lang = plugin.settings.language;
    $: days = buildDays(cursor);
    $: monthLabel = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-UA' : 'en-US', { month: 'long', year: 'numeric' }).format(cursor);
    $: weekDays = lang === 'ru' ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    function dateKey(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function buildDays(month: Date): CalendarDay[] {
        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const mondayOffset = (first.getDay() + 6) % 7;
        const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
        const today = dateKey(new Date());
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
            const key = dateKey(date);
            return { date, key, day: date.getDate(), inMonth: date.getMonth() === month.getMonth(), today: key === today };
        });
    }
    function moveMonth(offset: number): void {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1);
    }
    function goToday(): void {
        const today = new Date();
        cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    function tasksForDay(key: string): ProjectTask[] {
        return ctx.filteredTasks.filter(task => {
            if (!task.startDate) return false;
            const start = task.startDate.slice(0, 10);
            const end = task.endDate?.slice(0, 10);
            return end ? key >= start && key <= end : key === start;
        });
    }
    function isOverdue(task: ProjectTask): boolean {
        return Boolean(task.endDate && task.endDate.slice(0, 10) < dateKey(new Date()) && !isTaskDone(task));
    }
    function isTaskDone(task: ProjectTask): boolean {
        return task.status === ctx.columns[ctx.columns.length - 1];
    }
    function createTask(key: string): void {
        new TaskEditorModal(plugin.app, plugin, { startDate: key }, ctx.columns, false, async data => {
            await dataEngine.createTask(scope, data);
            ctx.onRefresh();
        }).open();
    }
    function editTask(task: ProjectTask, event: MouseEvent): void {
        event.stopPropagation();
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
    async function dropTask(event: DragEvent, key: string): Promise<void> {
        event.preventDefault();
        dragOver = '';
        const taskId = event.dataTransfer?.getData('text/plain');
        const task = ctx.allTasks.find(value => value.id === taskId);
        if (!task) return;
        let endDate = task.endDate || '';
        if (task.startDate && task.endDate) {
            const start = new Date(`${task.startDate.slice(0, 10)}T12:00:00`);
            const end = new Date(`${task.endDate.slice(0, 10)}T12:00:00`);
            const duration = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
            const nextEnd = new Date(`${key}T12:00:00`);
            nextEnd.setDate(nextEnd.getDate() + duration);
            endDate = dateKey(nextEnd);
        }
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { startDate: key, endDate });
        await dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, ctx.columns, task.blockId);
        ctx.onRefresh();
    }
    function taskColor(task: ProjectTask): string {
        if (task.color) return task.color;
        let hash = 0;
        const source = task.habitName || task.status;
        for (let index = 0; index < source.length; index++) hash = source.charCodeAt(index) + ((hash << 5) - hash);
        return `hsl(${Math.abs(hash) % 360}, 55%, 42%)`;
    }
</script>

{#if ctx.filteredTasks.length}
    <div class="calendar-toolbar">
        <div class="navigation">
            <button title={t(lang, 'calendar_prev')} aria-label={t(lang, 'calendar_prev')} on:click={() => moveMonth(-1)}><span use:icon={'chevron-left'}></span></button>
            <h2>{monthLabel}</h2>
            <button title={t(lang, 'calendar_next')} aria-label={t(lang, 'calendar_next')} on:click={() => moveMonth(1)}><span use:icon={'chevron-right'}></span></button>
        </div>
        <button class="today-btn" on:click={goToday}>{t(lang, 'today')}</button>
    </div>

    <div class="calendar-scroll">
        <div class="weekdays">{#each weekDays as day}<div>{day}</div>{/each}</div>
        <div class="calendar-grid">
            {#each days as day (day.key)}
                <section role="gridcell" tabindex="-1" class:outside={!day.inMonth} class:today={day.today} class:drag-over={dragOver === day.key}
                    on:dragover={(event) => { event.preventDefault(); dragOver = day.key; }}
                    on:dragleave={() => dragOver = ''}
                    on:drop={(event) => void dropTask(event, day.key)}
                    on:dblclick={() => createTask(day.key)}>
                    <header>
                        <span>{day.day}</span>
                        <button title={t(lang, 'board_add_task')} aria-label={t(lang, 'board_add_task')} on:click={(event) => { event.stopPropagation(); createTask(day.key); }}><span use:icon={'plus'}></span></button>
                    </header>
                    <div class="day-tasks">
                        {#each tasksForDay(day.key) as task (task.id)}
                            <button class="calendar-task" class:selected={ctx.selectedTasks.has(task.id)} class:done={isTaskDone(task)} class:overdue={isOverdue(task)}
                                style={`--task-color:${taskColor(task)}`}
                                title={`${task.name} · ${task.status}`}
                                draggable="true"
                                on:dragstart={(event) => event.dataTransfer?.setData('text/plain', task.id)}
                                on:dblclick|stopPropagation={() => {}}
                                on:click={(event) => editTask(task, event)}>
                                <span>{task.name}</span>
                                {#if task.priority === 'high'}<i class="pdot" title={t(lang, 'priority_high')} aria-label={t(lang, 'priority_high')}></i>{/if}
                            </button>
                        {/each}
                    </div>
                </section>
            {/each}
        </div>
    </div>
{:else}
    <div class="calendar-empty">
        <span class="empty-icon" use:icon={'calendar-days'}></span>
        <h3>{t(lang, 'calendar_empty_title')}</h3>
        <p>{t(lang, 'calendar_empty_hint')}</p>
        <button class="empty-action" on:click={() => createTask(dateKey(new Date()))}><span use:icon={'plus'}></span>{t(lang, 'add_new_task')}</button>
    </div>
{/if}

<style>
    .calendar-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
    .navigation { display:flex; align-items:center; gap:8px; }
    .navigation h2 { min-width:190px; margin:0; font-size:1.05rem; text-align:center; text-transform:capitalize; }
    .navigation button { width:32px; height:32px; padding:6px; }
    .navigation span { display:block; width:16px; height:16px; }
    .today-btn { border-radius:var(--radius-m); }

    .calendar-scroll { height:calc(100% - 42px); min-height:480px; overflow:auto; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); }
    .weekdays,.calendar-grid { display:grid; grid-template-columns:repeat(7,minmax(110px,1fr)); min-width:770px; }
    .weekdays { position:sticky; top:0; z-index:3; background:var(--background-secondary); }
    .weekdays div { padding:6px; color:var(--text-muted); font-size:.75rem; font-weight:600; text-align:center; }
    .calendar-grid { grid-template-rows:repeat(6,minmax(92px,1fr)); min-height:calc(100% - 28px); border-top:1px solid var(--background-modifier-border); border-left:1px solid var(--background-modifier-border); }
    section { min-width:0; padding:5px; overflow:hidden; border-right:1px solid var(--background-modifier-border); border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary); }
    section.outside { background:var(--background-secondary); opacity:.6; }
    section.today { box-shadow:inset 0 0 0 2px var(--interactive-accent); }
    section.drag-over { background:var(--background-modifier-hover); box-shadow:inset 0 0 0 2px var(--interactive-accent); }
    section header { display:flex; align-items:center; justify-content:space-between; height:23px; color:var(--text-muted); font-size:.75rem; }
    section.today header span { display:inline-grid; place-items:center; min-width:20px; height:20px; border-radius:6px; background:var(--interactive-accent); color:var(--text-on-accent); font-weight:700; }
    section header button { width:22px; height:22px; padding:4px; opacity:0; }
    section:hover header button, section:focus-within header button { opacity:1; }
    section header button span { display:block; width:14px; height:14px; }
    .day-tasks { display:flex; flex-direction:column; gap:3px; max-height:calc(100% - 23px); overflow-y:auto; }
    .calendar-task { display:flex; align-items:center; justify-content:space-between; gap:4px; width:100%; min-height:25px; padding:3px 6px; overflow:hidden; border-left:3px solid var(--task-color); border-radius:var(--radius-s); background:var(--background-secondary-alt); color:var(--text-normal); font-size:.72rem; text-align:left; transition:transform .1s ease, box-shadow .1s ease; }
    .calendar-task:hover { box-shadow:var(--shadow-s); transform:translateY(-1px); }
    .calendar-task span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .calendar-task.selected { box-shadow:inset 0 0 0 1px var(--interactive-accent); }
    .calendar-task.done span { color:var(--text-muted); text-decoration:line-through; }
    .calendar-task.overdue { background:color-mix(in srgb, var(--text-error) 10%, var(--background-secondary-alt)); }
    .calendar-task.overdue span { color:var(--text-error); }
    .pdot { display:block; flex-shrink:0; width:7px; height:7px; border-radius:50%; background:var(--text-error); }

    .calendar-empty { display:flex; flex-direction:column; align-items:center; gap:6px; margin:10vh auto 0; max-width:400px; padding:38px 22px; border:1px dashed var(--background-modifier-border); border-radius:var(--radius-xl); background:var(--background-primary); text-align:center; }
    .empty-icon { margin-bottom:6px; color:var(--text-faint); }
    .empty-icon :global(svg) { width:34px; height:34px; }
    .calendar-empty h3 { margin:0; color:var(--text-normal); font-size:.96rem; }
    .calendar-empty p { margin:0 0 10px; color:var(--text-muted); font-size:.78rem; }
    .empty-action { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:var(--radius-m); }
    .empty-action span { display:block; width:14px; height:14px; }
</style>
