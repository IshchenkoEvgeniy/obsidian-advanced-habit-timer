<script lang="ts">
    import { setIcon } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
    import { t } from '../../i18n';
    import { calculateProjectDashboard } from '../../projects/dashboard-metrics';
    import type { ProjectDataEngine } from '../../projects/project-data';
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
    $: today = localDateKey(new Date());
    $: metrics = calculateProjectDashboard(ctx.filteredTasks, ctx.columns, today);
    $: riskTasks = metrics.riskTaskIds.map(id => ctx.filteredTasks.find(task => task.id === id)).filter((task): task is ProjectTask => Boolean(task));
    $: maxDeadline = Math.max(1, ...metrics.deadlineBuckets.map(bucket => bucket.count));
    $: maxHabitSeconds = Math.max(1, ...metrics.habitTime.map(item => item.seconds));

    function localDateKey(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function hashHue(value: string): number {
        let hash = 0;
        for (let index = 0; index < value.length; index++) hash = value.charCodeAt(index) + ((hash << 5) - hash);
        return Math.abs(hash) % 360;
    }
    function statusColor(name: string): string {
        const last = ctx.columns[ctx.columns.length - 1];
        return `hsl(${name === last ? 142 : hashHue(name)}, 45%, 48%)`;
    }
    function priorityLabel(value: string): string {
        const keys: Record<string, 'priority_high' | 'priority_medium' | 'priority_low' | 'priority_none'> = {
            high: 'priority_high', medium: 'priority_medium', low: 'priority_low', none: 'priority_none'
        };
        return keys[value] ? t(lang, keys[value]) : value;
    }
    function riskLabel(task: ProjectTask): string {
        const reasons: string[] = [];
        if (task.endDate && task.endDate.slice(0, 10) < today) reasons.push(t(lang, 'board_overdue').toLowerCase());
        if (task.timeEstimatedSec && task.timeSpentSec > task.timeEstimatedSec) reasons.push(t(lang, 'dashboard_over_estimate'));
        return reasons.join(' · ');
    }
</script>

{#if ctx.filteredTasks.length}
    <header class="dashboard-header">
        <div>
            <p>{t(lang, 'dashboard_project')}</p>
            <h2>{scope.name}</h2>
        </div>
        <div class="completion">
            <strong>{metrics.completionPercent}%</strong>
            <span>{metrics.done}/{metrics.total}</span>
        </div>
    </header>

    <div class="scope-progress" role="progressbar" aria-label={t(lang, 'dashboard_completion')} aria-valuenow={metrics.completionPercent} aria-valuemin="0" aria-valuemax="100">
        <span style={`width:${metrics.completionPercent}%`}></span>
    </div>

    <section class="metric-strip">
        <div class="metric-card"><span>{t(lang, 'dashboard_open')}</span><strong>{metrics.open}</strong></div>
        <div class="metric-card" class:alert={metrics.overdue > 0}><span>{t(lang, 'board_overdue')}</span><strong>{metrics.overdue}</strong></div>
        <div class="metric-card"><span>{t(lang, 'dashboard_due_soon')}</span><strong>{metrics.dueSoon}</strong></div>
        <div class="metric-card"><span>{t(lang, 'dashboard_no_due')}</span><strong>{metrics.withoutDueDate}</strong></div>
        <div class="metric-card"><span>{t(lang, 'dashboard_no_estimate')}</span><strong>{metrics.withoutEstimate}</strong></div>
        <div class="metric-card"><span>{t(lang, 'dashboard_spent')}</span><strong>{plugin.formatTime(metrics.totalSpentSec)}</strong></div>
    </section>

    <div class="dashboard-grid">
        <section class="dashboard-section">
            <header><h3>{t(lang, 'dashboard_statuses')}</h3><span>{metrics.total}</span></header>
            <div class="distribution">
                {#each metrics.statusDistribution as item}
                    <div class="distribution-row">
                        <div><span>{item.name}</span><b>{item.count}</b></div>
                        <div class="track"><span style={`width:${item.percent}%;background:${statusColor(item.name)}`}></span></div>
                    </div>
                {/each}
            </div>
        </section>

        <section class="dashboard-section">
            <header><h3>{t(lang, 'dashboard_time_estimate')}</h3><span>{metrics.estimateCoveragePercent}%</span></header>
            <div class="time-comparison">
                <div><span>{t(lang, 'dashboard_estimated')}</span><strong>{plugin.formatTime(metrics.totalEstimatedSec)}</strong></div>
                <div><span>{t(lang, 'dashboard_spent')}</span><strong>{plugin.formatTime(metrics.totalSpentSec)}</strong></div>
                <div class:alert={metrics.timeUtilizationPercent > 100}><span>{t(lang, 'dashboard_used')}</span><strong>{metrics.timeUtilizationPercent}%</strong></div>
            </div>
            <div class="estimate-track">
                <span class="track-fill" class:over={metrics.timeUtilizationPercent > 100} style={`width:${Math.min(100, metrics.timeUtilizationPercent)}%`}></span>
            </div>
            <small class="track-hint">{plugin.formatTime(metrics.totalSpentSec)} / {plugin.formatTime(metrics.totalEstimatedSec)}</small>
        </section>

        <section class="dashboard-section wide">
            <header><h3>{t(lang, 'dashboard_deadlines')}</h3><span>{t(lang, 'dashboard_six_weeks')}</span></header>
            <div class="deadline-chart">
                {#each metrics.deadlineBuckets as bucket}
                    <div class="deadline-column">
                        <div class="bar-slot"><span style={`height:${bucket.count / maxDeadline * 100}%`}></span></div>
                        <strong>{bucket.count}</strong>
                        <small>{bucket.start.slice(5)}</small>
                    </div>
                {/each}
            </div>
        </section>

        <section class="dashboard-section">
            <header><h3>{t(lang, 'dashboard_time_by_habit')}</h3></header>
            <div class="habit-list">
                {#each metrics.habitTime as item}
                    <div class="habit-row">
                        <div><span>{item.name || t(lang, 'dashboard_no_habit')}</span><b>{plugin.formatTime(item.seconds)}</b></div>
                        <div class="track"><span style={`width:${item.seconds / maxHabitSeconds * 100}%`}></span></div>
                    </div>
                {/each}
                {#if !metrics.habitTime.length}
                    <div class="section-empty"><span use:icon={'repeat-2'}></span>{t(lang, 'no_data')}</div>
                {/if}
            </div>
        </section>

        <section class="dashboard-section">
            <header><h3>{t(lang, 'dashboard_priorities')}</h3></header>
            <div class="priority-list">
                {#each metrics.priorityDistribution as item}
                    <div class="priority {item.name}"><span>{priorityLabel(item.name)}</span><strong>{item.count}</strong></div>
                {/each}
            </div>
        </section>

        <section class="dashboard-section wide risks">
            <header><h3>{t(lang, 'dashboard_attention')}</h3><span>{riskTasks.length}</span></header>
            {#if riskTasks.length}
                <div class="risk-list">
                    {#each riskTasks.slice(0, 8) as task (task.id)}
                        <div class="risk-row">
                            <button class="risk-name" on:click={() => void plugin.app.workspace.getLeaf(false).openFile(task.file)}>{task.name}</button>
                            <span>{riskLabel(task)}</span>
                            <b>{task.endDate || '—'}</b>
                            <button title={t(lang, 'board_start_timer')} aria-label={t(lang, 'board_start_timer')} disabled={!task.habitName} on:click={() => void dataEngine.startTimerForTask(task, scope.sourceType === 'file')}><span use:icon={'play'}></span></button>
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="section-empty good"><span use:icon={'check-check'}></span>{t(lang, 'dashboard_all_good')}</div>
            {/if}
        </section>
    </div>
{:else}
    <div class="dashboard-empty">
        <span class="empty-icon" use:icon={'layout-dashboard'}></span>
        <h3>{t(lang, 'no_data')}</h3>
        <p>{t(lang, 'table_empty_hint')}</p>
    </div>
{/if}

<style>
    .dashboard-header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; padding:5px 2px 12px; }
    .dashboard-header p { margin:0 0 2px; color:var(--text-muted); font-size:.7rem; text-transform:uppercase; }
    .dashboard-header h2 { margin:0; font-size:1.55rem; }
    .completion { display:flex; align-items:baseline; gap:8px; }
    .completion strong { font-size:1.7rem; color:var(--text-accent); }
    .completion span { color:var(--text-muted); }

    .scope-progress { height:8px; margin:0 2px 16px; overflow:hidden; border-radius:4px; background:var(--background-modifier-border); }
    .scope-progress span { display:block; height:100%; border-radius:4px; background:var(--interactive-accent); transition:width .3s ease; }

    .metric-strip { display:grid; grid-template-columns:repeat(6,minmax(105px,1fr)); gap:8px; margin-bottom:16px; }
    .metric-card { display:flex; flex-direction:column; gap:5px; padding:12px 14px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); }
    .metric-card span { color:var(--text-muted); font-size:.7rem; }
    .metric-card strong { font-size:1.15rem; }
    .alert strong { color:var(--text-error); }

    .dashboard-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    .dashboard-section { min-width:0; padding:14px 16px; border:1px solid var(--background-modifier-border); border-radius:var(--radius-l); background:var(--background-primary); box-shadow:var(--shadow-s); }
    .dashboard-section.wide { grid-column:1/-1; }
    .dashboard-section > header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:13px; }
    .dashboard-section h3 { margin:0; font-size:.95rem; }
    .dashboard-section > header > span { color:var(--text-muted); font-size:.75rem; }

    .distribution,.habit-list { display:flex; flex-direction:column; gap:9px; }
    .distribution-row > div:first-child,.habit-row > div:first-child { display:flex; justify-content:space-between; gap:10px; margin-bottom:3px; font-size:.78rem; }
    .track { height:6px; overflow:hidden; border-radius:3px; background:var(--background-modifier-border); }
    .track span { display:block; height:100%; border-radius:3px; background:var(--interactive-accent); }

    .time-comparison { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:12px; }
    .time-comparison div { display:flex; flex-direction:column; gap:3px; }
    .time-comparison span { color:var(--text-muted); font-size:.72rem; }
    .estimate-track { position:relative; height:8px; overflow:hidden; border-radius:4px; background:var(--background-modifier-border); }
    .track-fill { position:absolute; inset:0 auto 0 0; border-radius:4px; background:var(--interactive-accent); transition:width .3s ease; }
    .track-fill.over { background:var(--text-error); }
    .track-hint { display:block; margin-top:5px; color:var(--text-faint); font-size:.68rem; }

    .deadline-chart { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; height:150px; }
    .deadline-column { display:grid; grid-template-rows:1fr auto auto; gap:3px; text-align:center; }
    .bar-slot { position:relative; min-height:80px; border-radius:var(--radius-m); background:var(--background-secondary); }
    .bar-slot span { position:absolute; right:0; bottom:0; left:0; min-height:3px; border-radius:3px 3px 0 0; background:var(--interactive-accent); }
    .deadline-column strong { font-size:.8rem; }
    .deadline-column small { color:var(--text-muted); font-size:.65rem; }

    .priority-list { display:grid; grid-template-columns:repeat(2,1fr); gap:7px; }
    .priority { display:flex; justify-content:space-between; align-items:center; padding:8px 11px; border:1px solid var(--background-modifier-border); border-left:3px solid var(--background-modifier-border); border-radius:var(--radius-m); background:var(--background-secondary); font-size:.78rem; }
    .priority.high { border-left-color:var(--text-error); }
    .priority.medium { border-left-color:var(--text-warning); }
    .priority.low { border-left-color:var(--text-success); }

    .risk-list { border-top:1px solid var(--background-modifier-border); }
    .risk-row { display:grid; grid-template-columns:minmax(180px,1fr) minmax(130px,.7fr) 100px 30px; align-items:center; gap:10px; min-height:38px; border-bottom:1px solid var(--background-modifier-border); font-size:.76rem; }
    .risk-name { height:auto; padding:0; overflow:hidden; border:0; box-shadow:none; background:transparent; color:var(--text-normal); text-align:left; text-overflow:ellipsis; white-space:nowrap; }
    .risk-row > span { color:var(--text-error); }
    .risk-row > b { font-family:var(--font-monospace); font-weight:400; }
    .risk-row > button:last-child { width:27px; height:27px; padding:5px; }
    .risk-row > button:last-child span { display:block; width:15px; height:15px; }

    .section-empty { display:flex; align-items:center; justify-content:center; gap:7px; padding:18px 0; color:var(--text-muted); font-size:.78rem; }
    .section-empty span { display:block; width:15px; height:15px; color:var(--text-faint); }
    .section-empty.good { color:var(--text-success); }

    .dashboard-empty { display:flex; flex-direction:column; align-items:center; gap:6px; margin:10vh auto 0; max-width:380px; padding:38px 22px; border:1px dashed var(--background-modifier-border); border-radius:var(--radius-xl); background:var(--background-primary); text-align:center; }
    .empty-icon { margin-bottom:6px; color:var(--text-faint); }
    .empty-icon :global(svg) { width:34px; height:34px; }
    .dashboard-empty h3 { margin:0; color:var(--text-normal); font-size:.96rem; }
    .dashboard-empty p { margin:0; color:var(--text-muted); font-size:.78rem; }

    @media (max-width:720px) {
        .metric-strip { grid-template-columns:repeat(3,1fr); }
        .dashboard-grid { grid-template-columns:1fr; }
        .dashboard-section.wide { grid-column:auto; }
        .risk-row { grid-template-columns:minmax(140px,1fr) 28px; }
        .risk-row > span,.risk-row > b { display:none; }
    }
</style>
