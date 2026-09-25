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
    import { getHabitValueFromFrontmatter, getHabitWeeklyValue, getHabitDeferredBonus, calculateHabitStreak } from '../../services/habit-service';
    import { getHabitGoals } from '../../habits/goals';
    import type { DailyTask } from '../../tasks/model';
    import type { HabitProperty, MediaCollectionConfig } from '../../types';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: HomeView;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    let lang = plugin.settings.language;
    let today = moment().format('YYYY-MM-DD');
    let allTasks: DailyTask[] = [];
    let projects: HomeProjectCard[] = [];
    let timerSecondsToday = 0;
    let streak = 0;
    let tick = 0;
    let timerHandle: ReturnType<typeof setInterval> | null = null;

    $: todayStr = moment().format('YYYY-MM-DD');
    $: dateLabel = moment().format(lang === 'ru' ? 'YYYY-MM-DD · dddd' : 'YYYY-MM-DD · dddd');
    $: nearest = nearestTasks(allTasks, todayStr, 4);
    $: doneCount = allTasks.filter(task => task.done).length;
    $: summary = buildDaySummary({ timerSecondsToday, tasksDoneToday: doneCount }, seconds => plugin.formatTime(seconds));
    $: activeTimer = tick >= 0 ? plugin.settings.activeTimer : null;
    $: activeTimerSeconds = activeTimer ? (activeTimer.elapsedSeconds || 0) + (activeTimer.timerState === 'running' && activeTimer.lastStartedAt ? Math.max(0, Math.floor((Date.now() - activeTimer.lastStartedAt) / 1000)) : 0) : 0;
    $: media = tick >= 0 ? mediaInProgress() : [];
    $: habits = (plugin.settings.properties || []).map(habit => ({ habit, progress: habitProgress(habit) }));

    onMount(() => {
        timerHandle = setInterval(() => { tick += 1; }, 1000);
        void refresh();
    });
    onDestroy(() => { if (timerHandle) clearInterval(timerHandle); });

    async function refresh(): Promise<void> {
        try {
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
                    }], todayStr));
                } catch (error) { console.warn('Home: project load failed', scope.id, error); }
            }
            projects = cards;
            streak = await loadStreak();
        } catch (error) { console.error('Home refresh failed', error); }
    }

    async function loadStreak(): Promise<number> {
        try {
            const habits = plugin.settings.properties || [];
            if (!habits.length) return 0;
            const values = await Promise.all(habits.slice(0, 3).map(habit => calculateHabitStreak(app, plugin.settings.dailyNotesFolder, habit)));
            return Math.max(0, ...values);
        } catch { return 0; }
    }

    function habitProgress(habit: HabitProperty): { value: number; desired: number; mode: string } {
        const goal = getHabitGoals(habit, todayStr, getHabitDeferredBonus(app, plugin.settings.dailyNotesFolder, habit, todayStr));
        const note = plugin.getDailyNote(todayStr);
        const fm = note ? plugin.app.metadataCache.getFileCache(note)?.frontmatter || {} : {};
        const value = goal.mode === 'weekly'
            ? getHabitWeeklyValue(app, plugin.settings.dailyNotesFolder, habit, todayStr)
            : getHabitValueFromFrontmatter(fm, habit);
        return { value, desired: goal.desired, mode: goal.mode };
    }

    $: greetingText = t(lang, GREETINGS[greetingKind(moment().hour())]);
    function pct(value: number, desired: number): number {
        return desired > 0 ? Math.min(100, Math.round(value / desired * 100)) : 0;
    }

    function fmtClock(sec: number): string {
        const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
        return h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
            : `${m}:${String(x).padStart(2, '0')}`;
    }

    function shortHabit(habit: HabitProperty): string {
        const words = habit.name.split(' ');
        return words.length > 1 ? words.map(w => w[0]).join('').slice(0, 3).toUpperCase() : habit.name.slice(0, 3).toUpperCase();
    }

    function navigate(viewType: string): void {
        void view.leaf.setViewState({ type: viewType, active: true }).catch(error => console.error('Home navigation failed', error));
    }

    async function toggleTimerPause(): Promise<void> {
        if (!plugin.settings.activeTimer) return;
        if (plugin.settings.activeTimer.timerState === 'running') await plugin.pauseTimerSession();
        else await plugin.resumeTimerSession();
        tick += 1;
    }

    async function stopCurrentTimer(): Promise<void> {
        await plugin.stopTimer();
        tick += 1;
        await refresh();
    }

    async function startHabit(habitName: string): Promise<void> {
        await plugin.startTimerForHabit(habitName, { openView: false });
        tick += 1;
        await refresh();
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

    function mediaInProgress(): { title: string; authors: string[]; cover: string; collectionId: string; progress: number; total: number; unit: string; file: { path: string } }[] {
        try {
            const items = get(plugin.stateManager.mediaItems) as unknown as { title: string; authors: string[]; cover: string; collectionId: string; status: string; progress: number; total: number; unit: string; file: { path: string } }[];
            return items.filter(item => (plugin.settings.mediaCollections as MediaCollectionConfig[]).some(collection =>
                collection.id.toLowerCase() === item.collectionId.toLowerCase() && !!collection.readingStatusName &&
                collection.readingStatusName.trim().toLowerCase() === item.status.trim().toLowerCase())).slice(0, 2);
        } catch { return []; }
    }

    function startMedia(item: { title: string; collectionId: string; file: { path: string } }): void {
        void plugin.startTimerForMedia(item as never, { openView: false }).then(started => {
            if (started) navigate('habit-timer-view');
        });
    }

    const GREETINGS = { morning: 'home_greeting_morning', afternoon: 'home_greeting_afternoon', evening: 'home_greeting_evening', night: 'home_greeting_night' } as const;
    const ST = { RUNNING: 'running', PAUSED: 'paused' } as const;
    $: timerStateLabel = activeTimer?.timerState === ST.RUNNING ? t(lang, 'home_session_running') : t(lang, 'home_session_paused');
</script>

<div class="home-screen">
    <div class="cbar">
        <span class="glyph" aria-hidden="true">FL</span>
        <span class="greet">{greetingText}</span>
        <span class="date">{dateLabel}</span>
        <span class="sp"></span>
        <span class="status-chip" role="status">
            <span class="dot" class:paused={activeTimer?.timerState !== 'running'} aria-hidden="true"></span>
            <span class="mono">{activeTimer ? fmtClock(activeTimerSeconds) : '—:—'}</span>
        </span>
    </div>

    <div class="statusline" aria-hidden="true">
        <span class="ok">●</span><span>{t(lang, 'home4_status_ok')}</span>
        {#if activeTimer}<span>·</span><span class="run">▶ {activeTimer.habitName}</span>{/if}
        <span>·</span><span>{t(lang, 'home4_streak')}: {streak}d</span>
    </div>

    <div class="panes">
        <div class="pane timer-pane">
            <div class="timer">
                <div class="t">{activeTimer ? fmtClock(activeTimerSeconds) : '00:00'}</div>
                <div class="what">{activeTimer ? `${activeTimer.habitName} · ${timerStateLabel}` : t(lang, 'home4_timer_idle')}</div>
                <div class="btns">
                    {#if activeTimer}
                        <button on:click={() => void toggleTimerPause()}>{activeTimer?.timerState === 'running' ? t(lang, 'home4_pause') : t(lang, 'home4_resume')}</button>
                        <button on:click={() => void stopCurrentTimer()}>{t(lang, 'home4_stop')}</button>
                        <button on:click={() => navigate('habit-timer-view')}>{t(lang, 'home_open_timer')}</button>
                    {:else}
                        <button on:click={() => navigate('habit-timer-view')}>{t(lang, 'home_start_session')}</button>
                    {/if}
                </div>
            </div>
            <div class="rings">
                {#each habits.slice(0, 3) as entry, i (entry.habit.name)}
                    {@const p = pct(entry.progress.value, entry.progress.desired)}
                    <div class="ring">
                        <div class="c r{i + 1}" style={`background:conic-gradient(${['var(--green)', 'var(--blue)', 'var(--yellow)'][i]} ${p}%, var(--line) 0)`}>
                            <span class="in">{p}%</span>
                        </div>
                        <div class="lbl">{shortHabit(entry.habit)}</div>
                        <button class="ring-start" aria-label={t(lang, 'home_start_habit') + ': ' + entry.habit.name} on:click={() => void startHabit(entry.habit.name)}>▶</button>
                    </div>
                {:else}
                    <p class="empty">{t(lang, 'home_habits_empty')}</p>
                {/each}
            </div>
        </div>

        <div class="pane">
            <div class="q">
                <h3>{t(lang, 'home4_queue_tasks')} <span>{nearest.length} · {doneCount} {t(lang, 'home4_done')}</span></h3>
                {#each nearest as task (task.name + task.sortKey)}
                    <div class="row">
                        <span class="st {task.overdue ? 'over' : task.today ? 'now' : 'plan'}">{task.overdue ? t(lang, 'home_overdue') : task.today ? t(lang, 'home4_today') : t(lang, 'home4_plan')}</span>
                        <span class="nm">{task.name}</span>
                        <span class="meta">{task.sortKey === '9999-12-31' ? t(lang, 'home_no_date') : task.sortKey.slice(5)}</span>
                        <input type="checkbox" checked={task.done} aria-label={t(lang, 'home_task_done') + ': ' + task.name} on:change={(event) => void toggleTask(task, event)} />
                    </div>
                {:else}
                    <div class="row empty-row"><span class="nm">{t(lang, 'home_tasks_empty')}</span></div>
                {/each}
            </div>

            <div class="sep"></div>

            <div class="q2">
                <div class="q">
                    <h3>{t(lang, 'home_projects_title')} <span>{projects.length}</span></h3>
                    {#each projects as project (project.scopeId)}
                        <div class="row" role="button" tabindex="0" on:click={() => navigate('habit-projects-view')} on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate('habit-projects-view')}>
                            <span class="st {project.pct >= 50 ? 'ok' : 'plan'}">{project.pct}%</span>
                            <span class="nm">{project.name}</span>
                            <span class="meta">{project.nearestDeadline ? project.nearestDeadline.slice(5) : '—'}</span>
                            <span class="prio">{project.total - project.done} {t(lang, 'home4_left')}</span>
                        </div>
                    {:else}
                        <div class="row empty-row"><span class="nm">{t(lang, 'home_projects_empty')}</span></div>
                    {/each}
                </div>
                <div class="q">
                    <h3>{t(lang, 'home_library_title')} <span>{media.length}</span></h3>
                    {#each media as item (item.file.path)}
                        <div class="row">
                            <span class="st ok">{item.total ? Math.round(item.progress / item.total * 100) : 0}%</span>
                            <span class="nm">{item.title}</span>
                            <span class="meta">{item.progress}/{item.total} {item.unit}</span>
                            <button class="go-btn" aria-label={t(lang, 'home_continue') + ': ' + item.title} on:click={() => startMedia(item)}>▶</button>
                        </div>
                    {:else}
                        <div class="row empty-row"><span class="nm">{t(lang, 'home_library_empty')}</span></div>
                    {/each}
                </div>
            </div>
        </div>
    </div>

    {#if summary}
        <div class="hint">
            {t(lang, 'home_summary_prefix')}: <b>{timerSecondsToday ? plugin.formatTime(timerSecondsToday) : '—'}</b> {t(lang, 'home_summary_timer')} · <b>{doneCount}</b> {t(lang, 'home_summary_tasks')}<span class="dim"> · {t(lang, 'home4_all_systems')}</span>
        </div>
    {/if}
</div>

<style>
    .home-screen { display:flex; flex-direction:column; gap:0; height:100%; min-height:0; padding:20px 24px; overflow:auto; }
    /* command bar */
    .cbar { display:flex; align-items:center; gap:12px; background:var(--background-secondary); border:1px solid var(--background-modifier-border); border-radius:10px; padding:11px 14px; }
    .glyph { width:26px; height:26px; border-radius:7px; background:linear-gradient(135deg, var(--interactive-accent), var(--text-muted)); display:grid; place-items:center; font-weight:700; color:var(--text-on-accent); font-size:12px; flex-shrink:0; }
    .greet { color:var(--text-normal); font-weight:600; font-size:15px; }
    .date { color:var(--text-faint); font-size:12px; font-family:var(--font-monospace); }
    .sp { flex:1; }
    .status-chip { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--background-modifier-border); border-radius:9999px; padding:5px 13px; }
    .status-chip .dot { width:8px; height:8px; border-radius:50%; background:var(--text-success); animation:pulse 1.8s infinite; }
    .status-chip .dot.paused { background:var(--text-warning); animation:none; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
    .mono { font-family:var(--font-monospace); font-size:13px; color:var(--text-normal); font-variant-numeric:tabular-nums; }

    /* status line */
    .statusline { display:flex; align-items:center; gap:9px; padding:8px 4px 12px; font-family:var(--font-monospace); font-size:11px; color:var(--text-faint); }
    .statusline .ok { color:var(--text-success); }
    .statusline .run { color:var(--text-accent); }

    /* panes */
    .panes { display:grid; grid-template-columns:300px minmax(0,1fr); gap:14px; }
    .pane { background:var(--background-primary); border:1px solid var(--background-modifier-border); border-radius:12px; padding:16px; min-width:0; }

    /* timer pane */
    .timer { text-align:center; padding:16px 0 8px; }
    .timer .t { font-family:var(--font-monospace); font-size:40px; color:var(--text-normal); font-weight:400; font-variant-numeric:tabular-nums; line-height:1.1; }
    .timer .what { color:var(--text-muted); font-size:12.5px; margin-top:4px; }
    .btns { display:flex; gap:8px; justify-content:center; margin-top:16px; flex-wrap:wrap; }
    .btns button { font-family:var(--font-monospace); font-size:12px; background:var(--background-secondary); color:var(--text-normal); border:1px solid var(--background-modifier-border); border-radius:7px; padding:7px 14px; cursor:pointer; transition:border-color .12s, color .12s; }
    .btns button:hover { border-color:var(--interactive-accent); color:var(--interactive-accent); }

    /* rings */
    .rings { display:flex; justify-content:space-around; margin-top:14px; padding-top:14px; border-top:1px solid var(--background-modifier-border); }
    .ring { text-align:center; position:relative; }
    .ring .c { width:56px; height:56px; border-radius:50%; display:grid; place-items:center; margin:0 auto 6px; }
    .ring .c .in { width:44px; height:44px; border-radius:50%; background:var(--background-primary); display:grid; place-items:center; font-family:var(--font-monospace); font-size:11px; color:var(--text-normal); }
    .ring .lbl { font-size:10px; color:var(--text-faint); font-family:var(--font-monospace); letter-spacing:0.05em; }
    .ring-start { position:absolute; top:-4px; right:-2px; width:20px; height:20px; min-height:0; padding:0; border-radius:50%; border:1px solid var(--background-modifier-border); background:var(--background-secondary); color:var(--text-muted); font-size:8px; display:grid; place-items:center; cursor:pointer; box-shadow:none; opacity:0; transition:opacity .12s; }
    .ring:hover .ring-start { opacity:1; }

    /* queues */
    .q h3 { font-family:var(--font-monospace); font-size:10.5px; color:var(--text-faint); letter-spacing:0.08em; text-transform:uppercase; margin-bottom:9px; display:flex; justify-content:space-between; align-items:baseline; }
    .q h3 span { color:var(--text-success); font-weight:400; }
    .row { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; gap:11px; align-items:center; padding:7px 9px; border-radius:7px; font-size:13px; cursor:default; }
    .row:nth-child(odd) { background:var(--background-secondary); }
    .row.empty-row { grid-template-columns:1fr; color:var(--text-faint); display:flex; }
    .row .st { font-family:var(--font-monospace); font-size:9.5px; padding:2px 7px; border-radius:4px; letter-spacing:0.04em; text-transform:uppercase; justify-self:start; }
    .st.over { background:color-mix(in srgb, var(--text-error) 15%, transparent); color:var(--text-error); }
    .st.now { background:color-mix(in srgb, var(--interactive-accent) 15%, transparent); color:var(--interactive-accent); }
    .st.ok { background:color-mix(in srgb, var(--text-success) 15%, transparent); color:var(--text-success); }
    .st.plan { background:var(--background-modifier-border); color:var(--text-muted); }
    .row .nm { color:var(--text-normal); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .row .meta { font-family:var(--font-monospace); font-size:10.5px; color:var(--text-faint); }
    .row input[type='checkbox'] { justify-self:end; }
    .row[role='button'] { cursor:pointer; }
    .row[role='button']:hover .nm { color:var(--interactive-accent); }
    .prio { font-family:var(--font-monospace); font-size:10px; color:var(--text-faint); }
    .go-btn { width:24px; height:24px; min-height:0; padding:0; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-secondary); color:var(--text-success); font-size:9px; display:grid; place-items:center; cursor:pointer; box-shadow:none; }
    .sep { height:1px; background:var(--background-modifier-border); margin:12px 0; }
    .q2 { display:grid; grid-template-columns:1fr 1fr; gap:0 24px; }

    .hint { margin-top:13px; text-align:center; font-family:var(--font-monospace); font-size:11px; color:var(--text-muted); }
    .hint b { color:var(--text-normal); font-weight:500; }
    .hint .dim { color:var(--text-faint); }
    .empty { color:var(--text-faint); font-size:12.5px; }

    @media (max-width: 860px) {
        .panes { grid-template-columns:1fr; }
        .q2 { grid-template-columns:1fr; }
        .home-screen { padding:14px 16px; }
    }
</style>