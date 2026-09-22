<script lang="ts">
    import { Menu, setIcon, type App } from 'obsidian';
    import type { Action } from 'svelte/action';
    import { flip } from 'svelte/animate';
    import { fade } from 'svelte/transition';
    import type HabitTimerPlugin from '../../main';
    import { TaskEditorModal } from '../../projects/modals/task-editor';
    import { projectTaskToData } from '../../projects/task-data';
    import type { ProjectScopeDefinition, ProjectTask } from '../../projects/types';
    import type { ViewContext } from '../../projects/views/base-view';
    import type { BoardView } from '../../projects/views/board-view';
    import { t } from '../../i18n';
import { isDone } from '../../utils/status';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: BoardView;
    export let scope: ProjectScopeDefinition;
    export let ctx: ViewContext;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    let collapsedColumns = new Set<string>();
    let hoverColumn: string | null = null;

    $: lang = plugin.settings.language;
    $: columns = ctx.columns;
    $: columnsData = columns.map((name, index) => ({
        name,
        color: columnColor(name, index === columns.length - 1),
        isCollapsed: collapsedColumns.has(name),
        tasks: ctx.filteredTasks
            .filter(task => task.status === name)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
    }));
    $: subProjects = buildSubprojects();

    function hashHue(value: string): number {
        let hash = 0;
        for (let index = 0; index < value.length; index++) hash = value.charCodeAt(index) + ((hash << 5) - hash);
        return Math.abs(hash) % 360;
    }
    /** Final column reads as "done" and always gets the success hue. */
    function columnColor(name: string, isLast: boolean): string {
        return `hsl(${isLast ? 142 : hashHue(name)}, 45%, 48%)`;
    }

    function buildSubprojects(): Record<string, { total: number; done: number }> | null {
        if (scope.sourceType !== 'folder') return null;
        const result: Record<string, { total: number; done: number }> = {};
        const baseFolder = scope.sourceValue.replace(/\/$/, '') + '/';
        for (const task of ctx.allTasks) {
            if (!task.file.path.startsWith(baseFolder)) continue;
            const subName = task.file.path.substring(baseFolder.length).split('/')[0];
            if (!subName || !task.file.path.substring(baseFolder.length).includes('/')) continue;
            result[subName] ??= { total: 0, done: 0 };
            result[subName].total += 1;
            if (taskDone(task)) result[subName].done += 1;
        }
        return Object.keys(result).length ? result : null;
    }

    function taskDone(task: ProjectTask): boolean {
        return isDone(task.status) || task.status === columns[columns.length - 1];
    }

    function toggleColumn(name: string): void {
        const next = new Set(collapsedColumns);
        if (next.has(name)) next.delete(name); else next.add(name);
        collapsedColumns = next;
    }

    function selectTask(task: ProjectTask, checked?: boolean): void {
        const next = new Set(ctx.selectedTasks);
        const selected = checked ?? !next.has(task.id);
        if (selected) next.add(task.id); else next.delete(task.id);
        ctx.selectedTasks.clear();
        next.forEach(id => ctx.selectedTasks.add(id));
        ctx.onSelectionChange?.(next);
    }

    function editTask(task: ProjectTask): void {
        const initial = projectTaskToData(task, seconds => plugin.formatTime(seconds));
        new TaskEditorModal(app, plugin, initial, columns, true, async data => {
            await view.dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId);
            ctx.onRefresh();
        }).open();
    }

    function addTask(event: MouseEvent, status: string): void {
        event.stopPropagation();
        new TaskEditorModal(app, plugin, { status }, columns, false, async data => {
            await view.dataEngine.createTask(scope, data);
            ctx.onRefresh();
        }).open();
    }

    async function setStatus(task: ProjectTask, status: string): Promise<void> {
        if (task.status === status) return;
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { status });
        await view.dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId);
        ctx.onRefresh();
    }

    async function toggleDone(task: ProjectTask): Promise<void> {
        const target = taskDone(task) ? columns[0] : columns[columns.length - 1];
        if (target) await setStatus(task, target);
    }

    async function deleteTask(task: ProjectTask): Promise<void> {
        const message = lang === 'ru' ? `РЈРґР°Р»РёС‚СЊ Р·Р°РґР°С‡Сѓ В«${task.name}В»?` : `Delete task вЂњ${task.name}вЂќ?`;
        if (!await view.confirmModal(message)) return;
        await view.dataEngine.deleteTask(task, scope.sourceType === 'file');
        const next = new Set(ctx.selectedTasks);
        next.delete(task.id);
        ctx.onSelectionChange?.(next);
        ctx.onRefresh();
    }

    async function duplicateTask(task: ProjectTask): Promise<void> {
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), {
            name: `${task.name} (${lang === 'ru' ? 'РєРѕРїРёСЏ' : 'copy'})`
        });
        await view.dataEngine.createTask(scope, data);
        ctx.onRefresh();
    }

    async function toggleSubtask(task: ProjectTask, line: number, checked: boolean): Promise<void> {
        await view.dataEngine.toggleSubtask(task.file, line, checked);
        ctx.onRefresh();
    }

    function localDateKey(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function addDaysLocal(days: number): string {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return localDateKey(date);
    }
    function isOverdue(task: ProjectTask): boolean {
        return Boolean(task.endDate && task.endDate.slice(0, 10) < localDateKey(new Date()) && !taskDone(task));
    }
    function subtaskProgress(task: ProjectTask): { done: number; total: number; pct: number } {
        const total = task.subtasks?.length || 0;
        const done = task.subtasks?.filter(item => item.checked).length || 0;
        return { done, total, pct: total ? Math.round(done / total * 100) : 0 };
    }
    function priorityLabel(value: string): string {
        const keys: Record<string, 'priority_low' | 'priority_medium' | 'priority_high'> = {
            low: 'priority_low', medium: 'priority_medium', high: 'priority_high'
        };
        return keys[value] ? t(lang, keys[value]) : value;
    }

    /** Quick deadline action вЂ” writes startDate/endDate through the regular saveTask path. */
    async function setDeadline(task: ProjectTask, endDate: string): Promise<void> {
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { endDate });
        await view.dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId);
        ctx.onRefresh();
    }

    /** Quick priority action вЂ” writes priority through the regular saveTask path. */
    async function setPriority(task: ProjectTask, priority?: string): Promise<void> {
        if ((task.priority || undefined) === priority) return;
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { priority });
        await view.dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId);
        ctx.onRefresh();
    }

    function deadlineMenu(event: MouseEvent, task: ProjectTask): void {
        event.stopPropagation();
        const menu = new Menu();
        const current = task.endDate?.slice(0, 10);
        menu.addItem(item => item.setTitle(t(lang, 'board_deadline_today'))
            .setChecked(current === localDateKey(new Date()))
            .onClick(() => void setDeadline(task, localDateKey(new Date()))));
        menu.addItem(item => item.setTitle(t(lang, 'board_deadline_tomorrow'))
            .setChecked(current === addDaysLocal(1))
            .onClick(() => void setDeadline(task, addDaysLocal(1))));
        menu.addItem(item => item.setTitle(t(lang, 'board_deadline_week'))
            .onClick(() => void setDeadline(task, addDaysLocal(7))));
        menu.addSeparator();
        menu.addItem(item => item.setTitle(t(lang, 'board_deadline_pick')).setIcon('calendar-clock')
            .onClick(() => editTask(task)));
        if (current) {
            menu.addItem(item => item.setTitle(t(lang, 'board_deadline_clear')).setIcon('x')
                .onClick(() => void setDeadline(task, '')));
        }
        menu.showAtMouseEvent(event);
    }

    function priorityMenu(event: MouseEvent, task: ProjectTask): void {
        event.stopPropagation();
        const menu = new Menu();
        const options: Array<[string | undefined, 'priority_none' | 'priority_low' | 'priority_medium' | 'priority_high']> = [
            [undefined, 'priority_none'], ['low', 'priority_low'], ['medium', 'priority_medium'], ['high', 'priority_high']
        ];
        for (const [value, key] of options) {
            menu.addItem(item => item.setTitle(t(lang, key))
                .setChecked((task.priority || undefined) === value)
                .onClick(() => void setPriority(task, value)));
        }
        menu.showAtMouseEvent(event);
    }

    function openMenu(event: MouseEvent, task: ProjectTask): void {
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem(item => item.setTitle(t(lang, 'board_open_note')).setIcon('file-text')
            .onClick(() => void app.workspace.getLeaf(false).openFile(task.file)));
        menu.addItem(item => item.setTitle(t(lang, 'edit_task')).setIcon('pencil')
            .onClick(() => editTask(task)));
        menu.addSeparator();
        for (const status of columns) {
            menu.addItem(item => item.setTitle(status).setChecked(task.status === status)
                .onClick(() => void setStatus(task, status)));
        }
        menu.addSeparator();
        menu.addItem(item => item.setTitle(t(lang, 'projects_bulk_duplicate')).setIcon('copy')
            .onClick(() => void duplicateTask(task)));
        menu.addItem(item => item.setTitle(t(lang, 'delete')).setIcon('trash-2')
            .onClick(() => void deleteTask(task)));
        menu.showAtMouseEvent(event);
    }

    function handleDragStart(event: DragEvent, taskId: string): void {
        event.dataTransfer?.setData('text/plain', taskId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    }

    async function handleDrop(event: DragEvent, column: string): Promise<void> {
        event.preventDefault();
        hoverColumn = null;
        const taskId = event.dataTransfer?.getData('text/plain');
        const dragged = ctx.allTasks.find(task => task.id === taskId);
        if (!dragged) return;

        const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.kanban-card') : null;
        const siblings = ctx.allTasks
            .filter(task => task.status === column && task.id !== dragged.id)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        const targetIndex = target ? siblings.findIndex(task => task.id === target.dataset.taskId) : -1;
        dragged.status = column;
        siblings.splice(targetIndex >= 0 ? targetIndex : siblings.length, 0, dragged);

        for (const [order, task] of siblings.entries()) {
            const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { status: task.status, order });
            await view.dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId);
        }
        ctx.onRefresh();
    }
</script>

{#if subProjects}
    <section class="subprojects" aria-label={lang === 'ru' ? 'РџРѕРґРїСЂРѕРµРєС‚С‹' : 'Subprojects'}>
        {#each Object.entries(subProjects) as [name, summary] (name)}
            <div class="subproject">
                <span class="subproject-name">{name}</span>
                <span class="subproject-counts">{summary.done}/{summary.total}</span>
                <div class="subproject-bar"><span style={`width:${summary.total ? summary.done / summary.total * 100 : 0}%`}></span></div>
            </div>
        {/each}
    </section>
{/if}

<div class="kanban-board">
    {#each columnsData as column (column.name)}
        {#if column.isCollapsed}
            <button class="collapsed-column" title={t(lang, 'board_expand_column')} on:click={() => toggleColumn(column.name)}>
                <span use:icon={'panel-right-open'}></span><strong>{column.name}</strong><small>{column.tasks.length}</small>
            </button>
        {:else}
            <section
                class="kanban-column"
                class:drag-over={hoverColumn === column.name}
                style={`--column-color:${column.color}`}
                role="list"
                aria-label={`${column.name}: ${column.tasks.length}`}
                on:dragover|preventDefault={() => hoverColumn = column.name}
                on:dragleave={() => hoverColumn = null}
                on:drop={(event) => void handleDrop(event, column.name)}
            >
                <header>
                    <div class="col-title">
                        <i class="dot" aria-hidden="true"></i>
                        <h3>{column.name}</h3>
                        <span class="count">{column.tasks.length}</span>
                    </div>
                    <div class="column-actions">
                        <button title={t(lang, 'board_add_task')} aria-label={t(lang, 'board_add_task')} on:click={(event) => addTask(event, column.name)}><span use:icon={'plus'}></span></button>
                        <button title={t(lang, 'board_collapse_column')} aria-label={t(lang, 'board_collapse_column')} on:click={() => toggleColumn(column.name)}><span use:icon={'panel-right-close'}></span></button>
                    </div>
                </header>

                <div class="cards">
                    {#each column.tasks as task (task.id)}
                        <article
                            class="kanban-card"
                            class:selected={ctx.selectedTasks.has(task.id)}
                            class:done={taskDone(task)}
                            data-task-id={task.id}
                            draggable="true"
                            style={`--task-color:${view.getTaskColor(task, scope.color)}`}
                            animate:flip={{ duration: 180 }}
                            in:fade={{ duration: 120 }}
                            on:dragstart={(event) => handleDragStart(event, task.id)}
                            on:dblclick={() => editTask(task)}
                            on:contextmenu={(event) => openMenu(event, task)}
                        >
                            <div class="card-heading">
                                <input type="checkbox" checked={ctx.selectedTasks.has(task.id)}
                                    aria-label={t(lang, 'board_select')}
                                    on:click|stopPropagation on:change={(event) => selectTask(task, event.currentTarget.checked)} />
                                <button class="task-title" title={t(lang, 'edit_task')} on:click={() => editTask(task)}>{task.name}</button>
                                {#if task.priority}<span class={`pill priority ${task.priority}`}>{priorityLabel(task.priority)}</span>{/if}
                            </div>

                            {#if task.cover && !ctx.compactMode}<img class="cover" src={task.cover} alt="" loading="lazy" />{/if}

                            <div class="metadata">
                                {#if task.habitName}<span class="meta-item"><i use:icon={'repeat-2'}></i>{task.habitName}</span>{/if}
                                {#if task.endDate}
                                    <span class="meta-item due" class:overdue={isOverdue(task)} title={isOverdue(task) ? t(lang, 'board_overdue') : undefined}>
                                        <i use:icon={'calendar-clock'}></i>{task.endDate.slice(0, 10)}
                                    </span>
                                {/if}
                                {#if task.timeSpentSec || task.timeEstimatedSec}
                                    <span class="meta-item"><i use:icon={'clock-3'}></i>{plugin.formatTime(task.timeSpentSec)}{task.timeEstimatedSec ? ` / ${plugin.formatTime(task.timeEstimatedSec)}` : ''}</span>
                                {/if}
                            </div>

                            {#if task.subtasks?.length && !ctx.compactMode}
                                {@const progress = subtaskProgress(task)}
                                <div class="subtask-row">
                                    <div class="subtask-progress"><span style={`width:${progress.pct}%`}></span></div>
                                    <small>{progress.done}/{progress.total}</small>
                                </div>
                                <div class="subtasks">
                                    {#each task.subtasks.slice(0, 4) as subtask}
                                        <label class:checked={subtask.checked}>
                                            <input type="checkbox" checked={subtask.checked} on:change={(event) => void toggleSubtask(task, subtask.line, event.currentTarget.checked)} />
                                            <span>{subtask.text}</span>
                                        </label>
                                    {/each}
                                    {#if task.subtasks.length > 4}<small class="more">+{task.subtasks.length - 4}</small>{/if}
                                </div>
                            {/if}

                            {#if task.tags && !ctx.compactMode}
                                <div class="tags">{#each task.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 4) as tag}<span>#{tag}</span>{/each}</div>
                            {/if}

                            <footer class="quick">
                                <button title={t(lang, 'board_open_note')} aria-label={t(lang, 'board_open_note')} on:click={() => void app.workspace.getLeaf(false).openFile(task.file)}><span use:icon={'file-text'}></span></button>
                                <button title={t(lang, 'board_start_timer')} aria-label={t(lang, 'board_start_timer')} disabled={!task.habitName} on:click={() => void view.dataEngine.startTimerForTask(task, scope.sourceType === 'file')}><span use:icon={'play'}></span></button>
                                <button title={t(lang, 'board_set_deadline')} aria-label={t(lang, 'board_set_deadline')} on:click={(event) => deadlineMenu(event, task)}><span use:icon={'calendar-clock'}></span></button>
                                <button title={t(lang, 'board_set_priority')} aria-label={t(lang, 'board_set_priority')} on:click={(event) => priorityMenu(event, task)}><span use:icon={'flag'}></span></button>
                                <button class:active={taskDone(task)} title={taskDone(task) ? t(lang, 'board_reopen') : t(lang, 'board_complete')} aria-label={taskDone(task) ? t(lang, 'board_reopen') : t(lang, 'board_complete')} on:click={() => void toggleDone(task)}><span use:icon={taskDone(task) ? 'rotate-ccw' : 'check'}></span></button>
                                <button title={t(lang, 'board_more')} aria-label={t(lang, 'board_more')} on:click={(event) => openMenu(event, task)}><span use:icon={'ellipsis'}></span></button>
                            </footer>
                        </article>
                    {/each}
                    {#if !column.tasks.length}
                        <div class="column-empty" class:active={hoverColumn === column.name}>
                            <span class="empty-icon" use:icon={'inbox'}></span>
                            <span>{t(lang, 'board_column_empty')}</span>
                        </div>
                    {/if}
                </div>
            </section>
        {/if}
    {/each}
</div>

<style>
    .subprojects { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px; margin-bottom:2px; }
    .subproject { display:grid; grid-template-columns:1fr auto; gap:5px 10px; padding:9px 12px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); }
    .subproject-name { overflow:hidden; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
    .subproject-counts { color:var(--text-muted); }
    .subproject-bar { grid-column:1/-1; height:4px; overflow:hidden; border-radius:2px; background:var(--background-modifier-border); }
    .subproject-bar span { display:block; height:100%; border-radius:2px; background:var(--interactive-accent); }

    .kanban-board { display:flex; gap:12px; min-height:100%; padding:2px; overflow-x:auto; align-items:stretch; }
    .kanban-column { display:flex; flex:0 0 300px; flex-direction:column; min-width:0; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-secondary); transition:outline .1s ease, background .12s ease; }
    .kanban-column.drag-over { outline:2px dashed var(--interactive-accent); outline-offset:-2px; background:var(--background-modifier-hover); }
    .kanban-column > header { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:44px; padding:8px 8px 8px 12px; border-bottom:1px solid var(--background-modifier-border); }
    .col-title { display:flex; align-items:center; gap:8px; min-width:0; }
    .col-title .dot { display:block; flex-shrink:0; width:9px; height:9px; border-radius:50%; background:var(--column-color); }
    h3 { margin:0; overflow:hidden; font-size:.9rem; text-overflow:ellipsis; white-space:nowrap; }
    .count { min-width:22px; padding:1px 7px; border-radius:9px; background:color-mix(in srgb, var(--column-color) 14%, transparent); color:var(--column-color); font-size:.68rem; font-weight:600; text-align:center; }
    .column-actions button, .quick button { display:grid; place-items:center; width:27px; height:27px; padding:5px; }
    .column-actions span, .quick span, .collapsed-column > span { width:15px; height:15px; }
    .cards { display:flex; flex:1; flex-direction:column; gap:9px; min-height:80px; padding:9px; overflow-y:auto; }

    .kanban-card { position:relative; flex-shrink:0; overflow:hidden; border:1px solid var(--background-modifier-border); border-left:3px solid var(--task-color,var(--interactive-accent)); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); cursor:grab; transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
    .kanban-card:hover { border-color:var(--background-modifier-border-hover); box-shadow:var(--shadow-m); transform:translateY(-2px); }
    .kanban-card.selected { box-shadow:inset 0 0 0 1px var(--interactive-accent), var(--shadow-s); }
    .kanban-card.done .task-title { color:var(--text-muted); text-decoration:line-through; }

    .card-heading { display:flex; align-items:flex-start; gap:8px; padding:11px 11px 5px; }
    .card-heading input { flex:0 0 auto; margin-top:3px; }
    .task-title { flex:1; min-width:0; padding:0; border:0; background:transparent; box-shadow:none; color:var(--text-normal); font:inherit; font-size:.86rem; font-weight:600; line-height:1.3; text-align:left; overflow-wrap:anywhere; }
    .task-title:hover { background:transparent; color:var(--text-accent); }
    .pill { display:inline-flex; flex:0 0 auto; align-items:center; padding:1px 8px; border-radius:999px; font-size:.58rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    .priority { border:1px solid currentColor; background:var(--background-secondary); }
    .priority.low { color:var(--text-success); background:color-mix(in srgb, var(--text-success) 12%, transparent); }
    .priority.medium { color:var(--text-warning); background:color-mix(in srgb, var(--text-warning) 14%, transparent); }
    .priority.high { color:var(--text-error); background:color-mix(in srgb, var(--text-error) 12%, transparent); }

    .cover { width:calc(100% - 22px); max-height:115px; margin:3px 11px 7px; border-radius:var(--radius-m); object-fit:cover; }

    .metadata { display:flex; flex-wrap:wrap; gap:4px; padding:3px 11px 7px; }
    .meta-item { display:inline-flex; align-items:center; gap:4px; min-width:0; padding:2px 7px; border-radius:999px; background:var(--background-secondary); color:var(--text-muted); font-size:.66rem; }
    .meta-item i { display:block; width:11px; height:11px; }
    .meta-item.due.overdue { background:color-mix(in srgb, var(--text-error) 12%, transparent); color:var(--text-error); font-weight:600; }

    .subtask-row { display:flex; align-items:center; gap:8px; margin:0 11px 5px; }
    .subtask-progress { flex:1; height:4px; overflow:hidden; border-radius:2px; background:var(--background-modifier-border); }
    .subtask-progress span { display:block; height:100%; border-radius:2px; background:var(--interactive-accent); transition:width .2s ease; }
    .subtask-row small { flex-shrink:0; color:var(--text-faint); font-size:.62rem; }
    .subtasks { display:flex; flex-direction:column; gap:2px; padding:0 11px 7px; }
    .subtasks label { display:flex; align-items:flex-start; gap:6px; min-width:0; color:var(--text-muted); font-size:.68rem; }
    .subtasks label.checked span { text-decoration:line-through; opacity:.7; }
    .subtasks input { flex:0 0 auto; margin-top:2px; }
    .subtasks span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .subtasks .more { padding-left:22px; color:var(--text-faint); }

    .tags { display:flex; flex-wrap:wrap; gap:4px; padding:0 11px 8px; }
    .tags span { padding:2px 7px; border-radius:999px; background:var(--background-secondary); color:var(--text-muted); font-size:.61rem; }

    .quick { position:sticky; bottom:0; display:flex; justify-content:flex-end; gap:3px; padding:6px 8px; border-top:1px solid var(--background-modifier-border); background:var(--background-secondary-alt); opacity:0; transition:opacity .12s ease; }
    .kanban-card:hover .quick, .kanban-card:focus-within .quick { opacity:1; }
    @media (hover: none) { .quick { opacity:1; } }
    .quick button.active { color:var(--text-success); }

    .column-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; min-height:96px; padding:14px; border:1px dashed var(--background-modifier-border); border-radius:var(--radius-m); color:var(--text-faint); font-size:.72rem; text-align:center; transition:border-color .12s ease, background .12s ease; }
    .column-empty.active { border-color:var(--interactive-accent); background:color-mix(in srgb, var(--interactive-accent) 7%, transparent); }
    .column-empty .empty-icon :global(svg) { width:22px; height:22px; }

    .collapsed-column { display:flex; flex:0 0 40px; width:40px; align-items:center; gap:10px; padding:9px 7px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-secondary); color:var(--text-muted); writing-mode:vertical-rl; }
    .collapsed-column strong { overflow:hidden; font-size:.76rem; text-overflow:ellipsis; white-space:nowrap; }
    .collapsed-column small { color:var(--text-faint); }

    @media (max-width:600px) {
        .kanban-column { flex-basis:270px; }
        .quick button { width:31px; height:31px; }
    }
</style>
