<script lang="ts">
    import type { App } from 'obsidian';
    import type HabitTimerPlugin from '../../main';
    import type { ProjectsView } from '../../projects-view';
    import type { ViewContext } from '../../projects/views/base-view';
    import { t } from '../../i18n';
    import {
        activeScopeId, columns, compactMode, currentTab, filteredTasks,
        filterHabit, filterTag, scopesWithStats, searchQuery, selectedTasks, tasks
    } from '../../store/ProjectsStore';
    import Board from './Board.svelte';
    import ProjectCalendar from './ProjectCalendar.svelte';
    import ProjectDashboard from './ProjectDashboard.svelte';
    import ProjectGallery from './ProjectGallery.svelte';
    import ProjectTable from './ProjectTable.svelte';
    import VanillaViewWrapper from './VanillaViewWrapper.svelte';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: ProjectsView;

    let bulkStatus = '';

    $: lang = plugin.settings.language;
    $: activeScope = plugin.settings.projectScopes?.find(scope => scope.id === $activeScopeId);
    $: allTags = [...new Set($tasks.flatMap(task =>
        task.tags?.split(',').map(tag => tag.trim()).filter(Boolean) || []
    ))].sort((a, b) => a.localeCompare(b));
    $: habits = [...new Set($tasks.map(task => task.habitName).filter((value): value is string => Boolean(value)))].sort();
    $: ctx = {
        allTasks: $tasks,
        filteredTasks: $filteredTasks,
        selectedTasks: $selectedTasks,
        compactMode: $compactMode,
        columns: $columns,
        onRefresh: () => void view.loadTasks(),
        onSelectionChange: (selection?: Set<string>) => {
            const next = new Set(selection ?? $selectedTasks);
            view.selectedTasks = next;
            selectedTasks.set(new Set(next));
        }
    } satisfies ViewContext;

    async function changeBulkStatus(): Promise<void> {
        if (!bulkStatus) return;
        await view.changeSelectedStatus(bulkStatus);
        bulkStatus = '';
    }
</script>

<div class="projects-app">
    {#if $scopesWithStats.length}
        <nav class="scope-switcher" aria-label={lang === 'ru' ? 'Области проектов' : 'Project scopes'}>
            {#each $scopesWithStats as scope}
                <button
                    class:active={$activeScopeId === scope.id}
                    style:border-color={scope.color || 'var(--background-modifier-border)'}
                    on:click={() => void view.setActiveScope(scope.id)}
                >
                    <span>{scope.name}</span>
                    <small>{scope.done}/{scope.total}</small>
                    <span class="scope-progress"><span style:width={`${scope.pct}%`}></span></span>
                </button>
            {/each}
        </nav>
    {/if}

    <nav class="project-tabs" aria-label={lang === 'ru' ? 'Представление проекта' : 'Project view'}>
        <button class:active={$currentTab === 'board'} on:click={() => $currentTab = 'board'}>{t(lang, 'kanban_board')}</button>
        <button class:active={$currentTab === 'table'} on:click={() => $currentTab = 'table'}>{t(lang, 'table_view')}</button>
        <button class:active={$currentTab === 'calendar'} on:click={() => $currentTab = 'calendar'}>{t(lang, 'calendar_view')}</button>
        <button class:active={$currentTab === 'dashboard'} on:click={() => $currentTab = 'dashboard'}>{t(lang, 'dashboard_view')}</button>
        <button class:active={$currentTab === 'gallery'} on:click={() => $currentTab = 'gallery'}>{t(lang, 'gallery_view') || 'Gallery'}</button>
        <button class:active={$currentTab === 'canvas'} on:click={() => $currentTab = 'canvas'}>{t(lang, 'canvas_view') || 'Canvas'}</button>
    </nav>

    {#if $currentTab !== 'canvas'}
        <div class="project-filters">
            <input type="search" placeholder={lang === 'ru' ? 'Поиск задач' : 'Search tasks'} bind:value={$searchQuery} />
            <select bind:value={$filterHabit} aria-label={lang === 'ru' ? 'Фильтр привычки' : 'Habit filter'}>
                <option value="all">{lang === 'ru' ? 'Все привычки' : 'All habits'}</option>
                <option value="none">{lang === 'ru' ? 'Без привычки' : 'No habit'}</option>
                {#each habits as habit}<option value={habit}>{habit}</option>{/each}
            </select>
            <select bind:value={$filterTag} aria-label={lang === 'ru' ? 'Фильтр тега' : 'Tag filter'}>
                <option value="all">{lang === 'ru' ? 'Все теги' : 'All tags'}</option>
                {#each allTags as tag}<option value={tag}>#{tag}</option>{/each}
            </select>
            <label class="compact-toggle">
                <input type="checkbox" bind:checked={$compactMode} />
                <span>{lang === 'ru' ? 'Компактно' : 'Compact'}</span>
            </label>
        </div>
    {/if}

    {#if $selectedTasks.size}
        <div class="bulk-toolbar">
            <strong>{lang === 'ru' ? `Выбрано: ${$selectedTasks.size}` : `Selected: ${$selectedTasks.size}`}</strong>
            <select bind:value={bulkStatus} on:change={() => void changeBulkStatus()}>
                <option value="">{lang === 'ru' ? 'Изменить статус' : 'Change status'}</option>
                {#each $columns as status}<option value={status}>{status}</option>{/each}
            </select>
            <button on:click={() => void view.duplicateSelected()}>{lang === 'ru' ? 'Дублировать' : 'Duplicate'}</button>
            <button on:click={() => void view.exportSelected()}>{lang === 'ru' ? 'Экспорт' : 'Export'}</button>
            <button class="danger" on:click={() => void view.deleteSelected()}>{lang === 'ru' ? 'Удалить' : 'Delete'}</button>
            <button class="clear" title={lang === 'ru' ? 'Снять выделение' : 'Clear selection'} aria-label={lang === 'ru' ? 'Снять выделение' : 'Clear selection'} on:click={() => view.clearSelection()}>×</button>
        </div>
    {/if}

    <main class:canvas={$currentTab === 'canvas'}>
        {#if !activeScope}
            <div class="empty">{lang === 'ru' ? 'Настройте область проекта' : 'Configure a project scope'}</div>
        {:else if $currentTab === 'board'}
            <Board {plugin} {app} view={view.boardSubView} scope={activeScope} {ctx} />
        {:else if $currentTab === 'table'}
            <ProjectTable {plugin} dataEngine={view.dataEngine} scope={activeScope} {ctx} />
        {:else if $currentTab === 'calendar'}
            <ProjectCalendar {plugin} dataEngine={view.dataEngine} scope={activeScope} {ctx} />
        {:else if $currentTab === 'dashboard'}
            <ProjectDashboard {plugin} dataEngine={view.dataEngine} scope={activeScope} {ctx} />
        {:else if $currentTab === 'gallery'}
            <ProjectGallery {plugin} dataEngine={view.dataEngine} scope={activeScope} {ctx} />
        {:else}
            <VanillaViewWrapper subView={view.canvasSubView} scope={activeScope} {ctx} />
        {/if}
    </main>
</div>

<style>
    .projects-app { display:flex; flex-direction:column; height:100%; min-height:0; padding:12px; overflow:hidden; }
    .scope-switcher,.project-tabs,.project-filters,.bulk-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:7px; flex-shrink:0; }
    .scope-switcher { padding:8px 0 12px; overflow-x:auto; flex-wrap:nowrap; }
    .scope-switcher button { position:relative; display:grid; grid-template-columns:auto auto; gap:2px 10px; min-width:130px; padding:7px 10px 9px; border:1px solid; border-radius:6px; text-align:left; }
    .scope-switcher button.active { background:var(--background-modifier-hover); box-shadow:inset 0 0 0 1px var(--interactive-accent); }
    .scope-switcher small { color:var(--text-muted); text-align:right; }
    .scope-progress { grid-column:1/-1; height:3px; overflow:hidden; background:var(--background-modifier-border); }
    .scope-progress span { display:block; height:100%; background:var(--interactive-accent); }
    .project-tabs { padding-bottom:9px; border-bottom:1px solid var(--background-modifier-border); overflow-x:auto; flex-wrap:nowrap; }
    .project-tabs button { white-space:nowrap; }
    .project-tabs button.active { background:var(--interactive-accent); color:var(--text-on-accent); }
    .project-filters { padding:10px 0; }
    .project-filters input { flex:1 1 220px; max-width:360px; }
    .project-filters input,.project-filters select { height:34px; }
    .compact-toggle { display:flex; align-items:center; gap:6px; margin-left:auto; color:var(--text-muted); }
    .bulk-toolbar { padding:8px 10px; background:var(--background-secondary); border-left:3px solid var(--interactive-accent); }
    .bulk-toolbar strong { margin-right:auto; }
    .bulk-toolbar .danger { color:var(--text-error); }
    .bulk-toolbar .clear { width:28px; height:28px; padding:0; font-size:20px; }
    main { position:relative; flex:1; min-height:0; padding-top:10px; overflow:auto; }
    main.canvas { display:flex; overflow:hidden; }
    .empty { padding:48px 16px; color:var(--text-muted); text-align:center; }
    @media (max-width:600px) {
        .projects-app { padding:8px; }
        .compact-toggle { margin-left:0; }
        .bulk-toolbar strong { flex-basis:100%; }
    }
</style>
