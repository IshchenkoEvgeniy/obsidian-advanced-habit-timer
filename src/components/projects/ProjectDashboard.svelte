<script lang="ts">
    import { setIcon } from 'obsidian';
    import type { Action } from 'svelte/action';
    import type HabitTimerPlugin from '../../main';
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
    function priorityLabel(value: string): string {
        const labels: Record<string, { ru: string; en: string }> = {
            high: { ru: 'Высокий', en: 'High' }, medium: { ru: 'Средний', en: 'Medium' },
            low: { ru: 'Низкий', en: 'Low' }, none: { ru: 'Без приоритета', en: 'No priority' }
        };
        return labels[value]?.[lang] || value;
    }
    function riskLabel(task: ProjectTask): string {
        const reasons: string[] = [];
        if (task.endDate && task.endDate.slice(0, 10) < today) reasons.push(lang === 'ru' ? 'просрочено' : 'overdue');
        if (task.timeEstimatedSec && task.timeSpentSec > task.timeEstimatedSec) reasons.push(lang === 'ru' ? 'оценка превышена' : 'over estimate');
        return reasons.join(' · ');
    }
</script>

<header class="dashboard-header">
    <div>
        <p>{lang === 'ru' ? 'Проект' : 'Project'}</p>
        <h2>{scope.name}</h2>
    </div>
    <div class="completion">
        <strong>{metrics.completionPercent}%</strong>
        <span>{metrics.done}/{metrics.total}</span>
    </div>
</header>

<section class="metric-strip">
    <div><span>{lang === 'ru' ? 'Открыто' : 'Open'}</span><strong>{metrics.open}</strong></div>
    <div class:alert={metrics.overdue > 0}><span>{lang === 'ru' ? 'Просрочено' : 'Overdue'}</span><strong>{metrics.overdue}</strong></div>
    <div><span>{lang === 'ru' ? 'Срок ≤ 7 дней' : 'Due ≤ 7 days'}</span><strong>{metrics.dueSoon}</strong></div>
    <div><span>{lang === 'ru' ? 'Без срока' : 'No due date'}</span><strong>{metrics.withoutDueDate}</strong></div>
    <div><span>{lang === 'ru' ? 'Без оценки' : 'No estimate'}</span><strong>{metrics.withoutEstimate}</strong></div>
    <div><span>{lang === 'ru' ? 'Потрачено' : 'Spent'}</span><strong>{plugin.formatTime(metrics.totalSpentSec)}</strong></div>
</section>

<div class="dashboard-grid">
    <section class="dashboard-section">
        <header><h3>{lang === 'ru' ? 'Статусы' : 'Statuses'}</h3><span>{metrics.total}</span></header>
        <div class="distribution">
            {#each metrics.statusDistribution as item}
                <div class="distribution-row">
                    <div><span>{item.name}</span><b>{item.count}</b></div>
                    <div class="track"><span style:width={`${item.percent}%`}></span></div>
                </div>
            {/each}
        </div>
    </section>

    <section class="dashboard-section">
        <header><h3>{lang === 'ru' ? 'Оценка времени' : 'Time estimate'}</h3><span>{metrics.estimateCoveragePercent}%</span></header>
        <div class="time-comparison">
            <div><span>{lang === 'ru' ? 'Оценено' : 'Estimated'}</span><strong>{plugin.formatTime(metrics.totalEstimatedSec)}</strong></div>
            <div><span>{lang === 'ru' ? 'Потрачено' : 'Spent'}</span><strong>{plugin.formatTime(metrics.totalSpentSec)}</strong></div>
            <div class:alert={metrics.timeUtilizationPercent > 100}><span>{lang === 'ru' ? 'Использовано' : 'Used'}</span><strong>{metrics.timeUtilizationPercent}%</strong></div>
        </div>
        <div class="estimate-track"><span class:over={metrics.timeUtilizationPercent > 100} style:width={`${Math.min(100, metrics.timeUtilizationPercent)}%`}></span></div>
    </section>

    <section class="dashboard-section wide">
        <header><h3>{lang === 'ru' ? 'Ближайшие сроки' : 'Upcoming deadlines'}</h3><span>{lang === 'ru' ? '6 недель' : '6 weeks'}</span></header>
        <div class="deadline-chart">
            {#each metrics.deadlineBuckets as bucket}
                <div class="deadline-column">
                    <div class="bar-slot"><span style:height={`${bucket.count / maxDeadline * 100}%`}></span></div>
                    <strong>{bucket.count}</strong>
                    <small>{bucket.start.slice(5)}</small>
                </div>
            {/each}
        </div>
    </section>

    <section class="dashboard-section">
        <header><h3>{lang === 'ru' ? 'Время по привычкам' : 'Time by habit'}</h3></header>
        <div class="habit-list">
            {#each metrics.habitTime as item}
                <div class="habit-row">
                    <div><span>{item.name || (lang === 'ru' ? 'Без привычки' : 'No habit')}</span><b>{plugin.formatTime(item.seconds)}</b></div>
                    <div class="track"><span style:width={`${item.seconds / maxHabitSeconds * 100}%`}></span></div>
                </div>
            {/each}
            {#if !metrics.habitTime.length}<p class="empty">{lang === 'ru' ? 'Нет данных' : 'No data'}</p>{/if}
        </div>
    </section>

    <section class="dashboard-section">
        <header><h3>{lang === 'ru' ? 'Приоритеты' : 'Priorities'}</h3></header>
        <div class="priority-list">
            {#each metrics.priorityDistribution as item}
                <div class="priority {item.name}"><span>{priorityLabel(item.name)}</span><strong>{item.count}</strong></div>
            {/each}
        </div>
    </section>

    <section class="dashboard-section wide risks">
        <header><h3>{lang === 'ru' ? 'Требуют внимания' : 'Needs attention'}</h3><span>{riskTasks.length}</span></header>
        {#if riskTasks.length}
            <div class="risk-list">
                {#each riskTasks.slice(0, 8) as task (task.id)}
                    <div class="risk-row">
                        <button class="risk-name" on:click={() => void plugin.app.workspace.getLeaf(false).openFile(task.file)}>{task.name}</button>
                        <span>{riskLabel(task)}</span>
                        <b>{task.endDate || '—'}</b>
                        <button title={lang === 'ru' ? 'Запустить таймер' : 'Start timer'} disabled={!task.habitName} on:click={() => void dataEngine.startTimerForTask(task, scope.sourceType === 'file')}><span use:icon={'play'}></span></button>
                    </div>
                {/each}
            </div>
        {:else}<p class="empty">{lang === 'ru' ? 'Нет проблемных задач' : 'No at-risk tasks'}</p>{/if}
    </section>
</div>

<style>
    .dashboard-header { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; padding:5px 2px 16px; }
    .dashboard-header p { margin:0 0 2px; color:var(--text-muted); font-size:.7rem; text-transform:uppercase; }
    .dashboard-header h2 { margin:0; font-size:1.55rem; }
    .completion { display:flex; align-items:baseline; gap:8px; }
    .completion strong { font-size:1.7rem; color:var(--text-accent); }
    .completion span { color:var(--text-muted); }
    .metric-strip { display:grid; grid-template-columns:repeat(6,minmax(105px,1fr)); margin-bottom:20px; border-block:1px solid var(--background-modifier-border); }
    .metric-strip div { display:flex; flex-direction:column; gap:5px; padding:12px; border-right:1px solid var(--background-modifier-border); }
    .metric-strip div:last-child { border-right:0; }
    .metric-strip span,.time-comparison span { color:var(--text-muted); font-size:.72rem; }
    .metric-strip strong { font-size:1.15rem; }
    .alert strong { color:var(--text-error); }
    .dashboard-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:22px 28px; }
    .dashboard-section { min-width:0; padding-top:10px; border-top:1px solid var(--background-modifier-border); }
    .dashboard-section.wide { grid-column:1/-1; }
    .dashboard-section>header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:13px; }
    .dashboard-section h3 { margin:0; font-size:.95rem; }
    .dashboard-section>header>span { color:var(--text-muted); font-size:.75rem; }
    .distribution,.habit-list { display:flex; flex-direction:column; gap:9px; }
    .distribution-row>div:first-child,.habit-row>div:first-child { display:flex; justify-content:space-between; gap:10px; margin-bottom:3px; font-size:.78rem; }
    .track,.estimate-track { height:5px; overflow:hidden; background:var(--background-modifier-border); }
    .track span,.estimate-track span { display:block; height:100%; background:var(--interactive-accent); }
    .estimate-track span.over { background:var(--text-error); }
    .time-comparison { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:12px; }
    .time-comparison div { display:flex; flex-direction:column; gap:3px; }
    .deadline-chart { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; height:150px; }
    .deadline-column { display:grid; grid-template-rows:1fr auto auto; gap:3px; text-align:center; }
    .bar-slot { position:relative; min-height:80px; background:var(--background-secondary); }
    .bar-slot span { position:absolute; right:0; bottom:0; left:0; min-height:2px; background:var(--interactive-accent); }
    .deadline-column strong { font-size:.8rem; }
    .deadline-column small { color:var(--text-muted); font-size:.65rem; }
    .priority-list { display:grid; grid-template-columns:repeat(2,1fr); gap:7px; }
    .priority { display:flex; justify-content:space-between; padding:7px 9px; border-left:3px solid var(--background-modifier-border); background:var(--background-secondary); font-size:.78rem; }
    .priority.high { border-left-color:var(--text-error); }.priority.medium { border-left-color:var(--text-warning); }.priority.low { border-left-color:var(--text-success); }
    .risk-list { border-top:1px solid var(--background-modifier-border); }
    .risk-row { display:grid; grid-template-columns:minmax(180px,1fr) minmax(130px,.7fr) 100px 30px; align-items:center; gap:10px; min-height:38px; border-bottom:1px solid var(--background-modifier-border); font-size:.76rem; }
    .risk-name { height:auto; padding:0; overflow:hidden; border:0; box-shadow:none; background:transparent; color:var(--text-normal); text-align:left; text-overflow:ellipsis; white-space:nowrap; }
    .risk-row>span { color:var(--text-error); }.risk-row>b { font-family:var(--font-monospace); font-weight:400; }
    .risk-row>button:last-child { width:27px; height:27px; padding:5px; }.risk-row>button:last-child span { display:block; width:15px; height:15px; }
    .empty { margin:0; padding:18px 0; color:var(--text-muted); text-align:center; }
    @media (max-width:720px) {
        .metric-strip { grid-template-columns:repeat(3,1fr); }
        .metric-strip div:nth-child(3) { border-right:0; }
        .dashboard-grid { grid-template-columns:1fr; }.dashboard-section.wide { grid-column:auto; }
        .risk-row { grid-template-columns:minmax(140px,1fr) 28px; }.risk-row>span,.risk-row>b { display:none; }
    }
</style>
