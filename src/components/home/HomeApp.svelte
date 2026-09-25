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
                    <div class="c" style={`background:conic-gradient(${['#5fc992', '#55b3ff', '#ffbc33'][i]} ${p}%, #252829 0)`}>
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

    <div class="pane tasks-pane">
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
    </div>

    <div class="q2full">
        <div class="pane">
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
        </div>
        <div class="pane">
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

    {#if summary}
        <div class="hint">
            {t(lang, 'home_summary_prefix')}: <b>{timerSecondsToday ? plugin.formatTime(timerSecondsToday) : '—'}</b> {t(lang, 'home_summary_timer')} · <b>{doneCount}</b> {t(lang, 'home_summary_tasks')}<span class="dim"> · {t(lang, 'home4_all_systems')}</span>
        </div>
    {/if}
</div>

<style>
    /* Concept 4 palette (Raycast-style near-black) — scoped to the Today screen, theme-independent */
    .home-screen {
        --hb: #07080a;          /* page background */
        --hs: #101111;          /* card surface */
        --hs2: #1b1c1e;         /* raised surface / buttons */
        --hl: #252829;          /* border */
        --hl2: #2f3031;         /* border strong */
        --ht: #f9f9f9;          /* primary text */
        --ht2: #cecece;         /* secondary text */
        --hm: #9c9c9d;          /* muted */
        --hf: #6a6b6c;          /* faint */
        --hgreen: #5fc992;
        --hblue: #55b3ff;
        --hyellow: #ffbc33;
        --hred: #ff6363;

        display:flex; flex-direction:column; gap:14px; height:100%; min-height:0;
        padding:22px 26px; overflow:auto; background:var(--hb); color:var(--ht2);
    }

    /* command bar */
    .cbar { display:flex; align-items:center; gap:12px; background:var(--hs); border:1px solid var(--hl); border-radius:10px; padding:11px 14px; }
    .glyph { width:26px; height:26px; border-radius:7px; background:linear-gradient(135deg, #ff6363, #ffbc33); display:grid; place-items:center; font-weight:700; color:#0b0b0c; font-size:12px; flex-shrink:0; }
    .greet { color:var(--ht); font-weight:600; font-size:15px; }
    .date { color:var(--hf); font-size:12px; font-family:var(--font-monospace); }
    .sp { flex:1; }
    .status-chip { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--hl); border-radius:9999px; padding:5px 13px; background:var(--hs2); }
    .status-chip .dot { width:8px; height:8px; border-radius:50%; background:var(--hgreen); animation:pulse 1.8s infinite; }
    .status-chip .dot.paused { background:var(--hyellow); animation:none; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
    .mono { font-family:var(--font-monospace); font-size:13px; color:var(--ht); font-variant-numeric:tabular-nums; }

    /* status line */
    .statusline { display:flex; align-items:center; gap:9px; padding:4px 2px 0; font-family:var(--font-monospace); font-size:11px; color:var(--hm); }
    .statusline .ok { color:var(--hgreen); }
    .statusline .run { color:var(--hblue); }

    /* panes */
    .pane { background:var(--hs); border:1px solid var(--hl); border-radius:12px; padding:16px; min-width:0; }
    .q2full { display:grid; grid-template-columns:1fr 1fr; gap:14px; }

    /* timer pane */
    .timer { text-align:center; padding:26px 0 10px; }
    .timer .t { font-family:var(--font-monospace); font-size:56px; color:var(--ht); font-weight:400; font-variant-numeric:tabular-nums; line-height:1.1; }
    .timer .what { color:var(--hm); font-size:12.5px; margin-top:4px; }
    .btns { display:flex; gap:8px; justify-content:center; margin-top:18px; flex-wrap:wrap; }
    .btns button { font-family:var(--font-monospace); font-size:12.5px; background:var(--hs2); color:var(--ht); border:1px solid var(--hl2); border-radius:7px; padding:8px 15px; cursor:pointer; transition:border-color .12s, color .12s; }
    .btns button:hover { border-color:var(--hblue); color:var(--hblue); }

    /* rings */
    .rings { display:flex; justify-content:space-around; margin-top:18px; padding-top:16px; border-top:1px solid var(--hl); }
    .ring { text-align:center; position:relative; }
    .ring .c { width:58px; height:58px; border-radius:50%; display:grid; place-items:center; margin:0 auto 7px; }
    .ring .c .in { width:46px; height:46px; border-radius:50%; background:var(--hs); display:grid; place-items:center; font-family:var(--font-monospace); font-size:11px; color:var(--ht); }
    .ring .lbl { font-size:10.5px; color:var(--hf); font-family:var(--font-monospace); letter-spacing:0.05em; text-transform:uppercase; }
    .ring-start { position:absolute; top:-4px; right:-2px; width:20px; height:20px; min-height:0; padding:0; border-radius:50%; border:1px solid var(--hl2); background:var(--hs2); color:var(--hm); font-size:8px; display:grid; place-items:center; cursor:pointer; box-shadow:none; opacity:0; transition:opacity .12s; }
    .ring:hover .ring-start { opacity:1; }
    .empty { color:var(--hf); font-size:12.5px; }

    /* queues */
    .q h3 { font-family:var(--font-monospace); font-size:10.5px; color:var(--hf); letter-spacing:0.08em; text-transform:uppercase; margin-bottom:9px; display:flex; justify-content:space-between; align-items:baseline; }
    .q h3 span { color:var(--hgreen); font-weight:400; }
    .row { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; gap:14px; align-items:center; padding:8px 11px; border-radius:7px; font-size:13.5px; cursor:default; }
    .row:nth-child(odd) { background:rgba(255,255,255,0.02); }
    .row.empty-row { grid-template-columns:1fr; color:var(--hf); display:flex; }
    .row .st { font-family:var(--font-monospace); font-size:9.5px; padding:2px 7px; border-radius:4px; letter-spacing:0.04em; text-transform:uppercase; justify-self:start; }
    .st.over { background:rgba(255,99,99,0.15); color:var(--hred); }
    .st.now { background:rgba(85,179,255,0.15); color:var(--hblue); }
    .st.ok { background:rgba(95,201,146,0.15); color:var(--hgreen); }
    .st.plan { background:rgba(255,255,255,0.05); color:var(--hm); }
    .row .nm { color:var(--ht); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .row .meta { font-family:var(--font-monospace); font-size:10.5px; color:var(--hf); }
    .row input[type='checkbox'] { justify-self:end; accent-color:var(--hgreen); }
    .row[role='button'] { cursor:pointer; }
    .row[role='button']:hover .nm { color:var(--hblue); }
    .prio { font-family:var(--font-monospace); font-size:10px; color:var(--hf); }
    .go-btn { width:24px; height:24px; min-height:0; padding:0; border-radius:6px; border:1px solid var(--hl2); background:var(--hs2); color:var(--hgreen); font-size:9px; display:grid; place-items:center; cursor:pointer; box-shadow:none; }

    /* footer */
    .hint { margin-top:2px; text-align:center; font-family:var(--font-monospace); font-size:11px; color:var(--hm); }
    .hint b { color:var(--ht); font-weight:500; }
    .hint .dim { color:var(--hf); }

    @media (max-width: 860px) {
        .q2full { grid-template-columns:1fr; }
        .home-screen { padding:14px 16px; }
    }
</style>