<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { setIcon, type App } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import type { HomeView } from '../../home-view';
    import { t } from '../../i18n';
    import { moment } from 'obsidian';
    import { greetingKind, nearestTasks, buildDaySummary, buildProjectCards,
        type HomeTaskGrouped, type HomeProjectCard } from '../../home/home-model';
    import { isDone } from '../../utils/status';
    import type { DailyTask } from '../../tasks/model';
    import { getHabitValueFromFrontmatter, getHabitWeeklyValue, getHabitDeferredBonus } from '../../services/habit-service';
    import { getHabitGoals } from '../../habits/goals';
    import type { HabitProperty } from '../../types';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: HomeView;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    let lang = plugin.settings.language;
    let today = moment().format('YYYY-MM-DD');
    const GREETINGS = { morning: 'home_greeting_morning', afternoon: 'home_greeting_afternoon', evening: 'home_greeting_evening', night: 'home_greeting_night' } as const;
    let greetingKey: keyof typeof GREETINGS = greetingKind(moment().hour());
    let allTasks: DailyTask[] = [];
    let projects: HomeProjectCard[] = [];
    let activeScopeId = '';
    let timerSecondsToday = 0;
    let pagesToday = 0;
    let tick = 0;

    $: todayStr = moment().format('YYYY-MM-DD');
    $: dateLabel = moment().format(lang === 'ru' ? 'D MMMM, dddd' : 'dddd, D MMMM');
    $: nearest = nearestTasks(allTasks, todayStr, 5);
    $: summary = buildDaySummary({ timerSecondsToday, tasksDoneToday: allTasks.filter(task => task.done).length, pagesReadToday: pagesToday }, seconds => plugin.formatTime(seconds));
    $: activeTimer = tick >= 0 ? plugin.settings.activeTimer : null;
    $: activeTimerSeconds = activeTimer ? (activeTimer.elapsedSeconds || 0) + (activeTimer.timerState === 'running' && activeTimer.lastStartedAt ? Math.max(0, Math.floor((Date.now() - activeTimer.lastStartedAt) / 1000)) : 0) : 0;

    let timerHandle: ReturnType<typeof setInterval> | null = null;
    onMount(() => {
        timerHandle = setInterval(() => { tick += 1; }, 1000);
        void refresh();
    });
    onDestroy(() => { if (timerHandle) clearInterval(timerHandle); });

    async function refresh(): Promise<void> {
        try {
            const date = moment().format('YYYY-MM-DD');
            allTasks = await plugin.tasks.list();
            const cards: HomeProjectCard[] = [];
            for (const scope of plugin.settings.projectScopes || []) {
                try {
                    const scopeTasks = await plugin.projectEngine.loadTasks(scope);
                    const statuses = scope.statuses.split(',').map(status => status.trim()).filter(Boolean);
                    const doneStatus = statuses[statuses.length - 1] || 'Done';
                    cards.push(...buildProjectCards([{
                        scopeId: scope.id, name: scope.name, color: scope.color, statuses,
                        isTaskDone: (status: string) => isDone(status) || status === doneStatus,
                        tasks: scopeTasks.map(task => ({ name: task.name, status: task.status, endDate: task.endDate, done: false }))
                    }], date));
                } catch (error) { console.warn('Home: project load failed', scope.id, error); }
            }
            projects = cards;
            // Today timer total: from daily note frontmatter habit properties handled in habits card; summary uses tasks + media progress.
            pagesToday = 0;
        } catch (error) { console.error('Home refresh failed', error); }
    }

    function habitProgress(habit: { name: string; type?: 'timer' | 'binary' | 'negative' | 'count'; goalMinutes?: number }): { value: number; desired: number; mode: string } {
        const goal = getHabitGoals(habit as HabitProperty, todayStr, getHabitDeferredBonus(app, plugin.settings.dailyNotesFolder, habit as HabitProperty, todayStr));
        const note = plugin.getDailyNote(todayStr);
        const fm = note ? plugin.app.metadataCache.getFileCache(note)?.frontmatter || {} : {};
        const value = goal.mode === 'weekly'
            ? getHabitWeeklyValue(app, plugin.settings.dailyNotesFolder, habit as never, todayStr)
            : getHabitValueFromFrontmatter(fm, habit as HabitProperty);
        return { value, desired: goal.desired, mode: goal.mode };
    }

    function habitValueLabel(habit: { type?: 'timer' | 'binary' | 'negative' | 'count' }, progress: { value: number; desired: number }): string {
        return habit.type === 'timer'
            ? plugin.formatTime(progress.value) + ' / ' + plugin.formatTime(progress.desired)
            : `${progress.value} / ${progress.desired}`;
    }

    async function startHabit(habitName: string): Promise<void> {
        await plugin.startTimerForHabit(habitName, { openView: false });
        await refresh();
    }

    function navigate(viewType: string): void {
        void view.leaf.setViewState({ type: viewType, active: true }).catch(error => console.error('Home navigation failed', error));
    }

    async function toggleTask(task: HomeTaskGrouped, event: Event): Promise<void> {
        const checkbox = event.currentTarget as HTMLInputElement;
        const full = allTasks.find(candidate => candidate.name === task.name && (candidate.deadline || '') === (task.deadline || '') && (candidate.date || '') === (task.date || ''));
        if (!full) return;
        checkbox.disabled = true;
        try {
            await plugin.tasks.save({ ...full, done: checkbox.checked });
            await refresh();
        } catch (error) {
            checkbox.disabled = false;
            checkbox.checked = !checkbox.checked;
            console.error('Home: task toggle failed', error);
        }
    }

    function mediaInProgress(): { title: string; authors: string[]; cover: string; collectionId: string; file: { path: string } }[] {
        try {
            const items = get(plugin.stateManager.mediaItems) as never as { title: string; authors: string[]; cover: string; collectionId: string; status: string; file: { path: string } }[];
            return items.filter(item => (plugin.settings.mediaCollections || []).some(collection =>
                collection.id.toLowerCase() === item.collectionId.toLowerCase() && !!collection.readingStatusName &&
                collection.readingStatusName.trim().toLowerCase() === item.status.trim().toLowerCase())).slice(0, 4);
        } catch { return []; }
    }

    function startMedia(item: { title: string; collectionId: string; file: { path: string } }): void {
        void plugin.startTimerForMedia(item as never, { openView: false }).then(started => {
            if (started) navigate('habit-timer-view');
        });
    }

    function openNote(path: string): void {
        const file = app.vault.getAbstractFileByPath(path);
        if (file) void app.workspace.getLeaf(false).openFile(file as never);
    }

    $: media = tick >= 0 ? mediaInProgress() : [];
    $: habits = (plugin.settings.properties || []).map(habit => ({ habit, progress: habitProgress(habit) }));
    $: scopesEmpty = (plugin.settings.projectScopes || []).length === 0;
</script>

<div class="home-screen">
    <header class="home-header">
        <div>
            <h1>{t(lang, GREETINGS[greetingKey])}</h1>
            <span class="home-date">{dateLabel}</span>
        </div>
        <div class="home-timer-status" role="status">
            {#if activeTimer}
                <span class="home-timer-live"><span class="home-timer-dot" aria-hidden="true"></span>{activeTimer.habitName} · {plugin.formatTime(activeTimerSeconds)}</span>
            {/if}
            <button class="home-cta" on:click={() => navigate('habit-timer-view')}>
                <span use:icon={activeTimer ? 'timer' : 'play'}></span>{t(lang, activeTimer ? 'home_open_timer' : 'home_start_session')}
            </button>
        </div>
    </header>

    <section class="home-focus" aria-label={t(lang, 'home_focus_aria')}>
        <div class="home-focus-mark"><span use:icon={activeTimer ? 'loader' : 'circle-play'}></span></div>
        <div class="home-focus-body">
            <span class="home-eyebrow">{t(lang, activeTimer ? 'home_session_active' : 'home_focus')}</span>
            <h2>{activeTimer ? activeTimer.habitName : t(lang, 'home_focus_empty_title')}</h2>
            {#if activeTimer}
                <span class="home-muted">{plugin.formatTime(activeTimerSeconds)} · {t(lang, activeTimer.timerState === 'running' ? 'home_session_running' : 'home_session_paused')}</span>
            {:else}
                <span class="home-muted">{t(lang, 'home_focus_empty_hint')}</span>
            {/if}
        </div>
    </section>

    <div class="home-grid">
        <section class="home-card" aria-label={t(lang, 'home_habits_aria')}>
            <header class="home-card-head">
                <h3>{t(lang, 'home_habits_title')}</h3>
                <button class="home-mini" aria-label={t(lang, 'home_open_timer')} on:click={() => navigate('habit-timer-view')}><span use:icon={'arrow-up-right'}></span></button>
            </header>
            {#each habits as entry (entry.habit.name)}
                <div class="home-line">
                    <div class="home-line-body">
                        <strong>{entry.habit.name}</strong>
                        <span class="home-muted">{habitValueLabel(entry.habit, entry.progress)}</span>
                        <div class="home-progress"><span style={`width:${Math.min(100, entry.progress.desired ? entry.progress.value / entry.progress.desired * 100 : 0)}%`}></span></div>
                    </div>
                    {#if entry.habit.type === 'timer'}
                        <button class="home-mini" aria-label={t(lang, 'home_start_habit') + ': ' + entry.habit.name} on:click={() => void startHabit(entry.habit.name)}><span use:icon={'play'}></span></button>
                    {/if}
                </div>
            {:else}
                <p class="home-empty"><span use:icon={'repeat-2'}></span>{t(lang, 'home_habits_empty')}</p>
            {/each}
        </section>

        <section class="home-card" aria-label={t(lang, 'home_tasks_aria')}>
            <header class="home-card-head">
                <h3>{t(lang, 'home_tasks_title')}</h3>
                <button class="home-mini" aria-label={t(lang, 'home_open_tasks')} on:click={() => navigate('habit-standalone-tasks')}><span use:icon={'arrow-up-right'}></span></button>
            </header>
            {#each nearest as task (task.name + task.sortKey)}
                <div class="home-line" class:home-overdue={task.overdue}>
                    <input type="checkbox" checked={task.done} aria-label={t(lang, 'home_task_done') + ': ' + task.name} on:change={(event) => void toggleTask(task, event)} />
                    <div class="home-line-body">
                        <strong>{task.name}</strong>
                        <span class="home-muted">{task.overdue ? t(lang, 'home_overdue') : task.sortKey !== '9999-12-31' ? task.sortKey : t(lang, 'home_no_date')}</span>
                    </div>
                </div>
            {:else}
                <p class="home-empty"><span use:icon={'list-checks'}></span>{t(lang, 'home_tasks_empty')}</p>
            {/each}
        </section>

        <section class="home-card" aria-label={t(lang, 'home_projects_aria')}>
            <header class="home-card-head">
                <h3>{t(lang, 'home_projects_title')}</h3>
                <button class="home-mini" aria-label={t(lang, 'home_open_projects')} on:click={() => navigate('habit-projects-view')}><span use:icon={'arrow-up-right'}></span></button>
            </header>
            {#if scopesEmpty}
                <p class="home-empty"><span use:icon={'columns-3'}></span>{t(lang, 'home_projects_empty')}</p>
            {:else}
                {#each projects as project (project.scopeId)}
                    <button class="home-project" style={`--project-color:${project.color || 'var(--interactive-accent)'}`} on:click={() => navigate('habit-projects-view')}>
                        <span class="home-project-head"><strong>{project.name}</strong><span class="home-muted">{project.done}/{project.total}</span></span>
                        <div class="home-progress"><span style={`width:${project.pct}%`}></span></div>
                        {#if project.nearestDeadline}<span class="home-muted home-deadline"><span use:icon={'calendar-clock'}></span>{t(lang, 'home_next_deadline')}: {project.nearestDeadline}</span>{/if}
                    </button>
                {:else}
                    <p class="home-empty"><span use:icon={'check-circle-2'}></span>{t(lang, 'home_projects_no_active')}</p>
                {/each}
            {/if}
        </section>

        <section class="home-card" aria-label={t(lang, 'home_library_aria')}>
            <header class="home-card-head">
                <h3>{t(lang, 'home_library_title')}</h3>
                <button class="home-mini" aria-label={t(lang, 'home_open_library')} on:click={() => navigate('habit-library-view')}><span use:icon={'arrow-up-right'}></span></button>
            </header>
            {#each media as item (item.file.path)}
                <div class="home-line">
                    {#if item.cover}<img class="home-cover" src={item.cover} alt="" loading="lazy" />{:else}<span class="home-cover-fallback" use:icon={'book-open'}></span>{/if}
                    <div class="home-line-body">
                        <strong>{item.title}</strong>
                        <span class="home-muted">{item.authors.join(', ')}</span>
                    </div>
                    <button class="home-mini" aria-label={t(lang, 'home_continue') + ': ' + item.title} on:click={() => startMedia(item)}><span use:icon={'play'}></span></button>
                </div>
            {:else}
                <p class="home-empty"><span use:icon={'library'}></span>{t(lang, 'home_library_empty')}</p>
            {/each}
        </section>
    </div>

    {#if summary}
        <footer class="home-summary">
            <span use:icon={'flame'}></span>
            <span>{t(lang, 'home_summary_prefix')}:</span>
            {#if timerSecondsToday > 0}<strong>{plugin.formatTime(timerSecondsToday)}</strong><span>{t(lang, 'home_summary_timer')}</span>{/if}
            <strong>{allTasks.filter(task => task.done).length}</strong><span>{t(lang, 'home_summary_tasks')}</span>
            {#if pagesToday > 0}<strong>{pagesToday}</strong><span>{t(lang, 'home_summary_pages')}</span>{/if}
        </footer>
    {/if}
</div>

<style>
    .home-screen { display:flex; flex-direction:column; gap:14px; height:100%; min-height:0; padding:24px 28px; overflow:auto; }
    .home-header { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    .home-header h1 { margin:0; font-size:26px; color:var(--text-normal); }
    .home-date { color:var(--text-muted); font-size:.85rem; }
    .home-timer-status { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .home-timer-live { display:inline-flex; align-items:center; gap:7px; padding:5px 12px; border:1px solid var(--background-modifier-border); border-radius:999px; background:var(--background-secondary); color:var(--text-normal); font-size:.8rem; }
    .home-timer-dot { width:8px; height:8px; border-radius:50%; background:var(--text-success); animation:home-pulse 1.6s ease-in-out infinite; }
    @keyframes home-pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
    .home-cta { display:inline-flex; align-items:center; gap:8px; padding:8px 16px; border-radius:var(--radius-m); }
    .home-cta span { display:block; width:15px; height:15px; }
    .home-cta span :global(svg) { width:15px; height:15px; }

    .home-focus { display:flex; align-items:center; gap:18px; padding:20px 22px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:linear-gradient(120deg, color-mix(in srgb, var(--interactive-accent) 9%, var(--background-primary)), var(--background-primary) 55%); box-shadow:var(--shadow-s); }
    .home-focus-mark { color:var(--interactive-accent); }
    .home-focus-mark :global(svg) { width:34px; height:34px; }
    .home-focus-body h2 { margin:2px 0; font-size:19px; color:var(--text-normal); }
    .home-eyebrow { color:var(--text-muted); font-size:.68rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .home-muted { color:var(--text-muted); font-size:.78rem; }

    .home-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; }
    .home-card { display:flex; flex-direction:column; gap:8px; padding:16px 18px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); transition:transform .12s ease, box-shadow .12s ease; }
    .home-card:hover { box-shadow:var(--shadow-m); }
    .home-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .home-card-head h3 { margin:0; font-size:1rem; color:var(--text-normal); }
    .home-mini { display:grid; place-items:center; width:28px; height:28px; min-height:0; padding:6px; box-shadow:none; border-radius:var(--radius-m); }
    .home-mini span { display:block; width:14px; height:14px; }
    .home-mini span :global(svg) { width:14px; height:14px; }

    .home-line { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--background-modifier-border-hover); }
    .home-line:last-child { border-bottom:0; }
    .home-line-body { display:flex; flex:1; min-width:0; flex-direction:column; gap:2px; }
    .home-line-body strong { overflow:hidden; color:var(--text-normal); font-size:.86rem; text-overflow:ellipsis; white-space:nowrap; }
    .home-line.home-overdue .home-line-body strong { color:var(--text-error); }
    .home-progress { height:5px; overflow:hidden; border-radius:3px; background:var(--background-modifier-border); }
    .home-progress span { display:block; height:100%; border-radius:3px; background:var(--interactive-accent); transition:width .25s ease; }
    :global(.home-overdue .home-progress span) { background:var(--text-error); }

    .home-project { display:flex; flex-direction:column; gap:6px; width:100%; padding:10px 12px; border:1px solid var(--background-modifier-border); border-left:3px solid var(--project-color); border-radius:var(--radius-m); background:var(--background-secondary); text-align:left; transition:transform .12s ease, border-color .12s ease; }
    .home-project:hover { border-color:var(--background-modifier-border-hover); transform:translateY(-1px); }
    .home-project-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
    .home-project-head strong { overflow:hidden; color:var(--text-normal); text-overflow:ellipsis; white-space:nowrap; }
    .home-deadline { display:inline-flex; align-items:center; gap:5px; }
    .home-deadline span { width:12px; height:12px; }
    .home-deadline span :global(svg) { width:12px; height:12px; }

    .home-cover { flex-shrink:0; width:34px; height:48px; border-radius:4px; object-fit:cover; }
    .home-cover-fallback { display:grid; place-items:center; flex-shrink:0; width:34px; height:48px; border-radius:4px; background:var(--background-secondary); color:var(--text-faint); }
    .home-cover-fallback :global(svg) { width:16px; height:16px; }

    .home-empty { display:flex; align-items:center; gap:9px; margin:6px 0; color:var(--text-faint); font-size:.8rem; }
    .home-empty span:first-child { display:block; width:18px; height:18px; flex-shrink:0; }
    .home-empty span:first-child :global(svg) { width:18px; height:18px; }

    .home-summary { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:10px 16px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-m); background:var(--background-secondary); color:var(--text-muted); font-size:.8rem; }
    .home-summary > span:first-child { display:block; width:15px; height:15px; color:var(--text-warning); }
    .home-summary > span:first-child :global(svg) { width:15px; height:15px; }
    .home-summary strong { color:var(--text-normal); }

    @media (max-width: 720px) {
        .home-screen { padding:14px 16px; }
        .home-grid { grid-template-columns:1fr; }
    }
</style>