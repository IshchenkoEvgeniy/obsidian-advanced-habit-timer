<script lang="ts">
    import { setIcon } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import { t } from '../../i18n';
    import { TaskEditorModal } from '../../projects/modals/task-editor';
    import type { ProjectDataEngine } from '../../projects/project-data';
    import { projectTaskToData } from '../../projects/task-data';
    import { buildTimeline, type TimelineItem, type TimelineTaskInput } from '../../projects/timeline';
    import type { ProjectScopeDefinition, ProjectTask } from '../../projects/types';
    import type { ViewContext } from '../../projects/views/base-view';

    export let plugin: HabitTimerPlugin;
    export let dataEngine: ProjectDataEngine;
    export let scope: ProjectScopeDefinition;
    export let ctx: ViewContext;

    const icon: Action<HTMLElement, string> = (node, name) => {
        setIcon(node, name);
        return { update(next) { setIcon(node, next); } };
    };

    $: lang = plugin.settings.language;
    $: todayKey = localDateKey(new Date());
    $: model = buildTimeline(ctx.filteredTasks as TimelineTaskInput[], ctx.columns, todayKey);
    $: monthFormatter = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    $: dayFormatter = new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    $: hasDated = model.bars.length > 0 || model.milestones.length > 0;

    function localDateKey(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function monthLabel(id: string): string {
        const [year, month] = id.split('-').map(Number);
        return monthFormatter.format(new Date(Date.UTC(year, (month ?? 1) - 1, 1)));
    }
    function dateLabel(key: string): string {
        return dayFormatter.format(new Date(`${key}T12:00:00Z`));
    }
    function taskColor(task: ProjectTask): string {
        if (task.color) return task.color;
        let hash = 0;
        const source = task.habitName || task.status;
        for (let index = 0; index < source.length; index++) hash = source.charCodeAt(index) + ((hash << 5) - hash);
        return `hsl(${Math.abs(hash) % 360}, 55%, 48%)`;
    }
    function barStyle(item: TimelineItem): string {
        const color = item.done ? 'var(--text-success)' : item.overdue ? 'var(--text-error)' : taskColor(item.task as ProjectTask);
        return `left:${item.offsetPct}%;width:${Math.max(item.widthPct, 1.5)}%;background:${color}`;
    }
    function tooltip(item: TimelineItem): string {
        const parts = [item.task.name, item.task.status];
        if (item.task.priority) parts.push(item.task.priority.toUpperCase());
        if (item.kind === 'bar') parts.push(`${item.actualStart} → ${item.actualEnd}`);
        else parts.push(dateLabel(item.actualEnd));
        if (item.overdue) parts.push(t(lang, 'timeline_overdue'));
        if (item.clampedStart || item.clampedEnd) parts.push('…');
        return parts.join(' · ');
    }
    function editTask(task: ProjectTask): void {
        const initial = projectTaskToData(task, seconds => plugin.formatTime(seconds));
        new TaskEditorModal(plugin.app, plugin, initial, ctx.columns, true, async data => {
            await dataEngine.saveTask(task.file, data, scope.sourceType === 'file', task.name, ctx.columns, task.blockId);
            ctx.onRefresh();
        }).open();
    }
    function createTask(): void {
        new TaskEditorModal(plugin.app, plugin, { startDate: todayKey }, ctx.columns, false, async data => {
            await dataEngine.createTask(scope, data);
            ctx.onRefresh();
        }).open();
    }
</script>

<div class="tl">
    <div class="tl-toolbar">
        <div class="tl-legend" aria-hidden="true">
            <span class="legend-item"><i class="legend-bar"></i>{t(lang, 'timeline_legend_bar')}</span>
            <span class="legend-item"><i class="legend-milestone"></i>{t(lang, 'timeline_legend_milestone')}</span>
            <span class="legend-item"><i class="legend-bar overdue"></i>{t(lang, 'timeline_overdue')}</span>
        </div>
        <span class="tl-range">{dateLabel(model.start)} — {dateLabel(model.end)}</span>
    </div>

    {#if hasDated}
        <div class="tl-track">
            <div class="tl-header">
                <div class="tl-months">
                    {#each model.months as month (month.id)}
                        <div class="tl-month" style={`width:${month.widthPct}%`}>{monthLabel(month.id)}</div>
                    {/each}
                </div>
                <div class="tl-weeks">
                    {#each model.months as month (month.id)}
                        {#each month.weeks as week (week.id)}
                            <div class="tl-week" style={`width:${week.widthPct}%`}>{dateLabel(week.start)}</div>
                        {/each}
                    {/each}
                </div>
            </div>

            <div class="tl-body">
                {#if model.todayPct !== null}
                    <div class="tl-today" style={`left:${model.todayPct}%`} title={t(lang, 'today')}><span>{t(lang, 'today')}</span></div>
                {/if}
                {#each model.months as month, index (month.id)}
                    {#if index > 0}<div class="tl-gridline" style={`left:${month.offsetPct}%`}></div>{/if}
                {/each}

                {#each model.bars as item (item.task.id)}
                    <div class="tl-row">
                        <button
                            class="tl-bar"
                            class:done={item.done}
                            class:overdue={item.overdue}
                            class:narrow={item.widthPct < 16}
                            style={barStyle(item)}
                            title={tooltip(item)}
                            aria-label={t(lang, 'edit_task')}
                            on:click={() => editTask(item.task as ProjectTask)}
                        >
                            <span class="bar-name">{item.task.name}</span>
                            {#if item.progressPct > 0}<span class="bar-progress"><span style={`width:${item.progressPct}%`}></span></span>{/if}
                        </button>
                        {#if item.widthPct < 16}
                            <span class="bar-outside" class:overdue-text={item.overdue} style={`left:calc(${item.offsetPct}% + ${Math.max(item.widthPct, 1.5)}% + 8px)`}>{item.task.name}</span>
                        {/if}
                    </div>
                {/each}

                {#if model.milestones.length}
                    <div class="tl-section"><i use:icon={'flag'}></i>{t(lang, 'timeline_milestones_section')}</div>
                    {#each model.milestones as item (item.task.id)}
                        <div class="tl-row">
                            <button
                                class="tl-milestone"
                                class:done={item.done}
                                class:overdue={item.overdue}
                                style={`left:${item.offsetPct}%;--milestone-color:${item.done ? 'var(--text-success)' : item.overdue ? 'var(--text-error)' : taskColor(item.task as ProjectTask)}`}
                                title={tooltip(item)}
                                aria-label={t(lang, 'edit_task')}
                                on:click={() => editTask(item.task as ProjectTask)}
                            >
                                <i class="diamond"></i>
                                <span class="milestone-date">{dateLabel(item.actualEnd)}</span>
                                <span class="milestone-name">{item.task.name}</span>
                            </button>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    {:else}
        <div class="tl-empty">
            <span class="empty-icon" use:icon={'calendar-range'}></span>
            <h3>{t(lang, 'timeline_empty_title')}</h3>
            <p>{t(lang, 'timeline_empty_hint')}</p>
            <button class="empty-action" on:click={createTask}><span use:icon={'plus'}></span>{t(lang, 'add_new_task')}</button>
        </div>
    {/if}

    {#if model.noDates.length}
        <section class="tl-nodates" aria-label={t(lang, 'timeline_no_dates_group')}>
            <header>
                <span class="nodates-title"><i use:icon={'inbox'}></i>{t(lang, 'timeline_no_dates_group')}</span>
                <span class="nodates-count">{model.noDates.length}</span>
            </header>
            <div class="nodates-grid">
                {#each model.noDates as task (task.id)}
                    <button class="nodates-card" title={t(lang, 'edit_task')} on:click={() => editTask(task as ProjectTask)}>
                        <span class="nodates-name">{task.name}</span>
                        <span class="nodates-status">{task.status}</span>
                    </button>
                {/each}
            </div>
        </section>
    {/if}
</div>

<style>
    .tl { display:flex; flex-direction:column; gap:12px; height:100%; min-height:0; }
    .tl-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
    .tl-legend { display:flex; align-items:center; gap:14px; color:var(--text-muted); font-size:.72rem; }
    .legend-item { display:flex; align-items:center; gap:6px; }
    .legend-item i { display:block; width:14px; height:8px; border-radius:4px; background:var(--interactive-accent); }
    .legend-item i.legend-milestone { width:9px; height:9px; border-radius:2px; background:var(--text-accent); transform:rotate(45deg); }
    .legend-item i.legend-bar.overdue { background:var(--text-error); }
    .tl-range { color:var(--text-faint); font-size:.72rem; }

    .tl-track { min-width:640px; border:1px solid var(--background-modifier-border); border-radius:14px; background:var(--background-primary); box-shadow:0 2px 10px rgba(0,0,0,.05); overflow:hidden; }
    .tl-months,.tl-weeks { display:flex; }
    .tl-months { border-bottom:1px solid var(--background-modifier-border); background:var(--background-secondary); }
    .tl-month { min-width:0; padding:8px 12px; border-left:1px solid var(--background-modifier-border); color:var(--text-normal); font-size:.78rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-transform:capitalize; }
    .tl-month:first-child { border-left:0; }
    .tl-weeks { border-bottom:1px solid var(--background-modifier-border); }
    .tl-week { min-width:0; padding:3px 6px; border-left:1px dashed var(--background-modifier-border); color:var(--text-faint); font-size:.62rem; overflow:hidden; white-space:nowrap; }
    .tl-week:first-child { border-left:0; }

    .tl-body { position:relative; padding:14px 0 16px; }
    .tl-gridline { position:absolute; top:0; bottom:0; width:1px; background:var(--background-modifier-border); opacity:.55; }
    .tl-today { position:absolute; top:0; bottom:0; z-index:3; width:2px; margin-left:-1px; background:var(--interactive-accent); border-radius:1px; }
    .tl-today span { position:absolute; top:2px; left:4px; padding:1px 7px; border-radius:8px; background:var(--interactive-accent); color:var(--text-on-accent); font-size:.6rem; white-space:nowrap; }

    .tl-row { position:relative; height:34px; margin:0 0 6px; }
    .tl-bar { position:absolute; top:2px; z-index:2; display:flex; flex-direction:column; justify-content:center; min-width:14px; max-width:100%; height:28px; padding:0 10px; border:0; border-radius:9px; background:var(--interactive-accent); color:var(--text-on-accent); font-size:.72rem; font-weight:600; box-shadow:0 2px 6px rgba(0,0,0,.14); cursor:pointer; transition:transform .12s ease, box-shadow .12s ease; }
    .tl-bar:hover { z-index:4; transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,.2); }
    .tl-bar .bar-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tl-bar.narrow { padding:0 4px; }
    .tl-bar.done .bar-name { opacity:.92; }
    .tl-bar.overdue { box-shadow:0 0 0 2px var(--background-primary), 0 0 0 3.5px var(--text-error); }
    .bar-progress { position:absolute; right:6px; bottom:4px; left:6px; height:3px; overflow:hidden; border-radius:2px; background:rgba(255,255,255,.28); }
    .bar-progress span { display:block; height:100%; border-radius:2px; background:rgba(255,255,255,.85); }
    .bar-outside { position:absolute; top:8px; z-index:2; max-width:26%; overflow:hidden; color:var(--text-muted); font-size:.7rem; text-overflow:ellipsis; white-space:nowrap; }
    .bar-outside.overdue-text { color:var(--text-error); }

    .tl-section { display:flex; align-items:center; gap:6px; margin:14px 0 6px; padding-left:10px; color:var(--text-muted); font-size:.7rem; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
    .tl-section i { display:block; width:13px; height:13px; }

    .tl-milestone { position:absolute; top:2px; z-index:2; display:flex; align-items:center; gap:7px; height:28px; padding:0 8px; border:0; background:transparent; box-shadow:none; color:var(--text-normal); font-size:.72rem; cursor:pointer; }
    .tl-milestone:hover { background:transparent; color:var(--text-accent); }
    .tl-milestone .diamond { display:block; width:11px; height:11px; flex-shrink:0; border:2px solid var(--milestone-color); border-radius:3px; background:var(--background-primary); transform:rotate(45deg); transition:background .12s; }
    .tl-milestone:hover .diamond { background:var(--milestone-color); }
    .tl-milestone.done .diamond { background:var(--milestone-color); }
    .tl-milestone .milestone-date { color:var(--text-faint); font-family:var(--font-monospace); font-size:.64rem; }
    .tl-milestone .milestone-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tl-milestone.overdue .milestone-name { color:var(--text-error); }

    .tl-nodates { flex-shrink:0; }
    .tl-nodates header { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
    .nodates-title { display:flex; align-items:center; gap:6px; color:var(--text-muted); font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
    .nodates-title i { display:block; width:14px; height:14px; }
    .nodates-count { min-width:20px; padding:1px 7px; border-radius:9px; background:var(--background-secondary); color:var(--text-muted); font-size:.66rem; text-align:center; }
    .nodates-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:8px; }
    .nodates-card { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 12px; border:1px solid var(--background-modifier-border); border-radius:11px; background:var(--background-primary); box-shadow:0 1px 4px rgba(0,0,0,.05); color:var(--text-normal); font-size:.76rem; text-align:left; cursor:pointer; transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
    .nodates-card:hover { border-color:var(--background-modifier-border-hover); box-shadow:0 4px 12px rgba(0,0,0,.1); transform:translateY(-1px); }
    .nodates-name { overflow:hidden; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
    .nodates-status { flex-shrink:0; padding:2px 8px; border-radius:9px; background:var(--background-secondary); color:var(--text-muted); font-size:.62rem; }

    .tl-empty { display:flex; flex-direction:column; align-items:center; gap:6px; margin:auto; padding:44px 20px; border:1px dashed var(--background-modifier-border); border-radius:14px; background:var(--background-primary); text-align:center; }
    .empty-icon { margin-bottom:6px; color:var(--text-faint); }
    .empty-icon :global(svg) { width:36px; height:36px; }
    .tl-empty h3 { margin:0; color:var(--text-normal); font-size:.98rem; }
    .tl-empty p { max-width:420px; margin:0 0 10px; color:var(--text-muted); font-size:.78rem; }
    .empty-action { display:flex; align-items:center; gap:6px; padding:7px 14px; border-radius:10px; }
    .empty-action span { display:block; width:14px; height:14px; }

    @media (max-width:600px) {
        .tl-track { min-width:520px; }
        .legend-item { gap:4px; }
    }
</style>
