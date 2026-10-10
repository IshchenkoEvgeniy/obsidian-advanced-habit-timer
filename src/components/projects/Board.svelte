<script lang="ts">
    import { Menu, Modal, Notice, setIcon, type App } from 'obsidian';
    import type { Action } from 'svelte/action';
    import { afterUpdate, onMount } from 'svelte';
    import { flip } from 'svelte/animate';
    import { fade } from 'svelte/transition';
    import type HabitTimerPlugin from '../../main';
    import { TaskEditorModal } from '../../projects/modals/task-editor';
    import ProjectTaskCreateForm from './ProjectTaskCreateForm.svelte';
    import { addProjectImageMenuItems } from '../../projects/project-image-actions';
    import { checklistNoteLink } from '../../projects/checklist-notes';
    import { projectTaskToData } from '../../projects/task-data';
    import { projectStatusColor } from '../../projects/checklist-status';
    import { taskDisplayTitle } from '../../projects/engine/task-identity';
    import { extractProjectImageReferences, resolveProjectImage } from '../../projects/image-utils';
    import type { ProjectScopeDefinition, ProjectTask, ProjectSubtask, TaskData } from '../../projects/types';
    import { boardHierarchyMatches, boardVisibleSubtasks, moveBoardTask } from '../../projects/board-actions';
    import { observeBoardScroll, type BoardScrollController } from '../../projects/board-scroll';
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
    let createDefaults: Partial<TaskData> | null = null;
    let createScopeId = '';
    let createBusy = false;
    let actionBusy = false;
    let boardViewport: HTMLDivElement;
    let boardCanvas: HTMLDivElement;
    let boardScroll: BoardScrollController | undefined;
    const boardViewportId = `project-board-${Math.random().toString(36).slice(2)}`;
    let scrollThumbSize = 100;
    let scrollLimit = 0;
    let scrollPosition = 0;
    let horizontalOverflow = false;
    let canScrollLeft = false;
    let canScrollRight = false;

    function syncScrollPosition(): void {
        scrollPosition = Math.max(0, Math.min(scrollLimit, boardViewport.scrollLeft));
        canScrollLeft = scrollPosition > 1;
        canScrollRight = scrollPosition < scrollLimit - 1;
    }

    onMount(() => {
        boardScroll = observeBoardScroll(boardViewport, boardCanvas, metrics => {
            scrollLimit = metrics.limit;
            horizontalOverflow = scrollLimit > 1;
            scrollThumbSize = metrics.thumbSize;
            syncScrollPosition();
        });
        return () => {
            boardScroll?.destroy();
            boardScroll = undefined;
        };
    });

    afterUpdate(() => boardScroll?.schedule());

    function scrollToPosition(position: number): void {
        boardScroll?.measure();
        boardViewport.scrollLeft = Math.max(0, Math.min(scrollLimit, position));
        syncScrollPosition();
    }

    function scrollColumns(direction: number): void {
        boardScroll?.measure();
        boardViewport.scrollBy({ left: direction * Math.max(300, boardViewport.clientWidth * .7), behavior: 'smooth' });
    }

    function handleScrollbarKey(event: KeyboardEvent): void {
        boardScroll?.measure();
        const page = boardViewport.clientWidth * .7;
        const offsets: Record<string, number> = { ArrowLeft: -60, ArrowRight: 60, PageUp: -page, PageDown: page };
        if (event.key === 'Home' || event.key === 'End' || event.key in offsets) {
            event.preventDefault();
            const left = event.key === 'Home' ? 0 : event.key === 'End' ? scrollLimit :
                boardViewport.scrollLeft + offsets[event.key]!;
            scrollToPosition(left);
        }
    }

    $: lang = plugin.settings.language;
    $: columns = ctx.columns;
    $: hierarchyMatches = boardHierarchyMatches(ctx.allTasks, ctx.filteredTasks);
    $: columnsData = columns.map(name => ({
        name,
        color: projectStatusColor(scope, name, columns),
        isCollapsed: collapsedColumns.has(name),
        tasks: ctx.allTasks.filter(task => !task.parentId && hierarchyMatches.has(task.id))
            .filter(task => task.status === name)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
    }));
    $: subProjects = buildSubprojects();

    async function runAction(action: () => Promise<unknown>): Promise<void> {
        if (actionBusy) return;
        actionBusy = true;
        try { await action(); }
        catch (error) { new Notice(String(error)); }
        finally { actionBusy = false; ctx.onRefresh(); }
    }

    function visibleSubtasks(task: ProjectTask): ProjectSubtask[] {
        return boardVisibleSubtasks(task, ctx.allTasks, ctx.filteredTasks, taskDone);
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
            await view.dataEngine.saveEditedTask(scope, task, data, columns);
            ctx.onRefresh();
        }, [], task.notePath || task.file.path).open();
    }

    function addTask(event: MouseEvent, status: string): void {
        event.stopPropagation();
        if (createBusy || actionBusy) return;
        createDefaults = { status };
        createScopeId = scope.id;
    }

    async function setStatus(task: ProjectTask, status: string): Promise<void> {
        if (task.status === status) return;
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { status });
        await runAction(() => view.dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId, task.sourceLine));
    }

    async function toggleDone(task: ProjectTask): Promise<void> {
        const target = taskDone(task) ? columns[0] : columns[columns.length - 1];
        if (target) await setStatus(task, target);
    }

    async function deleteTask(task: ProjectTask): Promise<void> {
        const message = lang === 'ru' ? `Удалить задачу «${task.name}»?` : `Delete task “${task.name}”?`;
        if (!await view.confirmModal(message)) return;
        await runAction(async () => {
            await view.dataEngine.deleteTask(task, scope.sourceType === 'file');
            const next = new Set(ctx.selectedTasks);
            next.delete(task.id);
            ctx.onSelectionChange?.(next);
        });
    }

    async function duplicateTask(task: ProjectTask): Promise<void> {
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), {
            name: `${task.name} (${lang === 'ru' ? 'копия' : 'copy'})`
        });
        await runAction(() => view.dataEngine.createTask(scope, data));
    }

    async function toggleSubtask(task: ProjectTask, subtask: ProjectSubtask, checked: boolean): Promise<void> {
        await runAction(() => view.dataEngine.toggleSubtask(task.file, subtask, checked));
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

    function taskImages(task: ProjectTask): { reference: string; src: string }[] {
        const references = [task.cover, ...(task.images || [])]
            .filter((value): value is string => Boolean(value?.trim()))
            .map(reference => ({ reference: reference.trim(), sourcePath: task.file.path }));
        references.push(...extractProjectImageReferences(task.description || '')
            .map(reference => ({ reference, sourcePath: task.notePath || task.file.path })));
        const seenSources = new Set<string>();
        return references.flatMap(({ reference, sourcePath }) => {
            const src = resolveProjectImage(app, reference, sourcePath);
            if (!src || seenSources.has(src)) return [];
            seenSources.add(src);
            return [{ reference, src }];
        });
    }

    function previewImage(image: { reference: string; src: string }, title: string): void {
        const modal = new Modal(app);
        modal.setTitle(title);
        const preview = modal.contentEl.createEl('img', { attr: { src: image.src, alt: title } });
        preview.setCssStyles({ display: 'block', maxWidth: '85vw', maxHeight: '75vh', margin: '0 auto', objectFit: 'contain' });
        modal.open();
    }

    /** Quick deadline action uses the regular save path. */
    async function setDeadline(task: ProjectTask, endDate: string): Promise<void> {
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { endDate });
        await runAction(() => view.dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId, task.sourceLine));
    }

    /** Quick priority action uses the regular save path. */
    async function setPriority(task: ProjectTask, priority?: string): Promise<void> {
        if ((task.priority || undefined) === priority) return;
        const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { priority });
        await runAction(() => view.dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, columns, task.blockId, task.sourceLine));
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
        event.preventDefault();
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem(item => item.setTitle(t(lang, 'board_open_note')).setIcon('file-text')
            .onClick(() => void app.workspace.openLinkText(checklistNoteLink(task) || (task.blockId ? `${task.file.path}#^${task.blockId}` : task.file.path), task.file.path, false)));
        menu.addItem(item => item.setTitle(t(lang, 'edit_task')).setIcon('pencil')
            .onClick(() => editTask(task)));
        addProjectImageMenuItems(menu, { app, dataEngine: view.dataEngine, scope, task, lang,
            ownerDocument: boardViewport.ownerDocument, onRefresh: ctx.onRefresh });
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
        if (!taskId) return;
        const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('.kanban-card') : null;
        await runAction(() => moveBoardTask(view.dataEngine, scope, ctx.allTasks, taskId, column,
            target?.dataset.taskId, seconds => plugin.formatTime(seconds), columns));
    }
</script>

<div class="board-layout">
{#if subProjects || createDefaults && createScopeId === scope.id}
<div class="board-extras">
{#if subProjects}
    <section class="subprojects" aria-label={lang === 'ru' ? 'Подпроекты' : 'Subprojects'}>
        {#each Object.entries(subProjects) as [name, summary] (name)}
            <div class="subproject">
                <span class="subproject-name">{name}</span>
                <span class="subproject-counts">{summary.done}/{summary.total}</span>
                <div class="subproject-bar"><span style={`width:${summary.total ? summary.done / summary.total * 100 : 0}%`}></span></div>
            </div>
        {/each}
    </section>
{/if}

{#if createDefaults && createScopeId === scope.id}
    {#key createDefaults}
        <ProjectTaskCreateForm {plugin} dataEngine={view.dataEngine} {scope} {ctx}
            initialData={createDefaults} bind:busy={createBusy} onClose={() => createDefaults = null} />
    {/key}
{/if}

</div>
{/if}

<div class="board-navigation">
    <button title={lang === 'ru' ? 'Прокрутить колонки влево' : 'Scroll columns left'}
        aria-label={lang === 'ru' ? 'Прокрутить колонки влево' : 'Scroll columns left'}
        disabled={!canScrollLeft} on:click={() => scrollColumns(-1)}><span use:icon={'chevron-left'}></span></button>
    <input class="horizontal-scrollbar" type="range" min="0" max={scrollLimit} step="1" value={scrollPosition} disabled={!horizontalOverflow}
        style={`--scroll-thumb-size:${scrollThumbSize}%`} aria-controls={boardViewportId} aria-orientation="horizontal"
        aria-label={lang === 'ru' ? 'Горизонтальная прокрутка доски' : 'Board horizontal scrolling'}
        on:input={(event) => scrollToPosition(Number(event.currentTarget.value))} on:keydown={handleScrollbarKey} />
    <button title={lang === 'ru' ? 'Прокрутить колонки вправо' : 'Scroll columns right'}
        aria-label={lang === 'ru' ? 'Прокрутить колонки вправо' : 'Scroll columns right'}
        disabled={!canScrollRight} on:click={() => scrollColumns(1)}><span use:icon={'chevron-right'}></span></button>
</div>

<div class="board-viewport" id={boardViewportId} bind:this={boardViewport}>
<div class="kanban-board" bind:this={boardCanvas}>
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
                            draggable={!actionBusy}
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

                            {#if !ctx.compactMode}
                                {@const images = taskImages(task)}
                                {#if images.length}
                                    <div class="card-images">
                                        {#each images.slice(0, 5) as image, index (image.reference)}
                                            <button class="card-image" class:cover-image={index === 0} class:thumbnail={index > 0}
                                                title={image.reference} aria-label={lang === 'ru' ? `Открыть изображение: ${image.reference}` : `Open image: ${image.reference}`}
                                                on:click|stopPropagation={() => previewImage(image, task.name)}>
                                                <img src={image.src} alt={task.name} loading="lazy" draggable="false" />
                                            </button>
                                        {/each}
                                        {#if images.length > 5}<small class="image-overflow">+{images.length - 5}</small>{/if}
                                    </div>
                                {/if}
                            {/if}

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
                                    {#each visibleSubtasks(task).slice(0, 4) as subtask}
                                        <label class:checked={subtask.checked}>
                                            <input type="checkbox" disabled={actionBusy} checked={subtask.checked} on:change={(event) => void toggleSubtask(task, subtask, event.currentTarget.checked)} />
                                            <span>{taskDisplayTitle(subtask.text)}</span>
                                        </label>
                                    {/each}
                                    {#if visibleSubtasks(task).length > 4}<small class="more">+{visibleSubtasks(task).length - 4}</small>{/if}
                                </div>
                            {/if}

                            {#if task.tags && !ctx.compactMode}
                                <div class="tags">{#each task.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 4) as tag}<span>#{tag}</span>{/each}</div>
                            {/if}

                            <footer class="quick">
                                <button title={t(lang, 'board_open_note')} aria-label={t(lang, 'board_open_note')} on:click={() => void app.workspace.openLinkText(checklistNoteLink(task) || (task.blockId ? `${task.file.path}#^${task.blockId}` : task.file.path), task.file.path, false)}><span use:icon={'file-text'}></span></button>
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
</div>
</div>

<style>
    .board-layout { box-sizing:border-box; display:flex; flex-direction:column; gap:8px; width:100%; max-width:100%; height:100%; min-height:0; min-width:0; overflow:hidden; }
    .board-extras { display:flex; flex:0 1 auto; flex-direction:column; gap:8px; max-height:45%; min-height:0; overflow-y:auto; }
    .board-navigation { display:flex; flex:0 0 auto; align-items:center; gap:6px; min-width:0; padding:2px 0; }
    .board-navigation button { display:grid; flex:0 0 26px; place-items:center; width:26px; height:24px; min-height:0; padding:4px; box-shadow:none; }
    .board-navigation button span { display:block; width:16px; height:16px; }
    .horizontal-scrollbar { appearance:none; -webkit-appearance:none; display:block; flex:1; width:100%; min-width:0; height:18px; min-height:0; margin:0; padding:0; border:0; border-radius:5px; background:transparent; box-shadow:none; cursor:pointer; }
    .horizontal-scrollbar:focus-visible { outline:2px solid var(--interactive-accent); outline-offset:2px; border-radius:var(--radius-s); }
    .horizontal-scrollbar::-webkit-slider-runnable-track { height:10px; border-radius:5px; background:var(--background-secondary); }
    .horizontal-scrollbar::-webkit-slider-thumb { appearance:none; -webkit-appearance:none; width:clamp(32px,var(--scroll-thumb-size),100%); height:10px; margin:0; border:0; border-radius:5px; background:var(--text-muted); box-shadow:none; cursor:grab; }
    .horizontal-scrollbar:active::-webkit-slider-thumb { cursor:grabbing; }
    .horizontal-scrollbar::-moz-range-track { height:10px; border-radius:5px; background:var(--background-secondary); }
    .horizontal-scrollbar::-moz-range-thumb { width:clamp(32px,var(--scroll-thumb-size),100%); height:10px; border:0; border-radius:5px; background:var(--text-muted); box-shadow:none; cursor:grab; }
    .board-viewport { flex:1; width:100%; max-width:100%; min-height:0; min-width:0; overflow-x:auto; overflow-y:hidden; scrollbar-width:none; }
    .board-viewport::-webkit-scrollbar { display:none; }
    .subprojects { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px; margin-bottom:2px; }
    .subproject { display:grid; grid-template-columns:1fr auto; gap:5px 10px; padding:9px 12px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); }
    .subproject-name { overflow:hidden; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
    .subproject-counts { color:var(--text-muted); }
    .subproject-bar { grid-column:1/-1; height:4px; overflow:hidden; border-radius:2px; background:var(--background-modifier-border); }
    .subproject-bar span { display:block; height:100%; border-radius:2px; background:var(--interactive-accent); }

    .kanban-board { box-sizing:border-box; display:flex; gap:12px; width:max-content; min-width:100%; height:100%; padding:2px; align-items:stretch; }
    .kanban-column { box-sizing:border-box; display:flex; flex:0 0 300px; flex-direction:column; min-width:0; max-height:100%; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-secondary); transition:outline .1s ease, background .12s ease; }
    .kanban-column.drag-over { outline:2px dashed var(--interactive-accent); outline-offset:-2px; background:var(--background-modifier-hover); }
    .kanban-column > header { display:flex; flex-shrink:0; align-items:center; justify-content:space-between; gap:8px; min-height:44px; padding:8px 8px 8px 12px; border-bottom:1px solid var(--background-modifier-border); }
    .col-title { display:flex; align-items:center; gap:8px; min-width:0; }
    .col-title .dot { display:block; flex-shrink:0; width:9px; height:9px; border-radius:50%; background:var(--column-color); }
    h3 { margin:0; overflow:hidden; font-size:.9rem; text-overflow:ellipsis; white-space:nowrap; }
    .count { min-width:22px; padding:1px 7px; border-radius:9px; background:color-mix(in srgb, var(--column-color) 14%, transparent); color:var(--column-color); font-size:.68rem; font-weight:600; text-align:center; }
    .column-actions button, .quick button { display:grid; place-items:center; width:27px; height:27px; min-height:0; padding:5px; box-shadow:none; }
    .column-actions span, .quick span, .collapsed-column > span { width:15px; height:15px; }
    .cards { display:flex; flex:1; flex-direction:column; gap:9px; min-height:0; padding:9px; overflow-y:auto; }

    .kanban-card { position:relative; flex-shrink:0; overflow:hidden; border:1px solid var(--background-modifier-border); border-left:3px solid var(--task-color,var(--interactive-accent)); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); cursor:grab; transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
    .kanban-card:hover { border-color:var(--background-modifier-border-hover); box-shadow:var(--shadow-m); transform:translateY(-2px); }
    .kanban-card.selected { box-shadow:inset 0 0 0 1px var(--interactive-accent), var(--shadow-s); }
    .kanban-card.done .task-title { color:var(--text-muted); text-decoration:line-through; }

    .card-heading { display:flex; align-items:flex-start; gap:8px; padding:11px 11px 5px; }
    .card-heading input { flex:0 0 auto; margin-top:3px; }
    .task-title { display:block; flex:1; min-width:0; height:auto; min-height:0; padding:0; border:0; background:transparent; box-shadow:none; color:var(--text-normal); font:inherit; font-size:.86rem; font-weight:600; line-height:1.3; text-align:left; overflow-wrap:anywhere; }
    .task-title:hover { background:transparent; color:var(--text-accent); }
    .pill { display:inline-flex; flex:0 0 auto; align-items:center; padding:1px 8px; border-radius:999px; font-size:.58rem; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    .priority { border:1px solid currentColor; background:var(--background-secondary); }
    .priority.low { color:var(--text-success); background:color-mix(in srgb, var(--text-success) 12%, transparent); }
    .priority.medium { color:var(--text-warning); background:color-mix(in srgb, var(--text-warning) 14%, transparent); }
    .priority.high { color:var(--text-error); background:color-mix(in srgb, var(--text-error) 12%, transparent); }

    .card-images { display:flex; flex-wrap:wrap; align-items:flex-start; gap:5px; padding:3px 11px 7px; }
    .card-image { display:block; flex:0 0 auto; min-height:0; padding:0; overflow:hidden; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m); background:var(--background-secondary); box-shadow:none; cursor:zoom-in; }
    .card-image:hover { border-color:var(--interactive-accent); }
    .card-image.cover-image { width:100%; height:115px; }
    .card-image.thumbnail { width:54px; height:44px; }
    .card-image img { display:block; width:100%; height:100%; object-fit:cover; }
    .image-overflow { align-self:center; color:var(--text-muted); font-size:.7rem; }

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

    .column-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; min-height:72px; padding:12px; margin:0 9px 9px; border:1px dashed var(--background-modifier-border); border-radius:var(--radius-m); color:var(--text-faint); font-size:.72rem; text-align:center; transition:border-color .12s ease, background .12s ease; }
    .column-empty.active { border-color:var(--interactive-accent); background:color-mix(in srgb, var(--interactive-accent) 7%, transparent); }
    .column-empty .empty-icon :global(svg) { width:22px; height:22px; }

    .collapsed-column { display:flex; flex:0 0 40px; width:40px; height:auto; min-height:0; align-items:center; gap:10px; padding:9px 7px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-secondary); color:var(--text-muted); writing-mode:vertical-rl; }
    .collapsed-column strong { overflow:hidden; font-size:.76rem; text-overflow:ellipsis; white-space:nowrap; }
    .collapsed-column small { color:var(--text-faint); }

    @media (max-width:600px) {
        .kanban-column { flex-basis:270px; }
        .quick button { width:31px; height:31px; }
    }
</style>
