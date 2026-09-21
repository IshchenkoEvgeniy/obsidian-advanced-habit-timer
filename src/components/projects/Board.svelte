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
    $: columnsData = columns.map(name => ({
        name,
        isCollapsed: collapsedColumns.has(name),
        tasks: ctx.filteredTasks
            .filter(task => task.status === name)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
    }));
    $: subProjects = buildSubprojects();

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
        const message = lang === 'ru' ? `Удалить задачу «${task.name}»?` : `Delete task “${task.name}”?`;
        if (!await view.confirmModal(message)) return;
        await view.dataEngine.deleteTask(task, scope.sourceType === 'file');
        const next = new Set(ctx.selectedTasks);
        next.delete(task.id);
        ctx.onSelectionChange?.(next);
        ctx.onRefresh();
    }

    async function duplicateTask(task: ProjectTask): Promise<void> {
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), {
            name: `${task.name} (${lang === 'ru' ? 'копия' : 'copy'})`
        });
        await view.dataEngine.createTask(scope, data);
        ctx.onRefresh();
    }

    async function toggleSubtask(task: ProjectTask, line: number, checked: boolean): Promise<void> {
        await view.dataEngine.toggleSubtask(task.file, line, checked);
        ctx.onRefresh();
    }

    function openMenu(event: MouseEvent, task: ProjectTask): void {
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem(item => item.setTitle(lang === 'ru' ? 'Открыть заметку' : 'Open note').setIcon('file-text')
            .onClick(() => void app.workspace.getLeaf(false).openFile(task.file)));
        menu.addItem(item => item.setTitle(lang === 'ru' ? 'Редактировать' : 'Edit').setIcon('pencil')
            .onClick(() => editTask(task)));
        menu.addSeparator();
        for (const status of columns) {
            menu.addItem(item => item.setTitle(status).setChecked(task.status === status)
                .onClick(() => void setStatus(task, status)));
        }
        menu.addSeparator();
        menu.addItem(item => item.setTitle(lang === 'ru' ? 'Дублировать' : 'Duplicate').setIcon('copy')
            .onClick(() => void duplicateTask(task)));
        menu.addItem(item => item.setTitle(lang === 'ru' ? 'Удалить' : 'Delete').setIcon('trash-2')
            .onClick(() => void deleteTask(task)));
        menu.showAtMouseEvent(event);
    }

    function subtaskProgress(task: ProjectTask): number {
        if (!task.subtasks?.length) return 0;
        return Math.round(task.subtasks.filter(item => item.checked).length / task.subtasks.length * 100);
    }

    function isOverdue(task: ProjectTask): boolean {
        return Boolean(task.endDate && task.endDate < new Date().toISOString().slice(0, 10) && !taskDone(task));
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
    <section class="subprojects" aria-label={lang === 'ru' ? 'Подпроекты' : 'Subprojects'}>
        {#each Object.entries(subProjects) as [name, summary]}
            <div class="subproject">
                <span>{name}</span><small>{summary.done}/{summary.total}</small>
                <div><span style:width={`${summary.total ? summary.done / summary.total * 100 : 0}%`}></span></div>
            </div>
        {/each}
    </section>
{/if}

<div class="kanban-board">
    {#each columnsData as column (column.name)}
        {#if column.isCollapsed}
            <button class="collapsed-column" title={lang === 'ru' ? 'Развернуть колонку' : 'Expand column'} on:click={() => toggleColumn(column.name)}>
                <span use:icon={'panel-right-open'}></span><strong>{column.name}</strong><small>{column.tasks.length}</small>
            </button>
        {:else}
            <section class:hovered={hoverColumn === column.name} class="kanban-column" role="list"
                aria-label={`${column.name}: ${column.tasks.length}`}
                on:dragover|preventDefault={() => hoverColumn = column.name}
                on:dragleave={() => hoverColumn = null}
                on:drop={(event) => void handleDrop(event, column.name)}>
                <header>
                    <div><h3>{column.name}</h3><span>{column.tasks.length}</span></div>
                    <div class="column-actions">
                        <button title={lang === 'ru' ? 'Добавить задачу' : 'Add task'} on:click={(event) => addTask(event, column.name)}><span use:icon={'plus'}></span></button>
                        <button title={lang === 'ru' ? 'Свернуть колонку' : 'Collapse column'} on:click={() => toggleColumn(column.name)}><span use:icon={'panel-right-close'}></span></button>
                    </div>
                </header>

                <div class="cards">
                    {#each column.tasks as task (task.id)}
                        <article class:selected={ctx.selectedTasks.has(task.id)} class:done={taskDone(task)} class="kanban-card"
                            data-task-id={task.id} draggable="true" style={`--task-color:${view.getTaskColor(task, scope.color)}`}
                            animate:flip={{ duration: 180 }} in:fade={{ duration: 120 }}
                            on:dragstart={(event) => handleDragStart(event, task.id)} on:dblclick={() => editTask(task)}
                            on:contextmenu={(event) => openMenu(event, task)}>
                            <div class="card-heading">
                                <input type="checkbox" checked={ctx.selectedTasks.has(task.id)}
                                    aria-label={lang === 'ru' ? 'Выбрать задачу' : 'Select task'}
                                    on:click|stopPropagation on:change={(event) => selectTask(task, event.currentTarget.checked)} />
                                <button class="task-title" title={lang === 'ru' ? 'Редактировать задачу' : 'Edit task'} on:click={() => editTask(task)}>{task.name}</button>
                                {#if task.priority}<span class="priority {task.priority}">{task.priority}</span>{/if}
                            </div>

                            {#if task.cover && !ctx.compactMode}<img class="cover" src={task.cover} alt="" loading="lazy" />{/if}

                            <div class="metadata">
                                {#if task.habitName}<span><i use:icon={'repeat-2'}></i>{task.habitName}</span>{/if}
                                {#if task.endDate}<span class:overdue={isOverdue(task)}><i use:icon={'calendar'}></i>{task.endDate}</span>{/if}
                                {#if task.timeSpentSec || task.timeEstimatedSec}
                                    <span><i use:icon={'clock-3'}></i>{plugin.formatTime(task.timeSpentSec)}{task.timeEstimatedSec ? ` / ${plugin.formatTime(task.timeEstimatedSec)}` : ''}</span>
                                {/if}
                            </div>

                            {#if task.subtasks?.length && !ctx.compactMode}
                                <div class="subtask-progress"><span style:width={`${subtaskProgress(task)}%`}></span></div>
                                <div class="subtasks">
                                    {#each task.subtasks.slice(0, 4) as subtask}
                                        <label class:checked={subtask.checked}>
                                            <input type="checkbox" checked={subtask.checked} on:change={(event) => void toggleSubtask(task, subtask.line, event.currentTarget.checked)} />
                                            <span>{subtask.text}</span>
                                        </label>
                                    {/each}
                                    {#if task.subtasks.length > 4}<small>+{task.subtasks.length - 4}</small>{/if}
                                </div>
                            {/if}

                            {#if task.tags && !ctx.compactMode}
                                <div class="tags">{#each task.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 4) as tag}<span>#{tag}</span>{/each}</div>
                            {/if}

                            <footer>
                                <button title={lang === 'ru' ? 'Открыть заметку' : 'Open note'} on:click={() => void app.workspace.getLeaf(false).openFile(task.file)}><span use:icon={'file-text'}></span></button>
                                <button title={lang === 'ru' ? 'Запустить таймер' : 'Start timer'} disabled={!task.habitName} on:click={() => void view.dataEngine.startTimerForTask(task, scope.sourceType === 'file')}><span use:icon={'play'}></span></button>
                                <button class:active={taskDone(task)} title={taskDone(task) ? (lang === 'ru' ? 'Вернуть в работу' : 'Reopen') : (lang === 'ru' ? 'Завершить' : 'Complete')} on:click={() => void toggleDone(task)}><span use:icon={taskDone(task) ? 'rotate-ccw' : 'check'}></span></button>
                                <button title={lang === 'ru' ? 'Редактировать' : 'Edit'} on:click={() => editTask(task)}><span use:icon={'pencil'}></span></button>
                                <button class="danger" title={lang === 'ru' ? 'Удалить' : 'Delete'} on:click={() => void deleteTask(task)}><span use:icon={'trash-2'}></span></button>
                                <button title={lang === 'ru' ? 'Другие действия' : 'More actions'} on:click={(event) => openMenu(event, task)}><span use:icon={'ellipsis'}></span></button>
                            </footer>
                        </article>
                    {/each}
                    {#if !column.tasks.length}<div class="column-empty">{lang === 'ru' ? 'Перетащите задачу сюда' : 'Drop a task here'}</div>{/if}
                </div>
            </section>
        {/if}
    {/each}
</div>

<style>
    .subprojects { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px; margin-bottom:10px; }
    .subproject { display:grid; grid-template-columns:1fr auto; gap:5px 10px; padding:8px 10px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-secondary); }
    .subproject > span { overflow:hidden; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }.subproject small { color:var(--text-muted); }
    .subproject > div { grid-column:1/-1; height:3px; overflow:hidden; background:var(--background-modifier-border); }.subproject > div span { display:block; height:100%; background:var(--interactive-accent); }
    .kanban-board { display:flex; gap:12px; min-height:100%; padding:2px; overflow-x:auto; align-items:stretch; }
    .kanban-column { display:flex; flex:0 0 300px; flex-direction:column; min-width:0; border:1px solid var(--background-modifier-border); border-radius:7px; background:var(--background-secondary); transition:border-color .15s,background .15s; }
    .kanban-column.hovered { border-color:var(--interactive-accent); background:var(--background-modifier-hover); }
    .kanban-column > header { display:flex; align-items:center; justify-content:space-between; min-height:42px; padding:7px 8px 7px 11px; border-bottom:1px solid var(--background-modifier-border); }
    header > div { display:flex; align-items:center; gap:7px; min-width:0; } h3 { margin:0; overflow:hidden; font-size:.9rem; text-overflow:ellipsis; white-space:nowrap; }
    header > div > span { min-width:20px; padding:1px 5px; border-radius:3px; background:var(--background-primary); color:var(--text-muted); font-size:.68rem; text-align:center; }
    .column-actions button,.kanban-card footer button { display:grid; place-items:center; width:27px; height:27px; padding:5px; }
    .column-actions span,.kanban-card footer span,.collapsed-column > span { width:15px; height:15px; }
    .cards { display:flex; flex:1; flex-direction:column; gap:8px; min-height:80px; padding:8px; overflow-y:auto; }
    .kanban-card { position:relative; flex-shrink:0; overflow:hidden; border:1px solid var(--background-modifier-border); border-left:3px solid var(--task-color,var(--interactive-accent)); border-radius:6px; background:var(--background-primary); box-shadow:0 1px 2px rgba(0,0,0,.08); cursor:grab; }
    .kanban-card:hover { border-color:var(--background-modifier-border-hover); }.kanban-card.selected { box-shadow:inset 0 0 0 1px var(--interactive-accent); }.kanban-card.done .task-title { color:var(--text-muted); text-decoration:line-through; }
    .card-heading { display:flex; align-items:flex-start; gap:7px; padding:10px 10px 5px; }.card-heading input { flex:0 0 auto; margin-top:3px; }
    .task-title { flex:1; min-width:0; padding:0; border:0; background:transparent; box-shadow:none; color:var(--text-normal); font:inherit; font-size:.86rem; font-weight:600; line-height:1.3; text-align:left; overflow-wrap:anywhere; }
    .task-title:hover { background:transparent; color:var(--text-accent); }.priority { flex:0 0 auto; padding:2px 4px; border-radius:3px; background:var(--background-secondary); font-size:.58rem; text-transform:uppercase; }.priority.high { color:var(--text-error); }.priority.medium { color:var(--text-warning); }.priority.low { color:var(--text-success); }
    .cover { width:calc(100% - 20px); max-height:115px; margin:3px 10px 7px; border-radius:4px; object-fit:cover; }
    .metadata { display:flex; flex-wrap:wrap; gap:4px 10px; padding:3px 10px 7px; color:var(--text-muted); font-size:.68rem; }.metadata span { display:flex; align-items:center; gap:4px; min-width:0; }.metadata i { display:block; width:12px; height:12px; }.metadata .overdue { color:var(--text-error); }
    .subtask-progress { height:3px; margin:0 10px 5px; overflow:hidden; background:var(--background-modifier-border); }.subtask-progress span { display:block; height:100%; background:var(--interactive-accent); }
    .subtasks { display:flex; flex-direction:column; gap:2px; padding:0 10px 7px; }.subtasks label { display:flex; align-items:flex-start; gap:6px; min-width:0; color:var(--text-muted); font-size:.68rem; }.subtasks label.checked span { text-decoration:line-through; opacity:.7; }.subtasks input { flex:0 0 auto; margin-top:2px; }.subtasks span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.subtasks small { padding-left:22px; color:var(--text-faint); }
    .tags { display:flex; flex-wrap:wrap; gap:4px; padding:0 10px 8px; }.tags span { padding:2px 4px; border-radius:3px; background:var(--background-secondary); color:var(--text-muted); font-size:.61rem; }
    .kanban-card footer { display:flex; justify-content:flex-end; gap:3px; padding:6px 7px; border-top:1px solid var(--background-modifier-border); background:var(--background-secondary-alt); }.kanban-card footer button.active { color:var(--text-success); }.kanban-card footer button.danger:hover { color:var(--text-error); }
    .column-empty { display:grid; min-height:72px; place-items:center; border:1px dashed var(--background-modifier-border); border-radius:5px; color:var(--text-faint); font-size:.72rem; text-align:center; }
    .collapsed-column { display:flex; flex:0 0 40px; width:40px; align-items:center; gap:10px; padding:9px 7px; border:1px solid var(--background-modifier-border); border-radius:7px; background:var(--background-secondary); color:var(--text-muted); writing-mode:vertical-rl; }.collapsed-column strong { overflow:hidden; font-size:.76rem; text-overflow:ellipsis; white-space:nowrap; }.collapsed-column small { color:var(--text-faint); }
    @media (max-width:600px) { .kanban-column { flex-basis:270px; }.kanban-card footer button { width:31px; height:31px; } }
</style>
