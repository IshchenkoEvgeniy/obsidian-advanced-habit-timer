<script lang="ts">
    import { onMount } from 'svelte';
    import { setIcon } from 'obsidian';
    import type { App, TFile } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import { t } from '../../i18n';
    import { applyManualMinutes } from '../../timer/timer-state';
    import { getHabitGoals } from '../../habits/goals';
    import { getHabitDeferredBonus, getHabitWeeklyValue } from '../../services/habit-service';
    import { readPropertyString } from '../../library/property-schema';
    import type { Frontmatter } from '../../utils/frontmatter';
    import { collectionsForHabit } from '../../library/habit-links';
    import {
        timerSeconds, timerMode, isRunning, sessionStartTime,
        selectedHabit, selectedSubTask, selectedBook, sessionNote,
        activeProjectTaskFile, activeProjectTaskName, isSingleFileTask,
        pastHistory, baseSecondsToday
    } from '../../store/TimerStore';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    export let view: any;

    const lang = plugin.settings.language;
    let musicContainer: HTMLElement;
    let hmContainer: HTMLElement;
    let manualTime = 15;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    const _keepStores = [
        timerSeconds, timerMode, isRunning, sessionStartTime,
        selectedHabit, selectedSubTask, selectedBook, sessionNote,
        activeProjectTaskFile, activeProjectTaskName, isSingleFileTask,
        pastHistory, baseSecondsToday, t
    ];

    $: currentHabit = plugin.settings.properties.find(property => property.name === $selectedHabit) || plugin.settings.properties[0];
    $: type = currentHabit?.type || 'timer';
    $: sessionLocked = $sessionStartTime !== null;

    let projectSubtasks: string[] = [];
    $: {
        const taskFile = $activeProjectTaskFile;
        if (taskFile && app) {
            app.vault.cachedRead(taskFile).then(content => {
                const cache = app.metadataCache.getFileCache(taskFile);
                if (cache?.listItems) {
                    const lines = content.split('\n');
                    projectSubtasks = cache.listItems
                        .filter(item => item.task !== undefined)
                        .map(item => lines[item.position.start.line]?.replace(/^[\s]*[-*+]\s+\[.\]\s*/, '').trim() || '')
                        .filter(Boolean);
                } else {
                    projectSubtasks = [];
                }
            });
        } else {
            projectSubtasks = [];
        }
    }

    $: subtasks = $activeProjectTaskFile ? projectSubtasks : (currentHabit?.subTasks || []);

    let availableBooks: TFile[] = [];
    $: {
        if ($selectedHabit && type === 'timer') {
            const configuredCollections = collectionsForHabit(plugin.settings, currentHabit);
            if (configuredCollections.length) {
                availableBooks = app.vault.getMarkdownFiles().filter(file => {
                    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
                    if (!frontmatter) return false;
                    const fm = frontmatter as Frontmatter;
                    const fmType = readPropertyString(fm, plugin.settings, 'libraryType') || readPropertyString(fm, plugin.settings, 'format');
                    const fmStatus = readPropertyString(fm, plugin.settings, 'status');
                    return configuredCollections.some(collection => {
                        const matchesCollection = fmType.toLowerCase() === collection.id.toLowerCase()
                            || Boolean(collection.folder && file.path.startsWith(collection.folder + '/'));
                        return matchesCollection && fmStatus === collection.readingStatusName;
                    });
                });
            } else {
                availableBooks = [];
            }
        }
    }

    $: isPomodoro = $timerMode === 'pm';
    $: maxSeconds = isPomodoro ? plugin.settings.pomodoroDuration * 60 : 3600;
    $: progress = isPomodoro ? $timerSeconds / maxSeconds : ($timerSeconds % maxSeconds) / maxSeconds;
    $: dashOffset = 282.74 - 282.74 * progress;
    $: sessionElapsed = isPomodoro ? Math.max(0, maxSeconds - $timerSeconds) : $timerSeconds;
    $: todayTotal = $baseSecondsToday + sessionElapsed;
    $: todayDate = window.moment().format('YYYY-MM-DD');
    $: deferredBonus = currentHabit ? getHabitDeferredBonus(app, plugin.settings.dailyNotesFolder, currentHabit, todayDate) : 0;
    $: flexibleGoals = currentHabit ? getHabitGoals(currentHabit, todayDate, deferredBonus) : { minimum: 1, desired: 1, mode: 'daily' as const, progressionLevel: 0 };
    $: savedWeekTotal = currentHabit && flexibleGoals.mode === 'weekly'
        ? getHabitWeeklyValue(app, plugin.settings.dailyNotesFolder, currentHabit, todayDate)
        : 0;
    $: periodTotal = flexibleGoals.mode === 'weekly' ? savedWeekTotal + sessionElapsed : todayTotal;
    $: todayPercent = Math.min(100, Math.round(periodTotal / Math.max(1, flexibleGoals.desired) * 100));

    onMount(() => {
        if (musicContainer && view.musicPlayer) {
            musicContainer.empty();
            view.musicPlayer.render(musicContainer);
        }
    });

    $: {
        if (hmContainer && $pastHistory && $baseSecondsToday !== undefined) {
            view.lastHeatmapKey = '';
            view.renderHeatmap(hmContainer);
        }
    }

    function formatTime(seconds: number): string {
        return plugin.formatTime(seconds);
    }

    async function addManualTime(): Promise<void> {
        if (manualTime <= 0) return;
        if (!$sessionStartTime) {
            sessionStartTime.set(window.moment().subtract(manualTime, 'minutes').format('HH:mm'));
        }
        timerSeconds.update(seconds => applyManualMinutes(seconds, manualTime, $timerMode));
        await view.engine.syncSnapshot();
    }

    async function setMode(mode: 'timer' | 'pm'): Promise<void> {
        if (sessionLocked || $timerMode === mode) return;
        timerMode.set(mode);
        await view.engine.reset();
    }
</script>

<div class="timer-dashboard">
    <header class="timer-toolbar">
        <div class="target-control">
            <label for="habit-select">{t(lang, 'target_label') || 'Target'}</label>
            <select id="habit-select" bind:value={$selectedHabit} on:change={() => view.refresh()} disabled={sessionLocked}>
                {#each plugin.settings.properties as property}
                    <option value={property.name}>{property.name}</option>
                {/each}
            </select>
        </div>
        <div class="mode-control">
            <span class="control-label">{lang === 'ru' ? 'Режим' : 'Mode'}</span>
            <div class="mode-segment">
                <button class:active={$timerMode === 'timer'} disabled={sessionLocked} on:click={() => setMode('timer')}>{t(lang, 'stopwatch') || 'Stopwatch'}</button>
                <button class:active={$timerMode === 'pm'} disabled={sessionLocked} on:click={() => setMode('pm')}>{t(lang, 'pomodoro') || 'Pomodoro'}</button>
            </div>
        </div>
    </header>

    {#if $activeProjectTaskName}
        <div class="active-project-task">
            <span use:icon={'list-checks'}></span>
            <span>{$activeProjectTaskName}</span>
            <button disabled={sessionLocked} on:click={() => { $activeProjectTaskFile = null; $activeProjectTaskName = null; $isSingleFileTask = false; }} aria-label={lang === 'ru' ? 'Убрать задачу' : 'Clear task'}><span use:icon={'x'}></span></button>
        </div>
    {/if}

    {#if type === 'timer'}
        <section class:is-running={$isRunning} class="focus-panel">
            <div class="timer-stage">
                <div class="session-status">
                    <span class:running={$isRunning} class:paused={!$isRunning && sessionLocked} class="status-dot"></span>
                    <span>{$isRunning ? (lang === 'ru' ? 'Идёт сессия' : 'Session running') : sessionLocked ? (lang === 'ru' ? 'На паузе' : 'Paused') : (lang === 'ru' ? 'Готов к запуску' : 'Ready')}</span>
                </div>

                <div class="timer-circle-container">
                    <svg class="timer-svg" viewBox="0 0 100 100" aria-hidden="true">
                        <circle class="timer-bg" cx="50" cy="50" r="45" />
                        <circle class="timer-progress" cx="50" cy="50" r="45" stroke-dasharray="282.74" stroke-dashoffset={dashOffset} />
                    </svg>
                    <div class="timer-text-container">
                        <div class="timer-text">{formatTime($timerSeconds)}</div>
                        <div class="timer-mode-label">{isPomodoro ? (t(lang, 'pomodoro') || 'Pomodoro') : (t(lang, 'stopwatch') || 'Stopwatch')}</div>
                    </div>
                </div>

                <div class="timer-controls-row">
                    {#if !$isRunning}
                        <button class="primary-action" on:click={() => view.engine.start()}><span use:icon={'play'}></span>{t(lang, 'start') || 'Start'}</button>
                    {:else}
                        <button class="primary-action pause-action" on:click={() => view.engine.pause()}><span use:icon={'pause'}></span>{t(lang, 'pause') || 'Pause'}</button>
                    {/if}
                    <button class="secondary-action" on:click={() => view.engine.reset()}><span use:icon={'rotate-ccw'}></span>{t(lang, 'clear') || 'Clear'}</button>
                </div>

                <div class="today-progress">
                    <div><span>{flexibleGoals.mode === 'weekly' ? (lang === 'ru' ? 'Эта неделя' : 'This week') : (lang === 'ru' ? 'Сегодня' : 'Today')}</span><strong>{formatTime(periodTotal)} / {formatTime(flexibleGoals.desired)}</strong></div>
                    <div class="today-track"><span style:width={`${todayPercent}%`}></span>{#if flexibleGoals.minimum < flexibleGoals.desired}<i style:left={`${flexibleGoals.minimum / flexibleGoals.desired * 100}%`}></i>{/if}</div>
                    {#if flexibleGoals.minimum < flexibleGoals.desired}<small>{lang === 'ru' ? 'Минимум' : 'Minimum'}: {formatTime(flexibleGoals.minimum)}</small>{/if}
                </div>
            </div>

            <div class="session-panel">
                <div class="panel-heading">
                    <div><span class="eyebrow">{lang === 'ru' ? 'Текущая сессия' : 'Current session'}</span><h3>{currentHabit?.name || $selectedHabit}</h3></div>
                    <span class="mode-badge">{isPomodoro ? `${plugin.settings.pomodoroDuration} min` : (lang === 'ru' ? 'Свободный режим' : 'Open timer')}</span>
                </div>

                <div class="field-grid">
                    {#if subtasks.length > 0}
                        <div class="field-group">
                            <label for="subtask-select">{t(lang, 'select_subtask') || 'Subtask'}</label>
                            <select id="subtask-select" bind:value={$selectedSubTask} disabled={sessionLocked}>
                                <option value="">{lang === 'ru' ? 'Без подзадачи' : 'No subtask'}</option>
                                {#each subtasks as subtask}<option value={subtask}>{subtask}</option>{/each}
                            </select>
                        </div>
                    {/if}
                    {#if availableBooks.length > 0}
                        <div class="field-group">
                            <label for="book-select">{lang === 'ru' ? 'Медиа' : 'Media'}</label>
                            <select id="book-select" bind:value={$selectedBook} disabled={sessionLocked}>
                                <option value="">{lang === 'ru' ? 'Без медиа' : 'No media'}</option>
                                {#each availableBooks as book}<option value={book.path}>{book.basename}</option>{/each}
                            </select>
                        </div>
                    {/if}
                </div>

                <div class="manual-time-row">
                    <div><label for="manual-time-input">{t(lang, 'manual_add') || 'Manual Time'}</label><span>{lang === 'ru' ? 'минуты' : 'minutes'}</span></div>
                    <input id="manual-time-input" type="number" bind:value={manualTime} min="1" />
                    <button title={t(lang, 'add_time') || 'Add'} on:click={addManualTime}><span use:icon={'plus'}></span><span>{t(lang, 'add_time') || 'Add'}</span></button>
                </div>

                <div class="note-group">
                    <label for="session-note">{lang === 'ru' ? 'Заметка к сессии' : 'Session note'}</label>
                    <input id="session-note" type="text" placeholder={t(lang, 'session_note_placeholder') || 'Note'} bind:value={$sessionNote} />
                </div>

                <button class="save-action" on:click={() => view.save()}><span use:icon={'save'}></span>{t(lang, 'save_log_btn') || 'Save'}</button>
            </div>
        </section>

        <details class="music-section">
            <summary><span use:icon={'music-2'}></span><span>{t(lang, 'music_player_label') || 'Music'}</span><span class="summary-chevron" use:icon={'chevron-down'}></span></summary>
            <div class="music-mount" bind:this={musicContainer}></div>
        </details>

        <section class="heatmap-section">
            <div class="heatmap-grid-timer-v2" bind:this={hmContainer}></div>
        </section>
    {:else}
        <div class="info-panel">Please switch to the <b>Habits</b> tab to log Counters and Checklists.</div>
    {/if}
</div>

<style>
    .timer-dashboard { display:flex; flex-direction:column; gap:12px; max-width:1180px; margin:0 auto; padding:8px 12px 24px; }
    .timer-toolbar { display:grid; grid-template-columns:minmax(240px,1fr) auto; gap:16px; align-items:end; padding:12px 0; border-bottom:1px solid var(--background-modifier-border); }
    .target-control,.mode-control,.field-group,.note-group { display:flex; flex-direction:column; gap:6px; min-width:0; }
    .timer-toolbar label,.control-label,.field-group label,.note-group label,.manual-time-row label { color:var(--text-muted); font-size:.72rem; font-weight:700; text-transform:uppercase; }
    .timer-dashboard select,.timer-dashboard input[type="text"],.timer-dashboard input[type="number"] { height:36px !important; min-height:36px !important; margin:0 !important; padding:0 10px !important; border-radius:5px !important; }
    .today-track { position:relative; }
    .today-track i { position:absolute; top:-2px; bottom:-2px; width:2px; background:var(--text-normal); opacity:.7; }
    .today-progress small { color:var(--text-muted); font-size:.68rem; }
    .mode-segment { display:grid; grid-template-columns:1fr 1fr; gap:2px; padding:2px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-secondary); }
    .mode-segment button { min-width:110px; height:30px; margin:0 !important; padding:0 12px !important; border-radius:4px !important; box-shadow:none !important; background:transparent !important; }
    .mode-segment button.active { background:var(--interactive-accent) !important; color:var(--text-on-accent) !important; }
    .active-project-task { display:grid; grid-template-columns:16px minmax(0,1fr) 28px; align-items:center; gap:8px; padding:8px 10px; border-left:3px solid var(--interactive-accent); background:var(--background-secondary); color:var(--text-normal); }
    .active-project-task > span:first-child,.active-project-task button span { width:15px; height:15px; }
    .active-project-task button { width:28px; height:28px; margin:0 !important; padding:6px !important; border-radius:4px !important; }
    .focus-panel { display:grid; grid-template-columns:minmax(320px,1.05fr) minmax(300px,.95fr); min-height:430px; overflow:hidden; border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-primary-alt); }
    .focus-panel.is-running { border-color:rgba(var(--color-accent-rgb),.55); }
    .timer-stage { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; border-right:1px solid var(--background-modifier-border); }
    .session-status { display:flex; align-items:center; gap:7px; color:var(--text-muted); font-size:.78rem; }
    .status-dot { width:7px; height:7px; border-radius:50%; background:var(--text-faint); }
    .status-dot.running { background:var(--color-green); }
    .status-dot.paused { background:var(--color-orange); }
    .timer-circle-container { position:relative; width:230px; height:230px; margin:14px auto; flex:none; }
    .timer-svg { width:100%; height:100%; transform:rotate(-90deg); }
    .timer-bg { fill:var(--background-primary); stroke:var(--background-modifier-border); stroke-width:2.5; }
    .timer-progress { fill:none; stroke:var(--interactive-accent); stroke-width:4; stroke-linecap:round; transition:stroke-dashoffset 1s linear; }
    .timer-text-container { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; }
    .timer-text { color:var(--text-normal); font-family:var(--font-monospace); font-size:2.35rem; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:0; }
    .timer-mode-label { color:var(--text-muted); font-size:.7rem; text-transform:uppercase; }
    .timer-controls-row { display:flex; gap:8px; justify-content:center; }
    .timer-controls-row button,.save-action,.manual-time-row button { display:flex !important; align-items:center; justify-content:center; gap:7px; height:36px; margin:0 !important; padding:0 14px !important; border-radius:5px !important; }
    .timer-controls-row button span,.save-action span,.manual-time-row button span:first-child { width:16px; height:16px; }
    .primary-action,.save-action { background:var(--interactive-accent) !important; color:var(--text-on-accent) !important; }
    .pause-action { background:var(--color-orange) !important; color:#181818 !important; }
    .secondary-action { background:var(--background-modifier-form-field) !important; }
    .today-progress { width:min(100%,310px); margin-top:18px; }
    .today-progress > div:first-child { display:flex; justify-content:space-between; gap:12px; margin-bottom:6px; color:var(--text-muted); font-size:.72rem; }
    .today-progress strong { color:var(--text-normal); font-weight:600; }
    .today-track { height:4px; overflow:hidden; border-radius:2px; background:var(--background-modifier-border); }
    .today-track span { display:block; height:100%; background:var(--color-green); }
    .session-panel { display:flex; flex-direction:column; gap:18px; padding:24px; }
    .panel-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding-bottom:14px; border-bottom:1px solid var(--background-modifier-border); }
    .eyebrow { color:var(--text-muted); font-size:.68rem; text-transform:uppercase; }
    .panel-heading h3 { margin:4px 0 0; font-size:1.05rem; overflow-wrap:anywhere; }
    .mode-badge { flex:none; padding:4px 7px; border-radius:4px; background:var(--background-secondary); color:var(--text-muted); font-size:.68rem; }
    .field-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .field-grid > :only-child { grid-column:1 / -1; }
    .manual-time-row { display:grid; grid-template-columns:minmax(120px,1fr) 72px auto; align-items:end; gap:8px; padding:12px 0; border-top:1px solid var(--background-modifier-border); border-bottom:1px solid var(--background-modifier-border); }
    .manual-time-row > div { display:flex; flex-direction:column; gap:3px; }
    .manual-time-row > div span { color:var(--text-faint); font-size:.7rem; }
    .manual-time-row input { width:72px !important; text-align:center; }
    .note-group { margin-top:auto; }
    .save-action { width:100%; }
    .music-section,.heatmap-section { border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-primary-alt); }
    .music-section summary { display:grid; grid-template-columns:18px minmax(0,1fr) 16px; align-items:center; gap:8px; padding:12px 14px; cursor:pointer; color:var(--text-normal); font-weight:600; list-style:none; }
    .music-section summary::-webkit-details-marker { display:none; }
    .music-section summary > span:first-child,.summary-chevron { width:16px; height:16px; color:var(--text-muted); }
    .music-section[open] .summary-chevron { transform:rotate(180deg); }
    .music-mount { padding:0 12px 12px; }
    .music-mount :global(.tui-label) { display:none; }
    .music-mount :global(.music-player-container) { margin:0; padding:0; border:0; border-radius:0; box-shadow:none; background:transparent; }
    .heatmap-section { padding:12px; }
    .info-panel { padding:24px; border:1px solid var(--background-modifier-border); border-radius:8px; background:var(--background-secondary); }
    @media (max-width:760px) {
        .timer-toolbar { grid-template-columns:1fr; align-items:stretch; }
        .mode-segment button { min-width:0; }
        .focus-panel { grid-template-columns:1fr; }
        .timer-stage { border-right:0; border-bottom:1px solid var(--background-modifier-border); }
        .session-panel { padding:18px; }
    }
    @media (max-width:430px) {
        .timer-dashboard { padding:6px; }
        .timer-circle-container { width:200px; height:200px; }
        .timer-text { font-size:2rem; }
        .field-grid { grid-template-columns:1fr; }
        .manual-time-row { grid-template-columns:1fr 68px 40px; }
        .manual-time-row button > span:last-child { display:none; }
    }
</style>
