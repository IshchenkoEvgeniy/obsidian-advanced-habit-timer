<script lang="ts">
    import { MarkdownView, Notice, setIcon, type App } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import { TaskEditorModal } from '../../projects/modals/task-editor';
    import { projectTaskToData } from '../../projects/task-data';
    import { taskDisplayTitle } from '../../projects/engine/task-identity';
    import { addChecklistGroupChild, addChecklistStageChild, addChecklistSubtask } from '../../projects/structured-editor';
    import type { ProjectDataEngine } from '../../projects/project-data';
    import type { ProjectScopeDefinition, ProjectTask, TaskData } from '../../projects/types';
    import type { ViewContext } from '../../projects/views/base-view';
    import { currentTab } from '../../store/ProjectsStore';
    import SubIssuesProgress from './SubIssuesProgress.svelte';
    import { buildTableHierarchy } from './table-hierarchy';
    import { collectTableStages, groupTableStages, tableStageKey, type TableRowGroup, type StageGrouping } from './table-stage-groups';
    import { fieldKeys, hasCurrentTableViewConfig, normalizeTableViewConfig, type Field, type GroupField, type SortRule, type ViewConfig, type SavedView } from './table-view-config';
    import { clampColumnWidth, defaultColumnWidth, minimumColumnWidth, normalizeColumnWidths, type ColumnWidths } from './table-column-widths';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let dataEngine: ProjectDataEngine;
    export let scope: ProjectScopeDefinition;
    export let ctx: ViewContext;

    type RowGroup = TableRowGroup;
    const editableFields: Field[] = ['status', 'priority', 'tags', 'habit', 'start', 'due', 'estimate'];
    const editableGitHubTypes = ['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'ITERATION'];
    const taskCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };
    const focus: Action<HTMLInputElement> = node => { queueMicrotask(() => node.focus()); };

    let query = '';
    let visible = new Set<Field>(['status', 'priority', 'section', 'tags', 'due', 'estimate']);
    let hiddenGitHub = new Set<string>();
    let fieldOrder = [...fieldKeys];
    let groupBy: GroupField = 'none';
    let sliceBy: GroupField = 'none';
    let sliceValue = '';
    let sortRules: SortRule[] = [];
    let showEstimateSum = true;
    let showSpentSum = false;
    let viewMenuOpen = false;
    let fieldMenuOpen = false;
    let collapsed = new Set<string>();
    let collapsedParents = new Set<string>();
    let collapsedTasks = new Set<string>();
    let hiddenTaskIds = new Set<string>();
    let initializedChecklistScope = '';
    let restoredCollapseForScope = false;
    let addingChild: { kind: 'stage'; stage: string; task: ProjectTask }
        | { kind: 'group'; parent: { id: string; title: string; sourceLine: number }; task: ProjectTask }
        | { kind: 'task'; task: ProjectTask } | null = null;
    let childName = '';
    let actionMenu = '';
    let editingName = '';
    let nameDraft = '';
    let addingGroup: string | null = null;
    let newName = '';
    let draggedField: Field | null = null;
    let draggedTask: ProjectTask | null = null;
    let selectedCells = new Set<string>();
    let cellAnchor = '';
    let lastBulk: { taskId: string; field: Field; oldValue: string }[] = [];
    let fillSource: { task: ProjectTask; field: Field } | null = null;
    let loadedScopeId = '';
    let busy = false;
    let savedViews: SavedView[] = [];
    let activeViewId = 'all';
    let addingView = false;
    let newViewName = '';
    let renameViewName = '';
    let showArchive = false;
    let stageGrouping: StageGrouping = 'none';
    let collapsedStageGroups = new Set<string>();
    let stageGroupEditorOpen = false;
    let stageGroupDrafts: Record<string, string> = {};
    let columnWidths: ColumnWidths = {};
    let resizingColumn = '';

    const resizeColumn: Action<HTMLTableCellElement, { key: string; label: string; width: number }> = (node, initial) => {
        let config = initial;
        let pointer: { id: number; x: number; width: number } | null = null;
        const handle = node.ownerDocument.createElement('button');
        handle.type = 'button';
        handle.className = 'column-resize-handle';
        handle.draggable = false;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        node.appendChild(handle);
        function update(next: typeof initial): void {
            config = next;
            handle.title = lang === 'ru' ? 'Перетащите для изменения ширины. Двойной щелчок — сброс.' : 'Drag to resize. Double-click to reset.';
            handle.setAttribute('aria-label', `${lang === 'ru' ? 'Ширина колонки' : 'Column width'}: ${next.label}`);
            handle.setAttribute('aria-valuemin', String(minimumColumnWidth(next.key)));
            handle.setAttribute('aria-valuemax', '1400');
            handle.setAttribute('aria-valuenow', String(next.width));
        }
        function finish(): void {
            if (!pointer) return;
            const id = pointer.id;
            pointer = null;
            resizingColumn = '';
            if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
            saveColumnWidths();
        }
        handle.onpointerdown = event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            pointer = { id: event.pointerId, x: event.clientX, width: node.getBoundingClientRect().width };
            resizingColumn = config.key;
            handle.setPointerCapture(event.pointerId);
        };
        handle.onpointermove = event => {
            if (!pointer || event.pointerId !== pointer.id) return;
            setColumnWidth(config.key, pointer.width + event.clientX - pointer.x);
        };
        handle.onpointerup = finish;
        handle.onpointercancel = finish;
        handle.onlostpointercapture = finish;
        handle.onclick = event => event.stopPropagation();
        handle.ondblclick = event => { event.stopPropagation(); resetColumnWidth(config.key); };
        handle.ondragstart = event => { event.preventDefault(); event.stopPropagation(); };
        handle.onkeydown = event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Home') resetColumnWidth(config.key);
            else {
                setColumnWidth(config.key, config.width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10));
                saveColumnWidths();
            }
        };
        update(initial);
        return { update, destroy() { pointer = null; resizingColumn = ''; handle.remove(); } };
    };

    $: lang = plugin.settings.language;
    $: words = lang === 'ru' ? {
        title: 'Название', assignees: 'Исполнители', status: 'Статус', linkedPrs: 'Связанные PR',
        subIssues: 'Прогресс подзадач', iteration: 'Итерация', priority: 'Приоритет', section: 'Этап', tags: 'Метки',
        habit: 'Привычка', start: 'Начало', due: 'Срок', estimate: 'Оценка', spent: 'Затрачено',
        view: 'Вид', filter: 'Фильтр по названию или полю…', fields: 'Поля', group: 'Группировать по',
        slice: 'Разделить по', sort: 'Сортировка', sums: 'Суммы', none: 'Без группировки',
        noValue: 'Без значения', add: 'Добавить задачу', items: 'задач', clear: 'Сбросить фильтр',
        all: 'Все', open: 'Открыть заметку', edit: 'Редактировать задачу', selectAll: 'Выбрать все',
        hide: 'Скрыть поле', empty: 'Нет задач по этому фильтру', ascending: 'По возрастанию',
        descending: 'По убыванию', noSort: 'Без сортировки', selected: 'выбрано'
    } : {
        title: 'Title', assignees: 'Assignees', status: 'Status', linkedPrs: 'Linked pull requests',
        subIssues: 'Sub-issues progress', iteration: 'Iteration', priority: 'Priority', section: 'Section', tags: 'Labels',
        habit: 'Habit', start: 'Start date', due: 'Due date', estimate: 'Estimate', spent: 'Time spent',
        view: 'View', filter: 'Filter by title or field…', fields: 'Fields', group: 'Group by',
        slice: 'Slice by', sort: 'Sort', sums: 'Field sums', none: 'No grouping',
        noValue: 'No value', add: 'Add item', items: 'items', clear: 'Clear filter',
        all: 'All', open: 'Open note', edit: 'Edit item', selectAll: 'Select all',
        hide: 'Hide field', empty: 'No items match this filter', ascending: 'Ascending',
        descending: 'Descending', noSort: 'No sorting', selected: 'selected'
    };
    // Preference loading assigns state inside a function. Run it before projections:
    // legacy Svelte cannot infer those assignments when ordering reactive statements.
    $: if (scope.id !== loadedScopeId) loadPreferences(scope.id);
    $: hasSections = ctx.allTasks.some(task => Boolean(task.section));
    $: hasChecklistHierarchy = ctx.allTasks.some(task => Boolean(task.checklistAncestors?.length) &&
        (scope.sourceType !== 'file' || task.file.path === scope.sourceValue));
    $: if (hasChecklistHierarchy && (groupBy !== 'section' || sortRules.length)) {
        groupBy = 'section';
        sortRules = [];
    }
    $: if (hasChecklistHierarchy && initializedChecklistScope !== scope.id) {
        if (!restoredCollapseForScope) collapsedParents = defaultCollapsedParents();
        initializedChecklistScope = scope.id;
    }
    $: shownFields = fieldOrder.filter(field => visible.has(field) && (field !== 'section' || hasSections));
    $: customFields = (scope.githubFields || []).filter(field => field.name !== 'Status' &&
        editableGitHubTypes.includes(field.type) && !hiddenGitHub.has(field.id));
    $: tableColumns = ['title', ...shownFields.map(field => `field:${field}`), ...customFields.map(field => `github:${field.id}`)]
        .map(key => ({ key, width: columnWidths[key] ?? defaultColumnWidth(key) }));
    $: tableWidth = 80 + tableColumns.reduce((sum, column) => sum + column.width, 0);
    $: hierarchy = buildTableHierarchy(ctx.allTasks, ctx.columns[ctx.columns.length - 1] || 'Done');
    $: groups = groupTableStages(makeGroups(ctx.allTasks, query, groupBy, sliceBy, sliceValue, sortRules, words),
        scope, groupBy === 'section' ? stageGrouping : 'none', hierarchy.stageProgress,
        lang === 'ru' ? 'Без группы этапов' : 'Ungrouped stages');
    $: allStages = collectTableStages(ctx.allTasks);
    $: stageGroupNames = [...new Set(Object.values(stageGroupDrafts).map(name => name.trim()).filter(Boolean))];
    $: stageGroupingFields = (scope.githubFields || []).filter(field => field.name !== 'Status' && field.name !== 'Этап' &&
        ['SINGLE_SELECT', 'ITERATION', 'MILESTONE', 'TEXT'].includes(field.type));
    $: hiddenTaskIds = getHiddenTaskIds(ctx.allTasks, hierarchy.taskById, collapsedParents, collapsedTasks);
    $: totalVisible = groups.reduce((sum, group) => sum + group.rows.length, 0);
    $: sliceOptions = makeSliceOptions(ctx.allTasks, query, sliceBy, words);
    $: activeSavedConfig = savedViews.find(view => view.id === activeViewId)?.config;
    $: viewHasChanges = !activeSavedConfig || query !== activeSavedConfig.query ||
        JSON.stringify([...visible]) !== JSON.stringify(activeSavedConfig.visible) ||
        JSON.stringify(fieldOrder) !== JSON.stringify(activeSavedConfig.fieldOrder) ||
        JSON.stringify([...hiddenGitHub]) !== JSON.stringify(activeSavedConfig.hiddenGitHub || []) ||
        groupBy !== activeSavedConfig.groupBy || sliceBy !== activeSavedConfig.sliceBy || sliceValue !== activeSavedConfig.sliceValue ||
        JSON.stringify(sortRules) !== JSON.stringify(activeSavedConfig.sortRules) ||
        showEstimateSum !== activeSavedConfig.showEstimateSum || showSpentSum !== activeSavedConfig.showSpentSum ||
        stageGrouping !== (activeSavedConfig.stageGrouping || 'none') ||
        JSON.stringify(columnWidths) !== JSON.stringify(activeSavedConfig.columnWidths || {});
    $: if (scope.id === loadedScopeId) saveCollapsePreferences(collapsed, collapsedParents, collapsedTasks, collapsedStageGroups);

    function prefKey(id: string): string { return `habit-timer:project-table:${id}`; }
    function defaultCollapsedParents(): Set<string> {
        return new Set(ctx.allTasks.flatMap(task => task.checklistAncestors?.[0]?.id ? [task.checklistAncestors[0].id] : []));
    }

    function captureConfig(): ViewConfig {
        return { query, visible: [...visible], fieldOrder: [...fieldOrder], hiddenGitHub: [...hiddenGitHub], groupBy, sliceBy, sliceValue,
            sortRules: sortRules.map(rule => ({ ...rule })), showEstimateSum, showSpentSum, stageGrouping, columnWidths: { ...columnWidths } };
    }

    function setColumnWidth(key: string, width: number): void {
        columnWidths = { ...columnWidths, [key]: clampColumnWidth(key, width) };
    }

    function resetColumnWidth(key: string): void {
        const next = { ...columnWidths };
        delete next[key];
        columnWidths = next;
        saveColumnWidths();
    }

    function saveColumnWidths(): void {
        savedViews = savedViews.map(view => view.id === activeViewId
            ? { ...view, config: { ...view.config, columnWidths: { ...columnWidths } } } : view);
        savePreferences();
    }

    function applyConfig(config: ViewConfig): void {
        query = config.query || '';
        visible = new Set((config.visible || []).filter(field => fieldKeys.includes(field)));
        hiddenGitHub = new Set(config.hiddenGitHub || []);
        fieldOrder = [...(config.fieldOrder || []).filter(field => fieldKeys.includes(field)), ...fieldKeys]
            .filter((field, index, array) => array.indexOf(field) === index);
        groupBy = config.groupBy || 'none';
        sliceBy = config.sliceBy || 'none';
        sliceValue = config.sliceValue || '';
        sortRules = (config.sortRules || []).filter(rule => [...fieldKeys, 'title'].includes(rule.field) && [1, -1].includes(rule.direction));
        showEstimateSum = config.showEstimateSum !== false;
        showSpentSum = config.showSpentSum === true;
        stageGrouping = config.stageGrouping || 'none';
        columnWidths = normalizeColumnWidths(config.columnWidths);
        selectedCells = new Set();
    }

    function loadPreferences(id: string): void {
        loadedScopeId = id;
        initializedChecklistScope = '';
        restoredCollapseForScope = false;
        query = '';
        visible = scope.githubProjectUrl
            ? new Set<Field>(['assignees', 'status', 'linkedPrs', 'subIssues'])
            : new Set<Field>(['status', 'priority', 'section', 'tags', 'due', 'estimate']);
        if (!scope.githubProjectUrl && ctx.allTasks.some(task => task.checklistAncestors?.length || task.parentId || task.subtasks?.length)) visible.add('subIssues');
        hiddenGitHub = new Set();
        fieldOrder = [...fieldKeys];
        groupBy = ctx.allTasks.some(task => task.section) ? 'section' : 'status';
        sliceBy = 'none';
        sliceValue = '';
        sortRules = [];
        showEstimateSum = true;
        showSpentSum = false;
        collapsed = new Set();
        collapsedParents = defaultCollapsedParents();
        collapsedTasks = new Set();
        collapsedStageGroups = new Set();
        stageGrouping = 'none';
        columnWidths = {};
        stageGroupEditorOpen = false;
        savedViews = [];
        activeViewId = 'all';
        try {
            const saved = JSON.parse(localStorage.getItem(prefKey(id)) || 'null');
            if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
            const fallback = captureConfig();
            applyConfig(normalizeTableViewConfig(saved, fallback));
            if (Array.isArray(saved.collapsedGroups) && Array.isArray(saved.collapsedParents) && Array.isArray(saved.collapsedTasks)) {
                collapsed = new Set(saved.collapsedGroups.filter((key: unknown): key is string => typeof key === 'string'));
                collapsedParents = new Set(saved.collapsedParents.filter((key: unknown): key is string => typeof key === 'string'));
                collapsedTasks = new Set(saved.collapsedTasks.filter((key: unknown): key is string => typeof key === 'string'));
                restoredCollapseForScope = true;
            }
            if (Array.isArray(saved.collapsedStageGroups)) collapsedStageGroups = new Set(saved.collapsedStageGroups.filter((key: unknown): key is string => typeof key === 'string'));
            if (Array.isArray(saved.savedViews)) {
                savedViews = saved.savedViews.filter((view: SavedView) =>
                    typeof view?.id === 'string' && typeof view.name === 'string' && view.config && typeof view.config === 'object')
                    .map((view: SavedView) => ({ ...view, config: normalizeTableViewConfig(view.config, fallback) }));
                if (typeof saved.activeViewId === 'string' && savedViews.some(view => view.id === saved.activeViewId)) {
                    activeViewId = saved.activeViewId;
                    if (!hasCurrentTableViewConfig(saved)) applyConfig(savedViews.find(view => view.id === activeViewId)!.config);
                }
            }
        } catch { /* Invalid local preference is ignored. */ }
        finally {
            if (ctx.allTasks.some(task => task.checklistAncestors?.length &&
                (scope.sourceType !== 'file' || task.file.path === scope.sourceValue))) {
                groupBy = 'section';
                sortRules = [];
                savedViews = savedViews.map(view => view.id === activeViewId
                    ? { ...view, config: { ...view.config, groupBy: 'section', sortRules: [] } } : view);
            }
            if (!savedViews.some(view => view.id === 'all')) {
                savedViews = [{ id: 'all', name: lang === 'ru' ? 'Все задачи' : 'All items', config: captureConfig() }, ...savedViews];
            }
            renameViewName = savedViews.find(view => view.id === activeViewId)?.name || '';
        }
    }

    function savePreferences(): void {
        try {
            localStorage.setItem(prefKey(scope.id), JSON.stringify({
                query, visible: [...visible], fieldOrder, hiddenGitHub: [...hiddenGitHub], groupBy, sliceBy, sliceValue,
                sortRules, showEstimateSum, showSpentSum, stageGrouping, columnWidths, savedViews, activeViewId,
                collapsedGroups: [...collapsed], collapsedParents: [...collapsedParents], collapsedTasks: [...collapsedTasks],
                collapsedStageGroups: [...collapsedStageGroups]
            }));
        } catch { /* Storage may be disabled; the current view still works. */ }
    }

    function saveCollapsePreferences(groups: Set<string>, parents: Set<string>, tasks: Set<string>, stageGroups: Set<string>): void {
        try {
            const key = prefKey(scope.id);
            const parsed = JSON.parse(localStorage.getItem(key) || '{}');
            const saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            localStorage.setItem(key, JSON.stringify({ ...saved, collapsedGroups: [...groups],
                collapsedParents: [...parents], collapsedTasks: [...tasks], collapsedStageGroups: [...stageGroups] }));
        } catch { /* Storage may be disabled; the current view still works. */ }
    }

    function saveCurrentView(): void {
        savedViews = savedViews.map(view => view.id === activeViewId ? { ...view, config: captureConfig() } : view);
        savePreferences();
    }

    function discardViewChanges(): void {
        const view = savedViews.find(item => item.id === activeViewId);
        if (!view) return;
        applyConfig(view.config);
        savePreferences();
    }

    function activateView(id: string): void {
        const view = savedViews.find(item => item.id === id);
        if (!view) return;
        activeViewId = id;
        applyConfig(view.config);
        renameViewName = view.name;
        savePreferences();
    }

    function createView(): void {
        const name = newViewName.trim();
        if (!name) return;
        const id = `view-${Date.now()}`;
        savedViews = [...savedViews, { id, name, config: captureConfig() }];
        activeViewId = id;
        renameViewName = name;
        newViewName = '';
        addingView = false;
        savePreferences();
    }

    function renameActiveView(): void {
        const name = renameViewName.trim();
        if (!name) return;
        savedViews = savedViews.map(view => view.id === activeViewId ? { ...view, name } : view);
        savePreferences();
    }

    function deleteActiveView(): void {
        if (activeViewId === 'all') return;
        savedViews = savedViews.filter(view => view.id !== activeViewId);
        activateView('all');
    }

    function fieldLabel(field: Field | 'title'): string { return words[field]; }
    function stageKey(group: RowGroup): string { return tableStageKey(group); }

    function openStageGroupEditor(): void {
        stageGroupDrafts = { ...(scope.stageGroups || {}) };
        stageGroupEditorOpen = true;
        viewMenuOpen = false;
    }

    async function saveStageGroups(): Promise<void> {
        if (busy) return;
        busy = true;
        const previous = scope.stageGroups;
        try {
            scope.stageGroups = Object.fromEntries(Object.entries(stageGroupDrafts)
                .map(([key, name]) => [key, name.trim()]).filter(([, name]) => Boolean(name)));
            await plugin.saveSettings();
            scope = scope;
            stageGrouping = 'local';
            groupBy = 'section';
            stageGroupEditorOpen = false;
            savePreferences();
            ctx.onRefresh();
        } catch (error) {
            scope.stageGroups = previous;
            new Notice(String(error));
        } finally { busy = false; }
    }

    function toggleStageGroup(key: string): void {
        const next = new Set(collapsedStageGroups);
        if (next.has(key)) next.delete(key); else next.add(key);
        collapsedStageGroups = next;
    }
    function value(task: ProjectTask, field: Field | 'title'): string {
        const meta = scope.githubNativeItems?.[`leaf:${task.id}`]?.meta || scope.githubBindings?.[task.id]?.meta;
        switch (field) {
            case 'title': return task.name;
            case 'assignees': return meta?.assignees?.join(', ') || '';
            case 'status': return task.status;
            case 'linkedPrs': return String(meta?.fields['Linked pull requests'] || '');
            case 'subIssues': return meta?.subIssues?.total ? `${meta.subIssues.completed}/${meta.subIssues.total}`
                : task.subtasks?.length ? `${task.subtasks.filter(subtask => subtask.checked).length}/${task.subtasks.length}` : '';
            case 'iteration': return String(meta?.fields.Iteration || '');
            case 'priority': return task.priority || '';
            case 'section': return task.section || '';
            case 'tags': return task.tags || '';
            case 'habit': return task.habitName || '';
            case 'start': return task.startDate || '';
            case 'due': return task.endDate || '';
            case 'estimate': return task.timeEstimatedSec ? plugin.formatTime(task.timeEstimatedSec) : '';
            case 'spent': return task.timeSpentSec ? plugin.formatTime(task.timeSpentSec) : '';
        }
    }

    function customValue(task: ProjectTask, name: string): string {
        const binding = scope.githubNativeItems?.[`leaf:${task.id}`] || scope.githubBindings?.[task.id];
        return String(binding?.localFields?.[name] ?? binding?.meta?.fields[name] ?? '');
    }

    async function saveCustomField(task: ProjectTask, name: string, raw: string): Promise<void> {
        const binding = scope.githubNativeItems?.[`leaf:${task.id}`] || scope.githubBindings?.[task.id];
        if (!binding) { new Notice(lang === 'ru' ? 'Сначала синхронизируйте задачу с GitHub.' : 'Sync this item with GitHub first.'); return; }
        binding.localFields ||= { ...(binding.meta?.fields || {}) };
        binding.localFields[name] = raw;
        await plugin.saveSettings();
        ctx.onRefresh();
    }

    function toggleCustomField(id: string): void {
        const next = new Set(hiddenGitHub);
        if (next.has(id)) next.delete(id); else next.add(id);
        hiddenGitHub = next;
        savePreferences();
    }

    function matchesQuery(task: ProjectTask): boolean {
        const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        return tokens.every(token => {
            const negative = token.startsWith('-');
            const expression = negative ? token.slice(1) : token;
            const match = expression.match(/^([a-z]+):(.*)$/i);
            let result = false;
            if (match) {
                const alias: Record<string, Field | 'title'> = {
                    title: 'title', status: 'status', priority: 'priority', section: 'section',
                    stage: 'section', tag: 'tags', label: 'tags', labels: 'tags',
                    habit: 'habit', due: 'due', start: 'start'
                };
                const key = match[1]!.toLowerCase();
                const term = match[2] || '';
                const field = alias[key];
                if (field) {
                    const actual = value(task, field).toLocaleLowerCase();
                    result = term.split(',').some(choice => actual.includes(choice.replace(/^"|"$/g, '').toLocaleLowerCase()));
                } else if (key === 'no' && alias[term.toLowerCase()]) {
                    result = !value(task, alias[term.toLowerCase()]!);
                } else if (key === 'is') {
                    const done = task.status === ctx.columns[ctx.columns.length - 1];
                    result = term.toLowerCase() === 'done' || term.toLowerCase() === 'closed' ? done
                        : term.toLowerCase() === 'open' ? !done : false;
                }
            } else {
                const needle = expression.replace(/^"|"$/g, '').toLocaleLowerCase();
                result = [task.name, task.status, task.section, task.tags, task.habitName, task.priority]
                    .some(part => part?.toLocaleLowerCase().includes(needle));
            }
            return negative ? !result : result;
        });
    }

    function groupValue(task: ProjectTask, field: GroupField): string {
        if (field === 'none') return 'all';
        return value(task, field) || '';
    }

    function compareTasks(a: ProjectTask, b: ProjectTask): number {
        for (const rule of sortRules) {
            const av = rule.field === 'estimate' ? a.timeEstimatedSec || 0 : rule.field === 'spent' ? a.timeSpentSec || 0 : value(a, rule.field);
            const bv = rule.field === 'estimate' ? b.timeEstimatedSec || 0 : rule.field === 'spent' ? b.timeSpentSec || 0 : value(b, rule.field);
            const comparison = typeof av === 'number' && typeof bv === 'number' ? av - bv : taskCollator.compare(String(av), String(bv));
            if (comparison) return comparison * rule.direction;
        }
        return (a.order ?? 0) - (b.order ?? 0) || taskCollator.compare(a.name, b.name);
    }

    function makeGroups(tasks: ProjectTask[], _query: string, groupField: GroupField, sliceField: GroupField,
        selectedSlice: string, _sortRules: SortRule[], labels: typeof words): RowGroup[] {
        const filtered = tasks.filter(task => matchesQuery(task) &&
            (sliceField === 'none' || !selectedSlice || groupValue(task, sliceField) === selectedSlice));
        const byGroup = new Map<string, ProjectTask[]>();
        for (const task of filtered) {
            const key = groupValue(task, groupField);
            if (!byGroup.has(key)) byGroup.set(key, []);
            byGroup.get(key)!.push(task);
        }
        if (!byGroup.size) byGroup.set(groupField === 'none' ? 'all' : groupField === 'status' ? (ctx.columns[0] || '') : '', []);
        const entries = [...byGroup.entries()];
        if (groupField === 'status') entries.sort((a, b) => ctx.columns.indexOf(a[0]) - ctx.columns.indexOf(b[0]));
        if (groupField === 'priority') entries.sort((a, b) =>
            ['high', 'medium', 'low', ''].indexOf(a[0]) - ['high', 'medium', 'low', ''].indexOf(b[0]));
        return entries.map(([key, rows]) => ({
            key, label: key === 'all' ? labels.all : key || labels.noValue,
            rows: rows.sort(compareTasks),
            estimate: rows.reduce((sum, task) => sum + (task.timeEstimatedSec || 0), 0),
            spent: rows.reduce((sum, task) => sum + task.timeSpentSec, 0)
        }));
    }

    function makeSliceOptions(tasks: ProjectTask[], _query: string, sliceField: GroupField, labels: typeof words): { key: string; label: string; count: number }[] {
        if (sliceField === 'none') return [];
        const counts = new Map<string, number>();
        for (const task of tasks.filter(matchesQuery)) {
            const key = groupValue(task, sliceField);
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return [...counts].map(([key, count]) => ({ key, label: key || labels.noValue, count }));
    }

    function setVisible(field: Field): void {
        const next = new Set(visible);
        if (next.has(field)) next.delete(field); else next.add(field);
        visible = next;
        savePreferences();
    }

    function toggleSort(field: Field | 'title'): void {
        const current = sortRules.find(rule => rule.field === field);
        sortRules = current?.direction === -1 ? sortRules.filter(rule => rule.field !== field) :
            current ? sortRules.map(rule => rule.field === field ? { field, direction: -1 } : rule) :
            [...sortRules, { field, direction: 1 }];
        savePreferences();
    }

    function reorderField(target: Field): void {
        if (!draggedField || draggedField === target) return;
        fieldOrder = fieldOrder.filter(field => field !== draggedField);
        fieldOrder.splice(fieldOrder.indexOf(target), 0, draggedField);
        fieldOrder = [...fieldOrder];
        draggedField = null;
        savePreferences();
    }

    function toggleGroup(key: string): void {
        const next = new Set(collapsed);
        if (next.has(key)) next.delete(key); else next.add(key);
        collapsed = next;
    }

    function toggleParent(key: string): void {
        const next = new Set(collapsedParents);
        if (next.has(key)) next.delete(key); else next.add(key);
        collapsedParents = next;
    }

    function getHiddenTaskIds(tasks: ProjectTask[], byId: Map<string, ProjectTask>, parents: Set<string>, taskIds: Set<string>): Set<string> {
        const hidden = new Set<string>();
        for (const task of tasks) {
            if (task.checklistAncestors?.some(parent => parents.has(parent.id))) {
                hidden.add(task.id);
                continue;
            }
            let parentId = task.parentId;
            const visited = new Set<string>();
            while (parentId && !visited.has(parentId)) {
                if (taskIds.has(parentId)) { hidden.add(task.id); break; }
                visited.add(parentId);
                parentId = byId.get(parentId)?.parentId;
            }
        }
        return hidden;
    }

    function toggleTaskChildren(id: string): void {
        const next = new Set(collapsedTasks);
        if (next.has(id)) next.delete(id); else next.add(id);
        collapsedTasks = next;
    }

    async function createChecklistChild(): Promise<void> {
        const target = addingChild;
        const title = childName.trim();
        if (!target || !title || busy) return;
        busy = true;
        try {
            if (target.kind === 'stage') await addChecklistStageChild(app, target.task.file, target.stage, title);
            else if (target.kind === 'group') await addChecklistGroupChild(app, target.task.file, ctx.allTasks, target.parent, title);
            else await addChecklistSubtask(app, target.task, ctx.allTasks, title);
            addingChild = null;
            childName = '';
            ctx.onRefresh();
        } catch (error) { new Notice(String(error)); }
        finally { busy = false; }
    }

    function toggleSelect(id: string): void {
        const next = new Set(ctx.selectedTasks);
        if (next.has(id)) next.delete(id); else next.add(id);
        ctx.onSelectionChange?.(next);
    }

    function toggleSelectAll(): void {
        const ids = groups.flatMap(group => group.rows.map(task => task.id));
        const next = new Set(ctx.selectedTasks);
        if (ids.every(id => next.has(id))) ids.forEach(id => next.delete(id));
        else ids.forEach(id => next.add(id));
        ctx.onSelectionChange?.(next);
    }

    function cellKey(task: ProjectTask, field: Field): string { return `${task.id}\u0000${field}`; }

    function selectCell(task: ProjectTask, field: Field, event: MouseEvent): void {
        const key = cellKey(task, field);
        const next = (event.ctrlKey || event.metaKey || event.shiftKey) ? new Set(selectedCells) : new Set<string>();
        if (event.shiftKey && cellAnchor.endsWith(`\u0000${field}`)) {
            const rows = groups.flatMap(group => collapsed.has(group.key) ? [] : group.rows);
            const start = rows.findIndex(row => cellKey(row, field) === cellAnchor);
            const end = rows.findIndex(row => row.id === task.id);
            if (start !== -1 && end !== -1) {
                for (let index = Math.min(start, end); index <= Math.max(start, end); index++) next.add(cellKey(rows[index]!, field));
            }
        } else if ((event.ctrlKey || event.metaKey) && next.has(key)) next.delete(key);
        else next.add(key);
        selectedCells = next;
        if (!event.shiftKey) cellAnchor = key;
        if (event.ctrlKey || event.metaKey || event.shiftKey) event.currentTarget instanceof HTMLElement && event.currentTarget.closest('table')?.focus();
    }

    function selectedCellTargets(): { task: ProjectTask; field: Field }[] {
        const result: { task: ProjectTask; field: Field }[] = [];
        for (const task of ctx.allTasks) {
            for (const field of editableFields) {
                if (selectedCells.has(cellKey(task, field))) result.push({ task, field });
            }
        }
        return result;
    }

    async function applyBulk(raw: string, targets: { task: ProjectTask; field: Field }[], recordUndo = true): Promise<void> {
        if (busy || !targets.length) return;
        busy = true;
        const previous: { taskId: string; field: Field; oldValue: string }[] = [];
        try {
            for (const { task, field } of targets) {
                if (value(task, field) === raw) continue;
                const map: Partial<Record<Field, keyof TaskData>> = {
                    status: 'status', priority: 'priority', tags: 'tags', habit: 'habitName',
                    start: 'startDate', due: 'endDate', estimate: 'timeEstimated'
                };
                const property = map[field];
                if (!property) continue;
                previous.push({ taskId: task.id, field, oldValue: value(task, field) });
                const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { [property]: raw });
                await dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, ctx.columns, task.blockId, task.sourceLine);
            }
            if (recordUndo) lastBulk = previous;
            ctx.onRefresh();
        } catch (error) { new Notice(String(error)); }
        finally { busy = false; }
    }

    async function fillCells(target: ProjectTask, field: Field): Promise<void> {
        const source = fillSource;
        fillSource = null;
        if (!source || source.field !== field) return;
        const rows = groups.flatMap(group => collapsed.has(group.key) ? [] : group.rows);
        const start = rows.findIndex(row => row.id === source.task.id);
        const end = rows.findIndex(row => row.id === target.id);
        if (start < 0 || end < 0 || start === end) return;
        const targets = rows.slice(Math.min(start, end), Math.max(start, end) + 1).map(task => ({ task, field }));
        await applyBulk(value(source.task, field), targets);
    }

    async function undoBulk(): Promise<void> {
        const changes = lastBulk;
        lastBulk = [];
        if (busy) return;
        busy = true;
        try {
            for (const change of changes) {
                const task = ctx.allTasks.find(item => item.id === change.taskId);
                if (!task) continue;
                const map: Partial<Record<Field, keyof TaskData>> = {
                    status: 'status', priority: 'priority', tags: 'tags', habit: 'habitName',
                    start: 'startDate', due: 'endDate', estimate: 'timeEstimated'
                };
                const property = map[change.field];
                if (!property) continue;
                const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), { [property]: change.oldValue });
                await dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, ctx.columns, task.blockId, task.sourceLine);
            }
            ctx.onRefresh();
        } catch (error) { new Notice(String(error)); }
        finally { busy = false; }
    }

    async function tableKeydown(event: KeyboardEvent): Promise<void> {
        const target = event.target as HTMLElement;
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || !selectedCells.size) return;
        const cells = selectedCellTargets();
        if (!cells.length) return;
        const modifier = event.ctrlKey || event.metaKey;
        try {
            if (modifier && event.key.toLowerCase() === 'c') {
                event.preventDefault();
                await navigator.clipboard.writeText(value(cells[0]!.task, cells[0]!.field));
            } else if (modifier && event.key.toLowerCase() === 'v') {
                event.preventDefault();
                const text = (await navigator.clipboard.readText()).split(/[\t\r\n]/)[0] || '';
                await applyBulk(text, cells.filter(cell => cell.field === cells[0]!.field));
            } else if (modifier && event.key.toLowerCase() === 'z' && lastBulk.length) {
                event.preventDefault();
                await undoBulk();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                await applyBulk(cells[0]!.field === 'status' ? (ctx.columns[0] || 'Backlog') : '', cells.filter(cell => cell.field === cells[0]!.field));
            } else if (event.key === 'Escape') selectedCells = new Set();
        } catch (error) { new Notice(String(error)); }
    }

    async function saveTask(task: ProjectTask, changes: Partial<TaskData>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            const data = projectTaskToData(task, seconds => plugin.formatTime(seconds), changes);
            await dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, ctx.columns, task.blockId, task.sourceLine);
            ctx.onRefresh();
        } catch (error) {
            new Notice(String(error));
        } finally { busy = false; }
    }

    async function toggleChecklistItem(task: ProjectTask): Promise<void> {
        if (busy || task.sourceLine === undefined) return;
        busy = true;
        try {
            const line = (await app.vault.read(task.file)).split('\n')[task.sourceLine];
            const match = line?.match(/^[ \t]*-[ \t]+\[[ xX]\][ \t]*(.*)$/);
            if (!match || taskDisplayTitle(match[1] || '') !== task.name) {
                throw new Error(lang === 'ru' ? 'Строка задачи изменилась. Обновите таблицу.' : 'The task line moved. Refresh the table.');
            }
            const checked = task.status !== ctx.columns[ctx.columns.length - 1];
            await dataEngine.toggleSubtask(task.file, task.sourceLine, checked);
            ctx.onRefresh();
        } catch (error) { new Notice(String(error)); }
        finally { busy = false; }
    }

    function saveField(task: ProjectTask, field: Field, raw: string): void {
        const map: Partial<Record<Field, keyof TaskData>> = {
            status: 'status', priority: 'priority', tags: 'tags', habit: 'habitName',
            start: 'startDate', due: 'endDate', estimate: 'timeEstimated'
        };
        const key = map[field];
        if (!key || value(task, field) === raw) return;
        void saveTask(task, { [key]: raw });
    }

    function commitName(task: ProjectTask): void {
        const name = nameDraft.trim();
        editingName = '';
        if (name && name !== task.name) void saveTask(task, { name });
    }

    function openTask(task: ProjectTask): void {
        if (task.notePath) {
            void app.workspace.openLinkText(task.notePath, '', false);
            return;
        }
        if (scope.sourceType === 'file' && task.sourceLine !== undefined) {
            void openChecklistParent(task, task.sourceLine);
            return;
        }
        const link = task.blockId ? `${task.file.path}#^${task.blockId}` : task.file.path;
        void app.workspace.openLinkText(link, '', false);
    }

    function openTaskIndex(): void {
        if (scope.sourceType !== 'file') return;
        const path = scope.sourceValue.replace(/\.md$/i, '.tasks.md');
        if (!app.vault.getAbstractFileByPath(path)) {
            new Notice(lang === 'ru' ? 'Список задач ещё не создан' : 'Task index has not been created yet');
            return;
        }
        void app.workspace.openLinkText(path, '', false);
    }

    async function openChecklistParent(task: ProjectTask, line: number): Promise<void> {
        const leaf = app.workspace.getLeaf('tab');
        await leaf.openFile(task.file);
        if (leaf.view instanceof MarkdownView) {
            leaf.view.editor.setCursor({ line, ch: 0 });
            leaf.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
        }
    }

    function editTask(task: ProjectTask): void {
        new TaskEditorModal(app, plugin, projectTaskToData(task, seconds => plugin.formatTime(seconds)),
            ctx.columns, true, async data => {
                await dataEngine.saveEditedTask(scope, task, data, ctx.columns);
                ctx.onRefresh();
            }).open();
    }

    function addForGroup(group: RowGroup): void {
        addingGroup = group.key;
        newName = '';
    }

    async function createItem(group: RowGroup): Promise<void> {
        const name = newName.trim();
        if (!name || busy) return;
        busy = true;
        try {
            const data: Partial<TaskData> = { name, status: ctx.columns[0] || 'Backlog' };
            if (groupBy === 'status' && group.key) data.status = group.key;
            if (groupBy === 'priority' && group.key) data.priority = group.key;
            if (groupBy === 'habit' && group.key) data.habitName = group.key;
            if (groupBy === 'section' && group.key) data.section = group.key;
            await dataEngine.createTask(scope, data);
            addingGroup = null;
            newName = '';
            ctx.onRefresh();
        } catch (error) { new Notice(String(error)); }
        finally { busy = false; }
    }

    function dropTask(group: RowGroup): void {
        const task = draggedTask;
        draggedTask = null;
        if (!task || task.id === group.key) return;
        if (groupBy === 'status' && group.key !== task.status) void saveTask(task, { status: group.key });
        if (groupBy === 'priority' && group.key !== (task.priority || '')) void saveTask(task, { priority: group.key });
        if (groupBy === 'habit' && group.key !== (task.habitName || '')) void saveTask(task, { habitName: group.key });
    }

    async function dropBefore(target: ProjectTask, group: RowGroup): Promise<void> {
        const source = draggedTask;
        draggedTask = null;
        if (!source || source.id === target.id || sortRules.length) return;
        if (groupValue(source, groupBy) !== group.key) {
            draggedTask = source;
            dropTask(group);
            return;
        }
        if (busy) return;
        busy = true;
        try {
            if (scope.sourceType === 'file') {
                if (source.section !== target.section) return;
                await dataEngine.moveTaskBefore(scope, source, target);
            } else {
                const rows = [...group.rows];
                const oldIndex = rows.findIndex(row => row.id === source.id);
                const targetIndex = rows.findIndex(row => row.id === target.id);
                if (oldIndex < 0 || targetIndex < 0) return;
                rows.splice(oldIndex, 1);
                rows.splice(rows.findIndex(row => row.id === target.id), 0, source);
                for (let index = 0; index < rows.length; index++) {
                    const row = rows[index]!;
                    const data = projectTaskToData(row, seconds => plugin.formatTime(seconds), { order: index + 1 });
                    await dataEngine.saveTask(row.file, data, false, row.name, ctx.columns, row.blockId);
                }
            }
            ctx.onRefresh();
        } catch (error) { new Notice(String(error)); }
        finally { busy = false; }
    }

    function priorityText(priority: string): string {
        if (priority === 'high') return lang === 'ru' ? 'Высокий' : 'High';
        if (priority === 'medium') return lang === 'ru' ? 'Средний' : 'Medium';
        if (priority === 'low') return lang === 'ru' ? 'Низкий' : 'Low';
        return words.noValue;
    }

    async function restoreTask(task: ProjectTask): Promise<void> {
        try {
            await dataEngine.setArchived(task, false, scope.sourceType === 'file');
            ctx.onRefresh();
        } catch (error) { new Notice(String(error)); }
    }
</script>

<svelte:window on:keydown={(event) => { if (event.key === 'Escape') { viewMenuOpen = false; stageGroupEditorOpen = false; } }} />

<div class="project-table-shell">
    <nav class="saved-view-tabs" aria-label={lang === 'ru' ? 'Представления таблицы' : 'Table views'}>
        {#each savedViews as saved (saved.id)}
            <button class:active={activeViewId === saved.id} on:click={() => activateView(saved.id)}><span use:icon={'table-2'}></span>{saved.name}{#if activeViewId === saved.id && viewHasChanges}<span class="dirty-dot">●</span>{/if}</button>
        {/each}
        {#if addingView}
            <input use:focus bind:value={newViewName} placeholder={lang === 'ru' ? 'Название представления' : 'View name'} on:keydown={(event) => { if (event.key === 'Enter') createView(); if (event.key === 'Escape') addingView = false; }} on:blur={() => { if (newViewName.trim()) createView(); else addingView = false; }} />
        {:else}<button class="new-view" title={lang === 'ru' ? 'Новое представление' : 'New view'} on:click={() => { addingView = true; newViewName = ''; }}><span use:icon={'plus'}></span></button>{/if}
        <span class="view-tab-divider"></span>
        <button on:click={() => $currentTab = 'board'}><span use:icon={'square-kanban'}></span>{lang === 'ru' ? 'Доска' : 'Board'}</button>
        <button on:click={() => $currentTab = 'calendar'}><span use:icon={'calendar-days'}></span>{lang === 'ru' ? 'Календарь' : 'Calendar'}</button>
        <button on:click={() => $currentTab = 'timeline'}><span use:icon={'calendar-range'}></span>{lang === 'ru' ? 'Дорожная карта' : 'Roadmap'}</button>
        <button on:click={() => $currentTab = 'dashboard'}><span use:icon={'layout-dashboard'}></span>{lang === 'ru' ? 'Аналитика' : 'Insights'}</button>
    </nav>
    <div class="table-toolbar">
        <label class="query-box">
            <span use:icon={'search'}></span>
            <input type="search" bind:value={query} on:input={savePreferences} placeholder={words.filter} aria-label={words.filter} />
            {#if query}<button class="clear-query" title={words.clear} on:click={() => { query = ''; savePreferences(); }}><span use:icon={'x'}></span></button>{/if}
        </label>
        <span class="result-count">{totalVisible} {words.items}</span>
        {#if viewHasChanges}
            <div class="view-changes">
                <button on:click={discardViewChanges}>{lang === 'ru' ? 'Отменить' : 'Discard'}</button>
                <button class="save-view" on:click={saveCurrentView}>{lang === 'ru' ? 'Сохранить вид' : 'Save view'}</button>
            </div>
        {/if}
        <div class="toolbar-actions">
            {#if hasSections}
                <button class:active={stageGroupEditorOpen} on:click={openStageGroupEditor}><span use:icon={'folders'}></span>{lang === 'ru' ? 'Группы этапов' : 'Stage groups'}</button>
            {/if}
            {#if scope.sourceType === 'file'}
                <button on:click={openTaskIndex} title={lang === 'ru' ? 'Открыть список с датами выполнения и ссылками на заметки' : 'Open task list with completion times and note links'}><span use:icon={'file-text'}></span>{lang === 'ru' ? 'Список задач' : 'Task list'}</button>
            {/if}
            <button class:active={showArchive} on:click={() => showArchive = !showArchive}><span use:icon={'archive'}></span>{lang === 'ru' ? 'Архив' : 'Archive'} ({ctx.archivedTasks?.length || 0})</button>
            <button class:active={viewMenuOpen} on:click={() => { viewMenuOpen = !viewMenuOpen; fieldMenuOpen = false; }}>
                <span use:icon={'sliders-horizontal'}></span>{words.view}<span use:icon={'chevron-down'}></span>
            </button>
        </div>
    </div>

    {#if viewMenuOpen}
        <button class="view-menu-dismiss" aria-label={lang === 'ru' ? 'Закрыть настройки вида' : 'Close view settings'} on:click={() => viewMenuOpen = false}></button>
        <div class="view-menu" role="dialog" aria-label={words.view}>
            <div class="menu-title"><span>{words.view}</span><button title={lang === 'ru' ? 'Закрыть' : 'Close'} aria-label={lang === 'ru' ? 'Закрыть настройки вида' : 'Close view settings'} on:click={() => viewMenuOpen = false}><span use:icon={'x'}></span></button></div>
            <label class="rename-view">{lang === 'ru' ? 'Название' : 'Name'}
                <input bind:value={renameViewName} on:change={renameActiveView} on:keydown={(event) => { if (event.key === 'Enter') renameActiveView(); }} />
            </label>
            <label><span use:icon={'group'}></span>{words.group}
                <select bind:value={groupBy} disabled={hasChecklistHierarchy} title={hasChecklistHierarchy ? (lang === 'ru' ? 'Этапы закреплены для сохранения структуры задач' : 'Stages are fixed to preserve task hierarchy') : ''} on:change={() => { collapsed = new Set(); savePreferences(); }}>
                    <option value="none">{words.none}</option>
                    {#if hasSections}<option value="section">{words.section}</option>{/if}
                    <option value="status">{words.status}</option><option value="priority">{words.priority}</option><option value="habit">{words.habit}</option>
                </select>
            </label>
            {#if hasSections}
                <label><span use:icon={'folders'}></span>{lang === 'ru' ? 'Над этапами' : 'Above stages'}
                    <select bind:value={stageGrouping} aria-label={lang === 'ru' ? 'Группировать этапы' : 'Group stages'} on:change={() => { groupBy = 'section'; savePreferences(); }}>
                        <option value="none">{words.none}</option>
                        <option value="local">{lang === 'ru' ? 'Группа этапов' : 'Stage group'}</option>
                        {#each stageGroupingFields as field (field.id)}<option value={`github:${field.name}`}>GitHub: {field.name}</option>{/each}
                    </select>
                </label>
                <button class="manage-stage-groups" on:click={openStageGroupEditor}>{lang === 'ru' ? 'Распределить этапы по группам' : 'Assign stages to groups'}</button>
            {/if}
            <label><span use:icon={'panel-left'}></span>{words.slice}
                <select bind:value={sliceBy} on:change={() => { sliceValue = ''; savePreferences(); }}>
                    <option value="none">{words.none}</option>
                    {#if hasSections}<option value="section">{words.section}</option>{/if}
                    <option value="status">{words.status}</option><option value="priority">{words.priority}</option><option value="habit">{words.habit}</option>
                </select>
            </label>
            {#if !hasChecklistHierarchy}
                <div class="menu-section-title">{words.sort}</div>
                <div class="sort-list">
                    {#each ['title', ...shownFields] as field}
                        <button class:chosen={sortRules.some(rule => rule.field === field)} on:click={() => toggleSort(field as Field | 'title')}>
                            {fieldLabel(field as Field | 'title')}
                            {#if sortRules.find(rule => rule.field === field)?.direction === 1}<span use:icon={'arrow-up'}></span>
                            {:else if sortRules.find(rule => rule.field === field)?.direction === -1}<span use:icon={'arrow-down'}></span>{/if}
                        </button>
                    {/each}
                </div>
            {/if}
            <div class="menu-section-title">{words.sums}</div>
            <label class="menu-check"><input type="checkbox" bind:checked={showEstimateSum} on:change={savePreferences} />{words.estimate}</label>
            <label class="menu-check"><input type="checkbox" bind:checked={showSpentSum} on:change={savePreferences} />{words.spent}</label>
            <div class="menu-section-title">{words.fields}</div>
            <div class="field-list">
                {#each fieldOrder as field}<label class="menu-check"><input type="checkbox" checked={visible.has(field)} on:change={() => setVisible(field)} />{fieldLabel(field)}</label>{/each}
                {#each scope.githubFields || [] as field}
                    {#if field.name !== 'Status' && editableGitHubTypes.includes(field.type)}
                        <label class="menu-check"><input type="checkbox" checked={!hiddenGitHub.has(field.id)} on:change={() => toggleCustomField(field.id)} />{field.name}</label>
                    {/if}
                {/each}
            </div>
            <button class="reset-column-widths" on:click={() => { columnWidths = {}; saveColumnWidths(); }}>{lang === 'ru' ? 'Сбросить ширину колонок' : 'Reset column widths'}</button>
            {#if activeViewId !== 'all'}<button class="delete-view" on:click={() => { deleteActiveView(); viewMenuOpen = false; }}>{lang === 'ru' ? 'Удалить представление' : 'Delete view'}</button>{/if}
        </div>
    {/if}

    {#if stageGroupEditorOpen}
        <section class="stage-group-editor" aria-label={lang === 'ru' ? 'Группы этапов' : 'Stage groups'}>
            <div class="stage-group-editor-heading"><strong>{lang === 'ru' ? 'Группы этапов' : 'Stage groups'}</strong>
                <span>{lang === 'ru' ? 'Укажите одну группу для нескольких этапов, например «Прототип» или «Релиз».' : 'Give several stages the same group, such as Prototype or Release.'}</span>
            </div>
            <datalist id={`stage-groups-${scope.id}`}>{#each stageGroupNames as name}<option value={name}></option>{/each}</datalist>
            <div class="stage-group-assignments">
                {#each allStages as stage (stage.key)}
                    <label><span title={stage.label}>{stage.label}</span>
                        <input value={stageGroupDrafts[stageKey(stage)] || ''} list={`stage-groups-${scope.id}`} disabled={busy}
                            placeholder={lang === 'ru' ? 'Без группы' : 'Ungrouped'} aria-label={`${stage.label}: ${lang === 'ru' ? 'Группа этапов' : 'Stage group'}`}
                            on:input={(event) => stageGroupDrafts = { ...stageGroupDrafts, [stageKey(stage)]: event.currentTarget.value }} />
                    </label>
                {/each}
            </div>
            <div class="stage-group-editor-actions">
                <button disabled={busy} on:click={() => stageGroupEditorOpen = false}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</button>
                <button class="mod-cta" disabled={busy} on:click={() => void saveStageGroups()}>{lang === 'ru' ? 'Сохранить группы' : 'Save groups'}</button>
            </div>
        </section>
    {/if}

    {#if showArchive}<section class="archive-list">
        <h3>{lang === 'ru' ? 'Архивированные задачи' : 'Archived items'}</h3>
        {#if ctx.archivedTasks?.length}
            {#each ctx.archivedTasks as task (task.id)}
                <div class="archive-item"><span>{task.name}</span><small>{task.section || task.file.path}</small><button on:click={() => void restoreTask(task)}>{lang === 'ru' ? 'Восстановить' : 'Restore'}</button></div>
            {/each}
        {:else}<p>{lang === 'ru' ? 'Архив пуст' : 'Archive is empty'}</p>{/if}
    </section>{/if}
    <div class="table-content" class:archive-hidden={showArchive}>
        {#if sliceBy !== 'none'}
            <aside class="slice-panel">
                <div class="slice-heading"><span use:icon={'panel-left'}></span>{words.slice}: {fieldLabel(sliceBy as Field)}</div>
                <button class:chosen={!sliceValue} on:click={() => { sliceValue = ''; savePreferences(); }}><span>{words.all}</span><em>{sliceOptions.reduce((sum, item) => sum + item.count, 0)}</em></button>
                {#each sliceOptions as item}<button class:chosen={sliceValue === item.key} on:click={() => { sliceValue = item.key; savePreferences(); }}><span>{item.label}</span><em>{item.count}</em></button>{/each}
            </aside>
        {/if}
        <div class="grid-scroll">
            <table class="project-grid" class:resizing-columns={Boolean(resizingColumn)} style={`width:${tableWidth}px`} role="grid" tabindex="0" on:keydown={(event) => void tableKeydown(event)}>
                <colgroup>
                    <col style="width:44px" />
                    {#each tableColumns as column (column.key)}<col style={`width:${column.width}px`} />{/each}
                    <col style="width:36px" />
                </colgroup>
                <thead><tr>
                    <th class="row-index"><input type="checkbox" aria-label={words.selectAll} checked={totalVisible > 0 && groups.every(group => group.rows.every(task => ctx.selectedTasks.has(task.id)))} on:change={toggleSelectAll} /></th>
                    <th class="title-column" use:resizeColumn={{ key: 'title', label: words.title, width: columnWidths.title ?? defaultColumnWidth('title') }}><button on:click={() => toggleSort('title')}>{words.title}{#if sortRules.find(rule => rule.field === 'title')?.direction === 1}<span use:icon={'arrow-up'}></span>{:else if sortRules.find(rule => rule.field === 'title')?.direction === -1}<span use:icon={'arrow-down'}></span>{/if}</button></th>
                    {#each shownFields as field (field)}
                        <th class:date-column={field === 'start' || field === 'due'} draggable={!resizingColumn} on:dragstart={() => draggedField = field} on:dragover|preventDefault on:drop={() => reorderField(field)}
                            use:resizeColumn={{ key: `field:${field}`, label: fieldLabel(field), width: columnWidths[`field:${field}`] ?? defaultColumnWidth(`field:${field}`) }}>
                            <button on:click={() => toggleSort(field)}>{fieldLabel(field)}{#if sortRules.find(rule => rule.field === field)?.direction === 1}<span use:icon={'arrow-up'}></span>{:else if sortRules.find(rule => rule.field === field)?.direction === -1}<span use:icon={'arrow-down'}></span>{/if}</button>
                            <button class="header-hide" title={words.hide} on:click={() => setVisible(field)}><span use:icon={'x'}></span></button>
                        </th>
                    {/each}
                    {#each customFields as field (field.id)}
                        <th class:date-column={field.type === 'DATE'} use:resizeColumn={{ key: `github:${field.id}`, label: field.name, width: columnWidths[`github:${field.id}`] ?? defaultColumnWidth(`github:${field.id}`) }}>
                            <button>{field.name}</button>
                            <button class="header-hide" title={words.hide} on:click={() => toggleCustomField(field.id)}><span use:icon={'x'}></span></button>
                        </th>
                    {/each}
                    <th class="add-field"><button title={words.fields} on:click={() => { fieldMenuOpen = !fieldMenuOpen; viewMenuOpen = false; }}><span use:icon={'plus'}></span></button>
                        {#if fieldMenuOpen}<div class="field-popover">
                            <strong>{words.fields}</strong>
                            {#each fieldOrder as field}<label><input type="checkbox" checked={visible.has(field)} on:change={() => setVisible(field)} />{fieldLabel(field)}</label>{/each}
                            {#each scope.githubFields || [] as field}
                                {#if field.name !== 'Status' && editableGitHubTypes.includes(field.type)}
                                    <label><input type="checkbox" checked={!hiddenGitHub.has(field.id)} on:change={() => toggleCustomField(field.id)} />{field.name}</label>
                                {/if}
                            {/each}
                        </div>{/if}
                    </th>
                </tr></thead>
                <tbody>
                    {#each groups as group (group.key)}
                        {#if group.collection?.first}
                            <tr class="stage-collection-row"><td colspan={shownFields.length + customFields.length + 3}>
                                <div class="stage-collection-content">
                                    <button class="group-toggle" title={group.collection.label} aria-label={group.collection.label}
                                        aria-expanded={!collapsedStageGroups.has(group.collection.key)} on:click={() => toggleStageGroup(group.collection!.key)}>
                                        <span use:icon={collapsedStageGroups.has(group.collection.key) ? 'chevron-right' : 'chevron-down'}></span>
                                    </button>
                                    <span class="stage-collection-icon" use:icon={'folders'}></span>
                                    <button class="stage-collection-title" on:click={() => toggleStageGroup(group.collection!.key)}>{group.collection.label}</button>
                                    <span class="group-count">{group.collection.stages} {lang === 'ru' ? 'этапов' : 'stages'}</span>
                                    <SubIssuesProgress done={group.collection.done} total={group.collection.stages} label={lang === 'ru' ? 'Выполнено этапов' : 'Completed stages'} />
                                </div>
                            </td></tr>
                        {/if}
                        {#if !group.collection || !collapsedStageGroups.has(group.collection.key)}
                        {#if groupBy !== 'none'}
                            {#if groupBy === 'section' && (group.key.startsWith('Этап ') || stageGrouping !== 'none')}
                            <tr class="stage-row" on:dragover|preventDefault on:drop={() => dropTask(group)}>
                                <td class="row-index"><span class="row-number">{group.key.match(/^Этап\s+(\d+)/)?.[1] || ''}</span></td>
                                <td class="title-cell"><div class="stage-content">
                                    <button class="group-toggle" title={collapsed.has(group.key) ? (lang === 'ru' ? 'Развернуть этап' : 'Expand stage') : (lang === 'ru' ? 'Свернуть этап' : 'Collapse stage')}
                                        aria-expanded={!collapsed.has(group.key)} on:click={() => toggleGroup(group.key)}><span use:icon={collapsed.has(group.key) ? 'chevron-right' : 'chevron-down'}></span></button>
                                    <span class="stage-icon" use:icon={hierarchy.stageProgress.get(group.key)?.done === hierarchy.stageProgress.get(group.key)?.total ? 'circle-check' : 'circle-dot'}></span>
                                    <button class="stage-title" on:click={() => toggleGroup(group.key)}>{group.label}</button>
                                    {#if scope.githubNativeItems?.[stageKey(group)]?.url}
                                        <a class="github-item-link" href={scope.githubNativeItems[stageKey(group)]!.url} target="_blank" rel="noopener noreferrer" title="Open stage Issue on GitHub"><span use:icon={'external-link'}></span></a>
                                    {/if}
                                    {#if group.rows[0]}
                                        <button class="add-subissue" title={lang === 'ru' ? 'Добавить задачу в этап' : 'Add issue to stage'}
                                            aria-label={`${group.label}: ${lang === 'ru' ? 'Добавить задачу' : 'Add issue'}`}
                                            on:click={() => { collapsed = new Set([...collapsed].filter(key => key !== group.key)); addingChild = { kind: 'stage', stage: group.key, task: group.rows[0]! }; childName = ''; }}><span use:icon={'plus'}></span></button>
                                        <span class="row-action-wrap">
                                            <button class="row-menu-toggle" title={lang === 'ru' ? 'Действия этапа' : 'Stage actions'} aria-label={`${group.label}: ${lang === 'ru' ? 'Действия' : 'Actions'}`}
                                                on:click={() => actionMenu = actionMenu === `stage:${group.key}` ? '' : `stage:${group.key}`}><span use:icon={'ellipsis'}></span></button>
                                            {#if actionMenu === `stage:${group.key}`}<div class="row-action-menu" role="menu">
                                                <button role="menuitem" on:click={() => { toggleGroup(group.key); actionMenu = ''; }}>{collapsed.has(group.key) ? (lang === 'ru' ? 'Развернуть' : 'Expand') : (lang === 'ru' ? 'Свернуть' : 'Collapse')}</button>
                                                <button role="menuitem" on:click={() => { collapsed = new Set([...collapsed].filter(key => key !== group.key)); addingChild = { kind: 'stage', stage: group.key, task: group.rows[0]! }; childName = ''; actionMenu = ''; }}>{lang === 'ru' ? 'Добавить задачу' : 'Add issue'}</button>
                                                {#if scope.githubNativeItems?.[stageKey(group)]?.url}<a role="menuitem" href={scope.githubNativeItems[stageKey(group)]!.url} target="_blank" rel="noopener noreferrer" on:click={() => actionMenu = ''}>{lang === 'ru' ? 'Открыть в GitHub' : 'Open on GitHub'}</a>{/if}
                                            </div>{/if}
                                        </span>
                                    {/if}
                                </div></td>
                                {#each shownFields as field (field)}
                                    <td class:field-status={field === 'status'}>
                                        {#if field === 'subIssues'}<SubIssuesProgress stretch done={hierarchy.stageProgress.get(group.key)?.done || 0} total={hierarchy.stageProgress.get(group.key)?.total || 0} label={words.subIssues} />
                                        {:else if field === 'status'}<span class="status-pill">{hierarchy.stageProgress.get(group.key)?.done === hierarchy.stageProgress.get(group.key)?.total ? ctx.columns[ctx.columns.length - 1] : ctx.columns[0]}</span>
                                        {:else if field === 'section'}<span class="plain-value">{group.label}</span>
                                        {:else if field === 'estimate' && showEstimateSum}<span class="plain-value">{plugin.formatTime(group.estimate)}</span>
                                        {:else if field === 'spent' && showSpentSum}<span class="plain-value">{plugin.formatTime(group.spent)}</span>{/if}
                                    </td>
                                {/each}
                                {#each customFields as field (field.id)}<td>{#if field.name === 'Этап'}<span class="plain-value">{group.label}</span>{/if}</td>{/each}
                                <td class="end-cell"></td>
                            </tr>
                            {:else}
                            <tr class="group-row" on:dragover|preventDefault on:drop={() => dropTask(group)}><td colspan={shownFields.length + customFields.length + 3}>
                                <button class="group-toggle" title={group.label} aria-label={group.label} on:click={() => toggleGroup(group.key)} aria-expanded={!collapsed.has(group.key)}><span use:icon={collapsed.has(group.key) ? 'chevron-right' : 'chevron-down'}></span></button>
                                <span class:priority-high={groupBy === 'priority' && group.key === 'high'} class:priority-medium={groupBy === 'priority' && group.key === 'medium'} class:priority-low={groupBy === 'priority' && group.key === 'low'} class="group-dot"></span>
                                <strong>{group.label}</strong>
                                <span class="group-count">{group.rows.length}</span>
                                {#if showEstimateSum}<span class="group-sum">{words.estimate}: {plugin.formatTime(group.estimate)}</span>{/if}
                                {#if showSpentSum}<span class="group-sum">{words.spent}: {plugin.formatTime(group.spent)}</span>{/if}
                            </td></tr>
                            {/if}
                            {#if addingChild?.kind === 'stage' && addingChild.stage === group.key}
                                <tr class="subissue-add-row"><td class="row-index"></td><td colspan={shownFields.length + customFields.length + 2}>
                                    <input bind:value={childName} use:focus placeholder={lang === 'ru' ? 'Название задачи' : 'Issue title'}
                                        on:keydown={(event) => { if (event.key === 'Enter') void createChecklistChild(); if (event.key === 'Escape') addingChild = null; }} />
                                    <button on:click={() => void createChecklistChild()}>{lang === 'ru' ? 'Добавить' : 'Add'}</button>
                                    <button on:click={() => addingChild = null}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</button>
                                </td></tr>
                            {/if}
                        {/if}
                        {#if !collapsed.has(group.key)}
                            {#each group.rows as task, index (task.id)}
                                {#each task.checklistAncestors || [] as ancestor, depth (ancestor.id)}
                                    {#if (index === 0 || group.rows[index - 1]?.checklistAncestors?.[depth]?.id !== ancestor.id) && !task.checklistAncestors?.slice(0, depth).some(parent => collapsedParents.has(parent.id))}
                                        <tr class="checklist-parent-row">
                                            <td class="row-index"></td>
                                            <td class="title-cell"><div class="checklist-parent-content" style={`padding-left: ${depth * 20}px`}>
                                                <button class="group-toggle" title={collapsedParents.has(ancestor.id) ? (lang === 'ru' ? 'Развернуть' : 'Expand') : (lang === 'ru' ? 'Свернуть' : 'Collapse')}
                                                    aria-expanded={!collapsedParents.has(ancestor.id)} on:click={() => toggleParent(ancestor.id)}>
                                                    <span use:icon={collapsedParents.has(ancestor.id) ? 'chevron-right' : 'chevron-down'}></span>
                                                </button>
                                                <span use:icon={hierarchy.groupProgress.get(ancestor.id)?.done === hierarchy.groupProgress.get(ancestor.id)?.total ? 'circle-check' : 'circle-dot'} class="checklist-parent-icon"></span>
                                                <button class="checklist-parent-title" title={words.open} on:click={() => void openChecklistParent(task, ancestor.sourceLine)}>{ancestor.title}</button>
                                                {#if scope.githubNativeItems?.[`group:${ancestor.id}`]?.url}
                                                    <a class="github-item-link" href={scope.githubNativeItems[`group:${ancestor.id}`]!.url} target="_blank" rel="noopener noreferrer" title="Open parent Issue on GitHub"><span use:icon={'external-link'}></span></a>
                                                {/if}
                                                <span class="group-count">{hierarchy.groupProgress.get(ancestor.id)?.done || 0}/{hierarchy.groupProgress.get(ancestor.id)?.total || 0}</span>
                                                <button class="add-subissue" title={lang === 'ru' ? 'Добавить подзадачу' : 'Add sub-issue'} aria-label={`${ancestor.title}: ${lang === 'ru' ? 'Добавить подзадачу' : 'Add sub-issue'}`}
                                                    on:click={() => { collapsedParents = new Set([...collapsedParents].filter(id => id !== ancestor.id)); addingChild = { kind: 'group', parent: ancestor, task }; childName = ''; }}><span use:icon={'plus'}></span></button>
                                                <span class="row-action-wrap">
                                                    <button class="row-menu-toggle" title={lang === 'ru' ? 'Действия задачи' : 'Issue actions'} aria-label={`${ancestor.title}: ${lang === 'ru' ? 'Действия' : 'Actions'}`}
                                                        on:click={() => actionMenu = actionMenu === `group:${ancestor.id}` ? '' : `group:${ancestor.id}`}><span use:icon={'ellipsis'}></span></button>
                                                    {#if actionMenu === `group:${ancestor.id}`}<div class="row-action-menu" role="menu">
                                                        <button role="menuitem" on:click={() => { toggleParent(ancestor.id); actionMenu = ''; }}>{collapsedParents.has(ancestor.id) ? (lang === 'ru' ? 'Развернуть' : 'Expand') : (lang === 'ru' ? 'Свернуть' : 'Collapse')}</button>
                                                        <button role="menuitem" on:click={() => { collapsedParents = new Set([...collapsedParents].filter(id => id !== ancestor.id)); addingChild = { kind: 'group', parent: ancestor, task }; childName = ''; actionMenu = ''; }}>{lang === 'ru' ? 'Добавить подзадачу' : 'Add sub-issue'}</button>
                                                        <button role="menuitem" on:click={() => { void openChecklistParent(task, ancestor.sourceLine); actionMenu = ''; }}>{lang === 'ru' ? 'Открыть в Obsidian' : 'Open in Obsidian'}</button>
                                                        {#if scope.githubNativeItems?.[`group:${ancestor.id}`]?.url}<a role="menuitem" href={scope.githubNativeItems[`group:${ancestor.id}`]!.url} target="_blank" rel="noopener noreferrer" on:click={() => actionMenu = ''}>{lang === 'ru' ? 'Открыть в GitHub' : 'Open on GitHub'}</a>{/if}
                                                    </div>{/if}
                                                </span>
                                            </div></td>
                                            {#each shownFields as field (field)}
                                                <td class:field-status={field === 'status'}>
                                                    {#if field === 'subIssues'}<SubIssuesProgress stretch done={hierarchy.groupProgress.get(ancestor.id)?.done || 0} total={hierarchy.groupProgress.get(ancestor.id)?.total || 0} label={words.subIssues} />
                                                    {:else if field === 'status'}<span class="status-pill">{hierarchy.groupProgress.get(ancestor.id)?.done === hierarchy.groupProgress.get(ancestor.id)?.total ? ctx.columns[ctx.columns.length - 1] : ctx.columns[0]}</span>
                                                    {:else if field === 'section'}<span class="plain-value">{task.section}</span>{/if}
                                                </td>
                                            {/each}
                                            {#each customFields as field (field.id)}<td>{#if field.name === 'Этап'}<span class="plain-value">{task.section}</span>{/if}</td>{/each}
                                            <td class="end-cell"></td>
                                        </tr>
                                        {#if addingChild?.kind === 'group' && addingChild.parent.id === ancestor.id}
                                            <tr class="subissue-add-row"><td class="row-index"></td><td colspan={shownFields.length + customFields.length + 2}>
                                                <input bind:value={childName} use:focus placeholder={lang === 'ru' ? 'Название подзадачи' : 'Sub-issue title'}
                                                    on:keydown={(event) => { if (event.key === 'Enter') void createChecklistChild(); if (event.key === 'Escape') addingChild = null; }} />
                                                <button on:click={() => void createChecklistChild()}>{lang === 'ru' ? 'Добавить' : 'Add'}</button>
                                                <button on:click={() => addingChild = null}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</button>
                                            </td></tr>
                                        {/if}
                                    {/if}
                                {/each}
                                {#if !hiddenTaskIds.has(task.id)}
                                <tr class:selected={ctx.selectedTasks.has(task.id)} draggable={sortRules.length === 0} on:dragstart={() => draggedTask = task} on:dragend={() => draggedTask = null} on:dragover|preventDefault on:drop={() => void dropBefore(task, group)}>
                                    <td class="row-index"><span class="row-number">{index + 1}</span><input type="checkbox" checked={ctx.selectedTasks.has(task.id)} aria-label={`${task.name}: ${words.selected}`} on:change={() => toggleSelect(task.id)} /></td>
                                    <td class="title-cell">
                                        <div class="title-inner" style={`padding-left: ${((task.checklistAncestors?.length || 0) + (hierarchy.taskDepth.get(task.id) || 0)) * 20}px`}>
                                        {#if hierarchy.taskChildren.get(task.id)?.length}
                                            <button class="group-toggle task-disclosure" title={collapsedTasks.has(task.id) ? (lang === 'ru' ? 'Развернуть подзадачи' : 'Expand sub-issues') : (lang === 'ru' ? 'Свернуть подзадачи' : 'Collapse sub-issues')}
                                                aria-expanded={!collapsedTasks.has(task.id)} on:click={() => toggleTaskChildren(task.id)}><span use:icon={collapsedTasks.has(task.id) ? 'chevron-right' : 'chevron-down'}></span></button>
                                        {/if}
                                        {#if scope.sourceType === 'file' && task.sourceLine !== undefined}
                                            <button class="task-check-button" title={task.status === ctx.columns[ctx.columns.length - 1] ? (lang === 'ru' ? 'Вернуть в работу' : 'Reopen') : (lang === 'ru' ? 'Отметить выполненной' : 'Mark done')}
                                                aria-label={`${task.name}: ${task.status === ctx.columns[ctx.columns.length - 1] ? 'Reopen' : 'Mark done'}`}
                                                on:click={() => void toggleChecklistItem(task)}><span class="task-icon" use:icon={task.status === ctx.columns[ctx.columns.length - 1] ? 'circle-check' : 'circle-dot'}></span></button>
                                        {:else}<span class="task-icon" use:icon={task.status === ctx.columns[ctx.columns.length - 1] ? 'circle-check' : 'circle-dot'}></span>{/if}
                                        {#if editingName === task.id}
                                            <input class="name-edit" bind:value={nameDraft} on:keydown={(event) => { if (event.key === 'Enter') commitName(task); if (event.key === 'Escape') editingName = ''; }} on:blur={() => commitName(task)} aria-label={words.title} />
                                        {:else}
                                            <button class="task-link" title={words.open} on:click={() => openTask(task)} on:dblclick={() => { editingName = task.id; nameDraft = task.name; }}>{task.name}</button>
                                        {/if}
                                        {#if scope.githubNativeItems?.[`leaf:${task.id}`]?.url || scope.githubBindings?.[task.id]?.meta?.url}
                                            <a class="github-item-link" href={scope.githubNativeItems?.[`leaf:${task.id}`]?.url || scope.githubBindings?.[task.id]?.meta?.url} target="_blank" rel="noopener noreferrer" title="Open on GitHub" aria-label={`${task.name}: Open on GitHub`}><span use:icon={'external-link'}></span></a>
                                        {/if}
                                        {#if task.subtasks?.length}<span class="subtask-count" title="Subtasks"><span use:icon={'list-checks'}></span>{task.subtasks.filter(subtask => subtask.checked).length}/{task.subtasks.length}</span>{/if}
                                        {#if scope.sourceType === 'file' && task.section?.startsWith('Этап ')}
                                            <button class="add-subissue" title={lang === 'ru' ? 'Добавить подзадачу' : 'Add sub-issue'} aria-label={`${task.name}: ${lang === 'ru' ? 'Добавить подзадачу' : 'Add sub-issue'}`}
                                                on:click={() => { collapsedTasks = new Set([...collapsedTasks].filter(id => id !== task.id)); addingChild = { kind: 'task', task }; childName = ''; }}><span use:icon={'plus'}></span></button>
                                        {/if}
                                        {#if scope.sourceType === 'file' && task.section?.startsWith('Этап ')}
                                            <span class="row-action-wrap">
                                                <button class="row-menu-toggle" title={lang === 'ru' ? 'Действия задачи' : 'Issue actions'} aria-label={`${task.name}: ${lang === 'ru' ? 'Действия' : 'Actions'}`}
                                                    on:click={() => actionMenu = actionMenu === `task:${task.id}` ? '' : `task:${task.id}`}><span use:icon={'ellipsis'}></span></button>
                                                {#if actionMenu === `task:${task.id}`}<div class="row-action-menu" role="menu">
                                                    {#if hierarchy.taskChildren.get(task.id)?.length}<button role="menuitem" on:click={() => { toggleTaskChildren(task.id); actionMenu = ''; }}>{collapsedTasks.has(task.id) ? (lang === 'ru' ? 'Развернуть' : 'Expand') : (lang === 'ru' ? 'Свернуть' : 'Collapse')}</button>{/if}
                                                    <button role="menuitem" on:click={() => { collapsedTasks = new Set([...collapsedTasks].filter(id => id !== task.id)); addingChild = { kind: 'task', task }; childName = ''; actionMenu = ''; }}>{lang === 'ru' ? 'Добавить подзадачу' : 'Add sub-issue'}</button>
                                                    <button role="menuitem" on:click={() => { void toggleChecklistItem(task); actionMenu = ''; }}>{task.status === ctx.columns[ctx.columns.length - 1] ? (lang === 'ru' ? 'Вернуть в работу' : 'Reopen') : (lang === 'ru' ? 'Отметить выполненной' : 'Mark done')}</button>
                                                    <button role="menuitem" on:click={() => { openTask(task); actionMenu = ''; }}>{lang === 'ru' ? 'Открыть в Obsidian' : 'Open in Obsidian'}</button>
                                                    {#if scope.githubNativeItems?.[`leaf:${task.id}`]?.url}<a role="menuitem" href={scope.githubNativeItems[`leaf:${task.id}`]!.url} target="_blank" rel="noopener noreferrer" on:click={() => actionMenu = ''}>{lang === 'ru' ? 'Открыть в GitHub' : 'Open on GitHub'}</a>{/if}
                                                </div>{/if}
                                            </span>
                                        {/if}
                                        <button class="row-edit" title={words.edit} on:click={() => editTask(task)}><span use:icon={'pencil'}></span></button>
                                        </div>
                                    </td>
                                    {#each shownFields as field (field)}
                                        <td class:field-status={field === 'status'} class:field-priority={field === 'priority'} class:cell-selected={selectedCells.has(cellKey(task, field))} on:click={(event) => selectCell(task, field, event)} on:dragover|preventDefault on:drop={(event) => { if (fillSource) { event.stopPropagation(); void fillCells(task, field); } }}>
                                            {#if field === 'status'}
                                                <select class="status-pill" value={task.status} on:change={(event) => saveField(task, field, event.currentTarget.value)} aria-label={`${task.name}: ${words.status}`}>
                                                    {#each ctx.columns as option}<option value={option}>{option}</option>{/each}
                                                </select>
                                            {:else if field === 'priority'}
                                                <select class="priority-pill" class:high={task.priority === 'high'} class:medium={task.priority === 'medium'} class:low={task.priority === 'low'} value={task.priority || ''} on:change={(event) => saveField(task, field, event.currentTarget.value)} aria-label={`${task.name}: ${words.priority}`}>
                                                    <option value="">{words.noValue}</option><option value="high">{priorityText('high')}</option><option value="medium">{priorityText('medium')}</option><option value="low">{priorityText('low')}</option>
                                                </select>
                                            {:else if field === 'tags'}
                                                <input class="cell-input tags-input" value={task.tags || ''} placeholder="—" on:change={(event) => saveField(task, field, event.currentTarget.value)} aria-label={`${task.name}: ${words.tags}`} />
                                            {:else if field === 'habit'}
                                                <input class="cell-input" value={task.habitName || ''} placeholder="—" on:change={(event) => saveField(task, field, event.currentTarget.value)} aria-label={`${task.name}: ${words.habit}`} />
                                            {:else if field === 'start' || field === 'due'}
                                                <input class="cell-input date-input" type="date" value={field === 'start' ? task.startDate || '' : task.endDate || ''} on:change={(event) => saveField(task, field, event.currentTarget.value)} aria-label={`${task.name}: ${fieldLabel(field)}`} />
                                            {:else if field === 'estimate'}
                                                <input class="cell-input duration-input" value={value(task, field)} placeholder="—" on:change={(event) => saveField(task, field, event.currentTarget.value)} aria-label={`${task.name}: ${words.estimate}`} />
                                            {:else if field === 'spent'}
                                                <span class="plain-value">{value(task, field) || '—'}</span>
                                            {:else if field === 'subIssues'}
                                                {#if hierarchy.taskChildren.get(task.id)?.length}
                                                    <SubIssuesProgress stretch done={hierarchy.taskChildren.get(task.id)!.filter(child => child.status === ctx.columns[ctx.columns.length - 1]).length} total={hierarchy.taskChildren.get(task.id)!.length} label={words.subIssues} />
                                                {:else if scope.githubNativeItems?.[`leaf:${task.id}`]?.meta?.subIssues?.total || scope.githubBindings?.[task.id]?.meta?.subIssues?.total}
                                                    <SubIssuesProgress stretch done={(scope.githubNativeItems?.[`leaf:${task.id}`]?.meta || scope.githubBindings?.[task.id]?.meta)!.subIssues!.completed} total={(scope.githubNativeItems?.[`leaf:${task.id}`]?.meta || scope.githubBindings?.[task.id]?.meta)!.subIssues!.total} label={words.subIssues} />
                                                {:else}<span class="plain-value" title={value(task, field)}>{value(task, field) || '—'}</span>{/if}
                                            {:else if field === 'section'}
                                                <span class="plain-value" title={task.section || ''}>{task.section || '—'}</span>
                                            {:else}
                                                <span class="plain-value" title={value(task, field)}>{value(task, field) || '—'}</span>
                                            {/if}
                                            {#if editableFields.includes(field) && selectedCells.size === 1 && selectedCells.has(cellKey(task, field))}
                                                <span class="fill-handle" role="button" tabindex="0" draggable="true" aria-label={lang === 'ru' ? 'Протянуть значение' : 'Fill cells'} title={lang === 'ru' ? 'Протянуть значение' : 'Fill cells'} on:dragstart={(event) => { event.stopPropagation(); fillSource = { task, field }; }} on:dragend={() => fillSource = null}></span>
                                            {/if}
                                        </td>
                                    {/each}
                                    {#each customFields as field (field.id)}
                                        <td>
                                            {#if field.type === 'SINGLE_SELECT' || field.type === 'ITERATION'}
                                                <select class="cell-input" value={customValue(task, field.name)} on:change={(event) => void saveCustomField(task, field.name, event.currentTarget.value)} aria-label={`${task.name}: ${field.name}`}>
                                                    <option value="">—</option>
                                                    {#each field.options || [] as option}<option value={option.name}>{option.name}</option>{/each}
                                                </select>
                                            {:else}
                                                <input class="cell-input" type={field.type === 'DATE' ? 'date' : field.type === 'NUMBER' ? 'number' : 'text'} value={customValue(task, field.name)} on:change={(event) => void saveCustomField(task, field.name, event.currentTarget.value)} aria-label={`${task.name}: ${field.name}`} />
                                            {/if}
                                        </td>
                                    {/each}
                                    <td class="end-cell"></td>
                                </tr>
                                {#if addingChild?.kind === 'task' && addingChild.task.id === task.id}
                                    <tr class="subissue-add-row"><td class="row-index"></td><td colspan={shownFields.length + customFields.length + 2}>
                                        <input bind:value={childName} use:focus placeholder={lang === 'ru' ? 'Название подзадачи' : 'Sub-issue title'}
                                            on:keydown={(event) => { if (event.key === 'Enter') void createChecklistChild(); if (event.key === 'Escape') addingChild = null; }} />
                                        <button on:click={() => void createChecklistChild()}>{lang === 'ru' ? 'Добавить' : 'Add'}</button>
                                        <button on:click={() => addingChild = null}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</button>
                                    </td></tr>
                                {/if}
                                {/if}
                            {/each}
                            {#if !ctx.allTasks.some(item => item.checklistAncestors?.length)}
                            <tr class="add-row"><td colspan={shownFields.length + customFields.length + 3}>
                                {#if addingGroup === group.key}
                                    <span use:icon={'plus'}></span><input use:focus bind:value={newName} placeholder={words.add} on:keydown={(event) => { if (event.key === 'Enter') void createItem(group); if (event.key === 'Escape') addingGroup = null; }} />
                                    <button on:click={() => void createItem(group)} disabled={!newName.trim() || busy}>{words.add}</button>
                                {:else}
                                    <button on:click={() => addForGroup(group)}><span use:icon={'plus'}></span>{words.add}</button>
                                {/if}
                            </td></tr>
                            {/if}
                        {/if}
                        {/if}
                    {/each}
                </tbody>
            </table>
            {#if !totalVisible && groupBy !== 'none'}<div class="no-results">{words.empty}<button on:click={() => { query = ''; sliceValue = ''; savePreferences(); }}>{words.clear}</button></div>{/if}
        </div>
    </div>
    {#if lastBulk.length}<div class="undo-bar"><span>{lastBulk.length} {words.selected}</span><button on:click={() => void undoBulk()}>{lang === 'ru' ? 'Отменить' : 'Undo'}</button><button title="Dismiss" on:click={() => lastBulk = []}><span use:icon={'x'}></span></button></div>{/if}
</div>

<style>
    .project-table-shell { position:relative; display:flex; flex-direction:column; height:100%; min-height:0; color:var(--text-normal); background:var(--background-primary); border:0; border-radius:0; overflow:hidden; }
    .saved-view-tabs { display:flex; align-items:stretch; gap:1px; flex:0 0 auto; max-width:100%; min-height:34px; padding:0 9px; overflow-x:auto; border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary); }
    .saved-view-tabs button { display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; min-height:33px; padding:5px 10px; border:0; border-bottom:2px solid transparent; border-radius:0; box-shadow:none; background:transparent; color:var(--text-muted); font-size:.75rem; white-space:nowrap; }
    .saved-view-tabs button:hover { color:var(--text-normal); background:var(--background-modifier-hover); }
    .saved-view-tabs button.active { border-bottom-color:var(--interactive-accent); color:var(--text-normal); font-weight:600; }
    .saved-view-tabs .dirty-dot { width:auto; height:auto; margin-left:3px; color:var(--interactive-accent); font-size:.57rem; }
    .saved-view-tabs button span { width:13px; height:13px; }
    .saved-view-tabs input { align-self:center; width:160px; height:26px; padding:3px 6px; font-size:.75rem; }
    .saved-view-tabs .new-view { padding:5px 7px; }
    .view-tab-divider { align-self:center; width:1px; height:17px; margin:0 3px; background:var(--background-modifier-border); }
    .table-toolbar { display:flex; align-items:center; gap:10px; flex:0 0 auto; min-height:48px; padding:7px 12px; border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary); }
    .query-box { display:flex; align-items:center; gap:7px; flex:1; min-width:160px; height:32px; padding:0 9px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-secondary); }
    .query-box:focus-within { border-color:var(--interactive-accent); box-shadow:0 0 0 1px var(--interactive-accent); }
    .query-box > span, .query-box button span, .toolbar-actions span { display:block; width:15px; height:15px; flex:none; color:var(--text-muted); }
    .query-box input { width:100%; min-width:0; height:100%; border:0; box-shadow:none; background:transparent; font-size:.81rem; }
    .clear-query { padding:2px; border:0; box-shadow:none; background:transparent; }
    .result-count { flex:none; color:var(--text-faint); font-size:.75rem; }
    .view-changes { display:flex; align-items:center; gap:5px; }
    .view-changes button { min-height:28px; padding:3px 8px; font-size:.75rem; }
    .view-changes .save-view { background:var(--interactive-accent); color:var(--text-on-accent); }
    .toolbar-actions { margin-left:auto; }
    .toolbar-actions button { display:flex; align-items:center; gap:7px; min-height:30px; padding:4px 9px; border:1px solid var(--background-modifier-border); border-radius:6px; box-shadow:none; background:var(--background-primary); color:var(--text-normal); font-size:.81rem; }
    .toolbar-actions button:hover, .toolbar-actions button.active { background:var(--background-modifier-hover); }
    .view-menu-dismiss { position:absolute; z-index:29; inset:0; width:100%; height:100%; padding:0; border:0; border-radius:0; box-shadow:none; background:transparent; cursor:default; }
    .view-menu { position:absolute; z-index:30; top:82px; right:10px; display:flex; flex-direction:column; gap:3px; width:290px; max-height:min(560px,calc(100% - 92px)); padding:9px; overflow-y:auto; border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-primary); box-shadow:var(--shadow-l); }
    .menu-title { position:sticky; z-index:1; top:-9px; display:flex; align-items:center; justify-content:space-between; min-height:31px; padding:4px 6px 8px; background:var(--background-primary); font-size:.85rem; font-weight:700; }
    .menu-title button { display:flex; align-items:center; justify-content:center; width:23px; height:23px; padding:3px; border:0; border-radius:4px; box-shadow:none; background:transparent; color:var(--text-muted); }
    .menu-title button:hover { background:var(--background-modifier-hover); color:var(--text-normal); }
    .menu-title button span { width:15px; height:15px; }
    .view-menu .rename-view { display:flex; align-items:center; gap:6px; min-height:30px; padding:3px 6px; font-size:.77rem; }
    .rename-view input { width:155px; height:26px; margin-left:auto; padding:3px 6px; font-size:.77rem; }
    .delete-view { align-self:stretch; margin-top:7px; padding:7px 8px; border:0; border-top:1px solid var(--background-modifier-border); border-radius:0; box-shadow:none; background:transparent; color:var(--text-error); text-align:left; font-size:.77rem; }
    .view-menu > label:not(.menu-check) { display:flex; align-items:center; gap:7px; min-height:32px; padding:4px 6px; font-size:.8rem; }
    .view-menu > label > span { width:15px; height:15px; color:var(--text-muted); }
    .view-menu select { min-width:112px; max-width:145px; margin-left:auto; padding:3px 19px 3px 5px; font-size:.77rem; }
    .menu-section-title { margin-top:7px; padding:8px 6px 4px; border-top:1px solid var(--background-modifier-border); color:var(--text-muted); font-size:.72rem; font-weight:600; }
    .sort-list, .field-list { display:flex; flex-direction:column; max-height:160px; overflow:auto; }
    .sort-list button { display:flex; justify-content:space-between; align-items:center; padding:5px 8px; border:0; box-shadow:none; background:transparent; text-align:left; font-size:.79rem; }
    .sort-list button:hover, .sort-list button.chosen { background:var(--background-modifier-hover); }
    .sort-list button span { width:14px; height:14px; }
    .menu-check, .field-popover label { display:flex; align-items:center; gap:8px; padding:4px 7px; font-size:.79rem; cursor:pointer; }
    .table-content { display:flex; flex:1; min-height:0; }
    .table-content.archive-hidden { display:none; }
    .archive-list { flex:1; min-height:0; padding:12px 16px; overflow:auto; }
    .archive-list h3 { margin:0 0 12px; font-size:.9rem; }.archive-list p { color:var(--text-muted); font-size:.8rem; }
    .archive-item { display:flex; align-items:center; gap:10px; min-height:38px; padding:5px 8px; border-bottom:1px solid var(--background-modifier-border); font-size:.79rem; }
    .archive-item span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .archive-item small { max-width:30%; overflow:hidden; color:var(--text-faint); text-overflow:ellipsis; white-space:nowrap; }
    .archive-item button { flex:none; padding:4px 8px; font-size:.75rem; }
    .slice-panel { display:flex; flex-direction:column; flex:0 0 185px; gap:2px; padding:9px 6px; border-right:1px solid var(--background-modifier-border); overflow:auto; }
    .slice-heading { display:flex; align-items:center; gap:6px; padding:5px 7px 10px; color:var(--text-muted); font-size:.73rem; font-weight:600; }
    .slice-heading span { width:14px; height:14px; }
    .slice-panel button { display:flex; justify-content:space-between; gap:8px; width:100%; padding:6px 8px; border:0; border-radius:5px; box-shadow:none; background:transparent; text-align:left; font-size:.79rem; }
    .slice-panel button:hover, .slice-panel button.chosen { background:var(--background-modifier-hover); }
    .slice-panel button em { color:var(--text-faint); font-size:.73rem; font-style:normal; }
    .grid-scroll { flex:1; min-width:0; overflow:auto; }
    .project-grid { border:0; border-collapse:separate; border-spacing:0; table-layout:fixed; font-size:.79rem; }
    .project-grid th, .project-grid td { box-sizing:border-box; }
    .project-grid td { overflow:hidden; text-overflow:ellipsis; }
    .project-grid td:has(.row-action-menu), .project-grid td.cell-selected { overflow:visible; }
    .project-grid.resizing-columns { cursor:col-resize; user-select:none; }
    .project-grid thead th > :global(.column-resize-handle) { position:absolute; z-index:12; top:0; right:-4px; display:block; width:9px; height:100%; min-width:0; margin:0; padding:0; border:0; border-radius:0; box-shadow:none; background:transparent; cursor:col-resize; touch-action:none; }
    .project-grid thead th > :global(.column-resize-handle:hover), .project-grid thead th > :global(.column-resize-handle:focus-visible) { background:var(--interactive-accent); outline:0; }
    .reset-column-widths { margin-top:8px; font-size:.77rem; }
    .project-grid th, .project-grid td { height:35px; padding:0 9px; border-right:1px solid var(--background-modifier-border); border-bottom:1px solid var(--background-modifier-border); white-space:nowrap; }
    .project-grid th:last-child, .project-grid td:last-child { border-right:0; }
    .project-grid thead th { position:sticky; z-index:5; top:0; height:31px; background:var(--background-primary); color:var(--text-muted); text-align:left; font-size:.74rem; font-weight:500; }
    .project-grid thead th > button { display:inline-flex; align-items:center; gap:5px; max-width:calc(100% - 22px); overflow:hidden; padding:3px 0; border:0; box-shadow:none; background:transparent; color:inherit; font:inherit; text-align:left; white-space:nowrap; }
    .project-grid .add-field > button, .project-grid .title-column > button { max-width:100%; }
    .project-grid thead th > button.header-hide { position:absolute; right:9px; top:50%; transform:translateY(-50%); }
    .project-grid thead th > button span, .header-hide span { width:13px; height:13px; }
    .project-grid thead th:hover { background:var(--background-secondary); }
    .project-grid th.row-index, .project-grid td.row-index { position:sticky; left:0; z-index:6; width:44px; min-width:44px; max-width:44px; padding:0 6px; background:var(--background-primary); text-align:center; }
    .project-grid thead th.row-index { z-index:10; }
    .row-index input { display:none; width:14px; height:14px; margin:0; vertical-align:middle; }
    .project-grid thead .row-index input, .project-grid tbody tr:hover .row-index input, .project-grid tbody tr.selected .row-index input { display:inline-block; }
    .row-number { display:inline; color:var(--text-faint); font-size:.7rem; }
    .project-grid tbody tr:hover .row-number, .project-grid tbody tr.selected .row-number { display:none; }
    .project-grid tbody tr:hover td { background:var(--background-modifier-hover); }
    .project-grid tbody tr.selected td { background:color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary)); }
    .project-grid td.cell-selected { position:relative; box-shadow:inset 0 0 0 2px var(--interactive-accent); }
    .fill-handle { position:absolute; right:-3px; bottom:-3px; z-index:3; width:8px; height:8px; border:1px solid var(--background-primary); border-radius:2px; background:var(--interactive-accent); cursor:crosshair; }
    .project-grid .title-column, .project-grid .title-cell { min-width:0; }
    .title-inner { display:flex; align-items:center; gap:7px; min-width:0; }
    .task-icon { flex:none; width:16px; height:16px; color:var(--color-green); }
    .task-check-button { display:flex; align-items:center; justify-content:center; flex:none; width:20px; height:20px; padding:0; border:0; background:transparent; cursor:pointer; }
    .task-check-button:hover .task-icon { color:var(--interactive-accent); }
    .task-link { flex:0 1 auto; min-width:0; overflow:hidden; padding:0; border:0; box-shadow:none; background:transparent; color:var(--text-normal); text-align:left; text-overflow:ellipsis; white-space:nowrap; font-size:.79rem; }
    .task-link:hover { color:var(--text-accent); text-decoration:underline; }
    .github-item-link { display:inline-flex; flex:none; align-items:center; color:var(--text-faint); }
    .github-item-link:hover { color:var(--text-accent); }
    .github-item-link span { display:block; width:12px; height:12px; }
    .name-edit { flex:1; min-width:80px; height:25px; padding:2px 5px; font-size:.79rem; }
    .subtask-count { display:inline-flex; align-items:center; gap:3px; flex:none; color:var(--text-faint); font-size:.7rem; }
    .subtask-count span { width:12px; height:12px; }
    .row-edit { display:none; flex:none; margin-left:auto; padding:2px; border:0; box-shadow:none; background:transparent; color:var(--text-faint); }
    .row-edit span { display:block; width:13px; height:13px; }
    tr:hover .row-edit { display:block; }
    .project-grid .group-row td { height:38px; padding:0 10px; background:var(--background-secondary); }
    .group-row td { color:var(--text-normal); }
    .project-grid .stage-row td { height:40px; background:var(--background-primary); }
    .stage-content { display:flex; align-items:center; gap:7px; min-width:0; }
    .project-grid .stage-collection-row td { height:42px; background:var(--background-secondary); border-top:1px solid var(--background-modifier-border); }
    .stage-collection-content { display:flex; align-items:center; gap:9px; }
    .stage-collection-icon { display:block; width:17px; height:17px; color:var(--interactive-accent); }
    .stage-collection-title { padding:0; border:0; box-shadow:none; background:transparent; color:var(--text-normal); font-weight:650; text-align:left; }
    .stage-collection-content :global(.subissue-progress) { margin-left:auto; }
    .manage-stage-groups { margin:3px 6px; font-size:.75rem; }
    .stage-group-editor { flex:none; padding:12px 16px; border-bottom:1px solid var(--background-modifier-border); background:var(--background-secondary); }
    .stage-group-editor-heading { display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; margin-bottom:10px; font-size:.8rem; }
    .stage-group-editor-heading span { color:var(--text-muted); }
    .stage-group-assignments { max-height:240px; overflow:auto; }
    .stage-group-assignments label { display:grid; grid-template-columns:minmax(180px,1fr) minmax(140px,240px); align-items:center; gap:12px; padding:4px 0; font-size:.78rem; }
    .stage-group-assignments label > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .stage-group-assignments input { width:100%; height:30px; }
    .stage-group-editor-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:10px; }
    .stage-icon { display:inline-flex; flex:none; width:17px; height:17px; color:var(--color-green); }
    .stage-title { min-width:0; overflow:hidden; padding:0; border:0; box-shadow:none; background:transparent; color:var(--text-normal); font-size:.8rem; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
    .stage-title:hover { color:var(--text-accent); text-decoration:underline; }
    .group-toggle { display:inline-flex; vertical-align:middle; padding:2px; border:0; box-shadow:none; background:transparent; }
    .group-toggle span { width:14px; height:14px; }
    .group-dot { display:inline-block; width:12px; height:12px; margin:0 8px 0 5px; border:2px solid var(--interactive-accent); border-radius:50%; vertical-align:middle; }
    .group-dot.priority-high { border-color:var(--color-red); }.group-dot.priority-medium { border-color:var(--color-yellow); }.group-dot.priority-low { border-color:var(--color-blue); }
    .group-row strong { font-size:.81rem; }
    .project-grid .checklist-parent-row td { height:34px; background:color-mix(in srgb, var(--background-secondary) 65%, var(--background-primary)); }
    .checklist-parent-content { display:flex; align-items:center; gap:7px; min-width:0; }
    .checklist-parent-title { min-width:0; overflow:hidden; padding:0; border:0; box-shadow:none; background:transparent; color:var(--text-normal); font-size:.78rem; font-weight:600; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
    .checklist-parent-title:hover { color:var(--text-accent); text-decoration:underline; }
    .checklist-parent-icon { display:inline-flex; flex:none; width:14px; height:14px; color:var(--text-muted); }
    .checklist-parent-content .group-count { flex:none; margin-left:2px; }
    .add-subissue { display:none; align-items:center; justify-content:center; flex:none; width:22px; height:22px; padding:2px; border:1px solid var(--background-modifier-border); border-radius:5px; box-shadow:none; background:var(--background-primary); color:var(--text-muted); cursor:pointer; }
    .add-subissue span { width:14px; height:14px; }
    tr:hover .add-subissue, tr:focus-within .add-subissue { display:inline-flex; }
    .add-subissue:hover { color:var(--text-accent); border-color:var(--interactive-accent); }
    .row-action-wrap { position:relative; display:inline-flex; flex:none; vertical-align:middle; }
    .row-menu-toggle { display:none; align-items:center; justify-content:center; width:22px; height:22px; padding:2px; border:0; box-shadow:none; background:transparent; color:var(--text-muted); cursor:pointer; }
    .row-menu-toggle span { width:15px; height:15px; }
    tr:hover .row-menu-toggle, tr:focus-within .row-menu-toggle { display:inline-flex; }
    .row-menu-toggle:hover { color:var(--text-normal); background:var(--background-modifier-hover); }
    .row-action-menu { position:absolute; z-index:40; top:24px; left:0; display:flex; flex-direction:column; min-width:170px; padding:4px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-primary); box-shadow:var(--shadow-l); }
    .row-action-menu button, .row-action-menu a { display:block; width:100%; min-height:27px; padding:5px 8px; border:0; border-radius:4px; box-shadow:none; background:transparent; color:var(--text-normal); font-size:.75rem; text-align:left; text-decoration:none; white-space:nowrap; cursor:pointer; }
    .row-action-menu button:hover, .row-action-menu a:hover { background:var(--background-modifier-hover); }
    .task-disclosure { margin-left:-21px; margin-right:1px; }
    .subissue-add-row td { height:36px; background:var(--background-primary); }
    .subissue-add-row input { min-width:260px; width:40%; height:27px; margin:3px 8px 3px 12px; padding:3px 7px; }
    .subissue-add-row button { height:26px; margin-right:5px; padding:2px 8px; }
    .group-count, .group-sum { margin-left:8px; padding:2px 6px; border:1px solid var(--background-modifier-border); border-radius:9px; background:var(--background-primary); color:var(--text-muted); font-size:.68rem; }
    .group-sum { border-radius:4px; }
    .status-pill, .priority-pill { box-sizing:border-box; max-width:100%; min-width:0; height:24px; padding:2px 19px 2px 8px; border:1px solid var(--background-modifier-border); border-radius:12px; background:var(--background-secondary); color:var(--text-normal); font-size:.73rem; }
    .status-pill { background:color-mix(in srgb, var(--interactive-accent) 11%, var(--background-primary)); }
    .priority-pill.high { background:color-mix(in srgb, var(--color-red) 13%, var(--background-primary)); }.priority-pill.medium { background:color-mix(in srgb, var(--color-yellow) 15%, var(--background-primary)); }.priority-pill.low { background:color-mix(in srgb, var(--color-blue) 13%, var(--background-primary)); }
    .cell-input { width:100%; min-width:0; height:25px; padding:2px 5px; border:1px solid transparent; border-radius:4px; box-shadow:none; background:transparent; color:var(--text-normal); font-size:.76rem; }
    .cell-input:hover, .cell-input:focus { border-color:var(--background-modifier-border); background:var(--background-primary); }
    .tags-input { color:var(--text-accent); }.date-input, .duration-input { min-width:0; }
    .plain-value { display:block; max-width:100%; overflow:hidden; color:var(--text-muted); text-overflow:ellipsis; }
    .project-grid th.add-field, .project-grid td.end-cell { width:36px; min-width:36px; padding:0 7px; }
    .project-grid th.add-field { z-index:9; }
    .add-field button span { width:15px; height:15px; }
    .field-popover { position:absolute; z-index:20; top:29px; right:0; display:flex; flex-direction:column; width:170px; max-height:290px; padding:8px; overflow:auto; border:1px solid var(--background-modifier-border); border-radius:7px; background:var(--background-primary); box-shadow:var(--shadow-l); color:var(--text-normal); }
    .field-popover strong { padding:3px 7px 7px; font-size:.8rem; }
    .project-grid .add-row td { height:36px; padding:0 16px; color:var(--text-muted); }
    .add-row button { display:inline-flex; align-items:center; gap:7px; padding:3px 0; border:0; box-shadow:none; background:transparent; color:var(--text-muted); font-size:.79rem; }
    .add-row button:hover { color:var(--text-normal); }.add-row span { display:inline-block; width:15px; height:15px; vertical-align:middle; }
    .add-row input { min-width:200px; width:35%; height:27px; margin-left:7px; padding:3px 7px; font-size:.79rem; }
    .add-row input + button { margin-left:10px; color:var(--text-accent); }
    .no-results { display:flex; flex-direction:column; align-items:center; gap:8px; padding:40px 16px; color:var(--text-muted); font-size:.82rem; }
    .no-results button { font-size:.77rem; }
    .undo-bar { position:absolute; z-index:15; right:16px; bottom:15px; display:flex; align-items:center; gap:10px; padding:7px 10px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-primary); box-shadow:var(--shadow-l); font-size:.76rem; }
    .undo-bar button { padding:3px 5px; border:0; box-shadow:none; background:transparent; color:var(--text-accent); font-size:.76rem; }.undo-bar button span { display:block; width:13px; height:13px; }
    @media (max-width:650px) {
        .result-count { display:none; }.slice-panel { flex-basis:145px; }.view-menu { max-width:calc(100% - 20px); }
        .stage-group-editor { padding:10px; }
        .stage-group-assignments label { grid-template-columns:minmax(0,1fr) minmax(120px,1fr); }
    }
</style>
