<script lang="ts">
    import { setIcon, type App } from 'obsidian';
    import type { Action } from 'svelte/action';
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
    import ProjectTimeline from './ProjectTimeline.svelte';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: ProjectsView;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    const tabs = [
        { id: 'board', icon: 'square-kanban', label: 'kanban_board' },
        { id: 'table', icon: 'table-2', label: 'table_view' },
        { id: 'calendar', icon: 'calendar-days', label: 'calendar_view' },
        { id: 'dashboard', icon: 'layout-dashboard', label: 'dashboard_view' },
        { id: 'gallery', icon: 'images', label: 'gallery_view' },
        { id: 'timeline', icon: 'calendar-range', label: 'timeline_view' }
    ] as const;

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

    function openSettings(): void {
        const setting = (app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
        if (!setting) return;
        setting.open();
        setting.openTabById(plugin.manifest.id);
    }
</script>

<div class="projects-app">
    {#if $scopesWithStats.length}
        <nav class="scopes" aria-label={t(lang, 'projects_scopes_aria')}>
            {#each $scopesWithStats as scope (scope.id)}
                <button
                    class="scope-card"
                    class:active={$activeScopeId === scope.id}
                    style={`--scope-color:${scope.color || 'var(--interactive-accent)'}`}
                    aria-pressed={$activeScopeId === scope.id}
                    on:click={() => void view.setActiveScope(scope.id)}
                >
                    <span class="scope-top">
                        <span class="scope-name">{scope.name}</span>
                        <span class="scope-pct">{scope.pct}%</span>
                    </span>
                    <span class="scope-bar"><span style={`width:${scope.pct}%`}></span></span>
                    <span class="scope-counts">{scope.done}/{scope.total}</span>
                </button>
            {/each}
        </nav>
    {/if}

    <nav class="tabs" aria-label={t(lang, 'projects_tabs_aria')}>
        {#each tabs as tab (tab.id)}
            <button class:active={$currentTab === tab.id} on:click={() => $currentTab = tab.id}>
                <span class="tab-icon" use:icon={tab.icon}></span><span class="tab-label">{t(lang, tab.label)}</span>
            </button>
        {/each}
    </nav>

    {#if activeScope}
        <div class="filters">
            <div class="search">
                <span use:icon={'search'}></span>
                <input type="search" placeholder={t(lang, 'projects_search')} aria-label={t(lang, 'projects_search')} bind:value={$searchQuery} />
            </div>
            <div class="chip">
                <span class="chip-icon" use:icon={'repeat-2'}></span>
                <select bind:value={$filterHabit} aria-label={t(lang, 'projects_filter_habit_aria')}>
                    <option value="all">{t(lang, 'projects_filter_all_habits')}</option>
                    <option value="none">{t(lang, 'projects_filter_no_habit')}</option>
                    {#each habits as habit}<option value={habit}>{habit}</option>{/each}
                </select>
            </div>
            <div class="chip">
                <span class="chip-icon" use:icon={'tags'}></span>
                <select bind:value={$filterTag} aria-label={t(lang, 'projects_filter_tag_aria')}>
                    <option value="all">{t(lang, 'projects_filter_all_tags')}</option>
                    {#each allTags as tag}<option value={tag}>#{tag}</option>{/each}
                </select>
            </div>
            <label class="chip toggle">
                <input type="checkbox" bind:checked={$compactMode} />
                <span class="chip-icon" use:icon={'list'}></span>
                <span>{t(lang, 'projects_compact')}</span>
            </label>
        </div>
    {/if}

    {#if $selectedTasks.size}
        <div class="bulk" role="toolbar" aria-label={t(lang, 'projects_selected_count', [$selectedTasks.size])}>
            <strong>{t(lang, 'projects_selected_count', [$selectedTasks.size])}</strong>
            <select bind:value={bulkStatus} on:change={() => void changeBulkStatus()} aria-label={t(lang, 'projects_change_status')}>
                <option value="">{t(lang, 'projects_change_status')}</option>
                {#each $columns as status}<option value={status}>{status}</option>{/each}
            </select>
            <button on:click={() => void view.duplicateSelected()}><span class="bulk-icon" use:icon={'copy'}></span>{t(lang, 'projects_bulk_duplicate')}</button>
            <button on:click={() => void view.exportSelected()}><span class="bulk-icon" use:icon={'download'}></span>{t(lang, 'projects_bulk_export')}</button>
            <button class="danger" on:click={() => void view.deleteSelected()}><span class="bulk-icon" use:icon={'trash-2'}></span>{t(lang, 'projects_bulk_delete')}</button>
            <button class="clear" title={t(lang, 'projects_clear_selection')} aria-label={t(lang, 'projects_clear_selection')} on:click={() => view.clearSelection()}>
                <span class="bulk-icon" use:icon={'x'}></span>
            </button>
        </div>
    {/if}

    <main>
        {#if !activeScope}
            <div class="app-empty">
                <span class="empty-icon" use:icon={'folder-open'}></span>
                <h3>{t(lang, 'projects_empty_title')}</h3>
                <p>{t(lang, 'projects_empty_hint')}</p>
                <button class="empty-action" on:click={openSettings}><span use:icon={'settings'}></span>{t(lang, 'projects_open_settings')}</button>
            </div>
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
        {:else if $currentTab === 'timeline'}
            <ProjectTimeline {plugin} dataEngine={view.dataEngine} scope={activeScope} {ctx} />
        {/if}
    </main>
</div>

<style>
    .projects-app { display:flex; flex-direction:column; gap:10px; height:100%; min-height:0; padding:12px; overflow:hidden; }

    .scopes { display:flex; flex-shrink:0; gap:8px; overflow-x:auto; padding-bottom:2px; }
    .scope-card { position:relative; display:flex; flex-direction:column; gap:6px; flex:0 0 auto; min-width:168px; max-width:220px; height:auto; min-height:0; padding:11px 14px 10px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); text-align:left; align-items:stretch; justify-content:flex-start; text-align:left; transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
    .scope-card:hover { border-color:var(--background-modifier-border-hover); box-shadow:var(--shadow-m); transform:translateY(-1px); }
    .scope-card.active { border-color:var(--scope-color); box-shadow:0 0 0 1px var(--scope-color), var(--shadow-s); }
    .scope-top { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
    .scope-card > * { flex:0 0 auto; }
    .scope-name { overflow:hidden; color:var(--text-normal); font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
    .scope-pct { color:var(--scope-color); font-size:.78rem; font-weight:700; }
    .scope-bar { height:6px; overflow:hidden; border-radius:3px; background:var(--background-modifier-border); }
    .scope-bar span { display:block; height:100%; border-radius:3px; background:var(--scope-color); transition:width .25s ease; }
    .scope-counts { color:var(--text-faint); font-size:.68rem; }

    .tabs { display:flex; flex-shrink:0; gap:4px; width:fit-content; max-width:100%; padding:4px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-secondary); overflow-x:auto; }
    .tabs button { display:flex; flex:0 0 auto; align-items:center; justify-content:center; gap:7px; height:auto; min-height:0; padding:7px 13px; border:0; box-shadow:none; border-radius:var(--radius-m); background:transparent; color:var(--text-muted); font-size:.82rem; white-space:nowrap; transition:background .12s ease, color .12s ease; }
    .tabs button:hover { color:var(--text-normal); }
    .tabs button.active { background:var(--interactive-accent); color:var(--text-on-accent); }
    .tabs button .tab-icon { display:block; flex-shrink:0; width:15px; height:15px; }
    .tabs button .tab-icon :global(svg) { width:15px; height:15px; }
    .tabs button .tab-label { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tabs button:focus-visible { outline:2px solid var(--interactive-accent); outline-offset:1px; }

    .filters { display:flex; align-items:center; flex-shrink:0; gap:8px; flex-wrap:wrap; }
    .search { display:flex; flex:1 1 220px; max-width:360px; align-items:center; gap:8px; height:34px; padding:0 11px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m); background:var(--background-primary); }
    .search:focus-within { border-color:var(--interactive-accent); }
    .search span { display:block; flex-shrink:0; width:15px; height:15px; color:var(--text-faint); }
    .search input { flex:1; height:100%; padding:0; border:0; background:transparent; box-shadow:none; }
    .chip { display:flex; height:34px; align-items:center; gap:7px; padding:0 10px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m); background:var(--background-primary); color:var(--text-muted); font-size:.8rem; }
    .chip:focus-within { border-color:var(--interactive-accent); }
    .chip .chip-icon { display:block; flex-shrink:0; width:14px; height:14px; }
    .chip .chip-icon :global(svg) { width:14px; height:14px; }
    .chip select { height:100%; padding:0; border:0; background:transparent; box-shadow:none; color:var(--text-normal); }
    .chip.toggle { height:auto; min-height:0; cursor:pointer; }
    .chip.toggle:hover { border-color:var(--background-modifier-border-hover); }
    .chip.toggle:has(input:checked) { border-color:var(--interactive-accent); color:var(--text-normal); background:color-mix(in srgb, var(--interactive-accent) 8%, var(--background-primary)); }
    .chip.toggle input { position:absolute; width:1px; height:1px; margin:0; opacity:0; pointer-events:none; }

    .bulk { display:flex; align-items:center; flex-shrink:0; gap:8px; flex-wrap:wrap; padding:8px 12px; border:1px solid var(--background-modifier-border); border-left:3px solid var(--interactive-accent); border-radius:var(--radius-m); background:var(--background-secondary); box-shadow:var(--shadow-s); }
    .bulk strong { margin-right:auto; color:var(--text-normal); font-size:.82rem; }
    .bulk button { display:inline-flex; height:auto; min-height:0; align-items:center; gap:6px; }
    .bulk .bulk-icon { display:block; flex-shrink:0; width:14px; height:14px; }
    .bulk .bulk-icon :global(svg) { width:14px; height:14px; }
    .bulk .danger { color:var(--text-error); }
    .bulk .clear { width:30px; height:30px; justify-content:center; padding:6px; }

    main { position:relative; flex:1; min-height:0; overflow:auto; }
    .app-empty { display:flex; flex-direction:column; align-items:center; gap:6px; margin:8vh auto 0; max-width:420px; padding:40px 24px; border:1px dashed var(--background-modifier-border); border-radius:var(--radius-xl); background:var(--background-primary); text-align:center; }
    .empty-icon { margin-bottom:6px; color:var(--text-faint); }
    .empty-icon :global(svg) { width:36px; height:36px; }
    .app-empty h3 { margin:0; color:var(--text-normal); font-size:1rem; }
    .app-empty p { margin:0 0 10px; color:var(--text-muted); font-size:.8rem; }
    .empty-action { display:inline-flex; height:auto; min-height:0; align-items:center; gap:7px; padding:7px 14px; border-radius:var(--radius-m); }
    .empty-action span { display:block; width:14px; height:14px; }

    @media (max-width:600px) {
        .projects-app { padding:8px; gap:8px; }
        .tabs button .tab-icon { display:none; }
        .tabs button { flex:1 1 0; padding:7px 6px; }
    }
</style>
