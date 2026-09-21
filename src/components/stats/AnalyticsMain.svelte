<script lang="ts">
    import type { App } from 'obsidian';
    import type HabitTimerPlugin from '../../main';
    import { t } from '../../i18n';
    import { allRecords, currentPeriod, selectedStatsHabit, viewMode } from '../../store/StatsStore';
    import { formatDurationShort } from '../../utils';
    import { moment } from 'obsidian';
    import Heatmap from '../charts/Heatmap.svelte';
    import { DaySummaryModal } from '../../session-modals';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    // view is passed for external reference but not used internally
    export const view: any = undefined;

    const _keep = [t, Heatmap, allRecords, currentPeriod, selectedStatsHabit, viewMode, formatDurationShort, DaySummaryModal];
    let lang = plugin.settings.language;

    const colors = [
        "#89b4fa", "#fab387", "#a6e3a1", "#f9e2af", "#f5c2e7",
        "#94e2d5", "#cba6f7", "#eba0ac", "#f2cdcd", "#b4befe"
    ];

    const periods = [
        { id: 'day', label: 'day' },
        { id: 'week', label: 'week' },
        { id: 'month', label: 'month' },
        { id: 'all', label: 'all_time' }
    ];

    $: filteredRecords = (() => {
        const now = window.moment();
        const p = $currentPeriod;
        return $allRecords.filter(rec => {
            if (p === 'all') return true;
            const recDate = window.moment(rec.date);
            if (p === 'day') return recDate.isSame(now, 'day');
            if (p === 'week') return recDate.isSame(now, 'week');
            if (p === 'month') return recDate.isSame(now, 'month');
            return true;
        });
    })();

    // Calculate score
    $: score = (() => {
        if (filteredRecords.length === 0) return 0;
        const byDate: Record<string, any[]> = {};
        filteredRecords.forEach(r => {
            if (!byDate[r.date]) byDate[r.date] = [];
            byDate[r.date].push(r);
        });
        let scores: number[] = [];
        Object.values(byDate).forEach(dayRecs => {
            let completed = 0;
            plugin.settings.properties.forEach(prop => {
                const rec = dayRecs.find(r => r.habit === prop.name);
                if (rec?.state === 'completed') completed++;
                else if (rec?.state === 'partial') completed += 0.5;
                else if (rec?.state === 'excused' || rec?.state === 'deferred') completed++;
            });
            scores.push((completed / Math.max(plugin.settings.properties.length, 1)) * 100);
        });
        return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    })();

    // Donut chart data
    $: donutData = (() => {
        const timerRecords = filteredRecords.filter(r => r.type === 'timer');
        const habitTotals: Record<string, number> = {};
        timerRecords.forEach(r => habitTotals[r.habit] = (habitTotals[r.habit] || 0) + r.durationSec);
        
        const sorted = Object.entries(habitTotals).sort((a, b) => b[1] - a[1]);
        return sorted.map(([habit, sec], i) => {
            const hIndex = plugin.settings.properties.findIndex(p => p.name === habit);
            return {
                label: habit,
                value: sec,
                color: colors[hIndex % colors.length] || colors[i % colors.length],
                subtext: formatDurationShort(sec, lang)
            };
        });
    })();

    $: totalTimerSec = donutData.reduce((sum, item) => sum + item.value, 0);
    $: donutTotalFormatted = `${Math.floor(totalTimerSec / 3600)}${t(lang, 'unit_h')} ${Math.floor((totalTimerSec % 3600) / 60)}${t(lang, 'unit_m')}`;
    $: donutSegments = (() => {
        const radius = 82;
        const circumference = 2 * Math.PI * radius;
        let offset = 0;
        return donutData.map((item) => {
            const length = totalTimerSec > 0 ? (item.value / totalTimerSec) * circumference : 0;
            const segment = {
                ...item,
                dasharray: `${length} ${circumference - length}`,
                dashoffset: -offset,
                percent: totalTimerSec > 0 ? Math.round((item.value / totalTimerSec) * 100) : 0
            };
            offset += length;
            return segment;
        });
    })();

    function getSparkline(habitName: string) {
        const last7Days: string[] = [];
        for (let i = 6; i >= 0; i--) last7Days.push(window.moment().subtract(i, 'days').format('YYYY-MM-DD'));
        const prop = plugin.settings.properties.find(p => p.name === habitName);
        return last7Days.map(d => {
            const rec = $allRecords.find(r => r.habit === habitName && r.date === d);
            const val = rec ? rec.durationSec : 0;
            const goal = rec?.desiredGoal || 1;
            return {
                date: d,
                val,
                perc: Math.min((val / Math.max(goal, 1)) * 100, 100),
                isMet: rec ? ['completed', 'partial', 'excused', 'deferred'].includes(rec.state || '') : false,
                title: `${d}: ${prop?.type === 'timer' ? formatDurationShort(val, lang) : val}`
            };
        });
    }

    function openHabit(habitName: string) {
        selectedStatsHabit.set(habitName);
        viewMode.set('detail');
    }

    $: unifiedHeatmapData = (() => {
        const summaryMap = new Map<string, { value: number, metCount: number, activeCount: number }>();
        const allDates = new Set<string>($allRecords.map(r => r.date));
        
        allDates.forEach(date => {
            let metCount = 0;
            let activeCount = 0;
            let totalValue = 0;
            plugin.settings.properties.forEach(prop => {
                const createdAt = prop.createdAt || "0000-00-00";
                if (date < createdAt) return;
                activeCount++;
                const rec = $allRecords.find(r => r.habit === prop.name && r.date === date);
                if (rec) {
                    if (['completed', 'partial', 'excused', 'deferred'].includes(rec.state || '')) metCount++;
                    if ((prop.type || 'timer') === 'timer') totalValue += rec.durationSec;
                }
            });
            if (activeCount > 0) summaryMap.set(date, { value: totalValue, metCount, activeCount });
        });

        return Array.from(summaryMap.entries()).map(([date, data]) => ({
            date,
            value: data.value,
            isMet: data.metCount >= data.activeCount && data.activeCount > 0
        }));
    })();

    function showDaySummary(date: string) {
        const recordsForDay = $allRecords.filter(r => r.date === date);
        const sessions: any[] = [];
        recordsForDay.forEach(r => { r.sessions?.forEach(s => { sessions.push({ habit: r.habit, subTask: s.subTask, durationSec: s.durationSec, task: s.task, startHour: s.startHour }); }); });
        new DaySummaryModal(app, date, sessions, lang).open();
    }
</script>

<div class="stats-header-controls">
    {#each periods as p}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <button class="period-btn {$currentPeriod === p.id ? 'active' : ''}" on:click={() => currentPeriod.set(p.id as any)}>
            {t(lang, p.label as any)}
        </button>
    {/each}
</div>

<div class="productivity-score-card">
    <div class="score-circle">{score}%</div>
    <div class="score-info">
        <div class="score-title">{t(lang, 'productivity_score')}</div>
        <div class="score-subtitle">
            {#if score > 70}
                {t(lang, 'score_high')}
            {:else if score > 40}
                {t(lang, 'score_mid')}
            {:else}
                {t(lang, 'score_low')}
            {/if}
        </div>
    </div>
</div>

<div class="donut-container">
    <div class="donut-chart">
        <svg viewBox="0 0 220 220" width="220" height="220" aria-label={t(lang, 'productivity_trends')}>
            <circle cx="110" cy="110" r="82" fill="none" stroke="var(--background-modifier-border)" stroke-width="34" opacity="0.35" />
            {#each donutSegments as item}
                {#if item.value > 0}
                    <circle
                        class="donut-segment"
                        cx="110"
                        cy="110"
                        r="82"
                        fill="none"
                        stroke={item.color}
                        stroke-width="34"
                        stroke-dasharray={item.dasharray}
                        stroke-dashoffset={item.dashoffset}
                        transform="rotate(-90 110 110)"
                    >
                        <title>{item.label}: {item.subtext} ({item.percent}%)</title>
                    </circle>
                {/if}
            {/each}
        </svg>
        <div class="donut-hole">
            <div class="donut-total-val">{donutTotalFormatted}</div>
            <div class="donut-total-lbl">{t(lang, 'total')}</div>
        </div>
    </div>

    <div class="donut-legend">
        {#if donutSegments.length === 0}
            <div class="donut-empty">{t(lang, 'no_data')}</div>
        {:else}
            {#each donutSegments as item}
                <button class="donut-legend-item" on:click={() => openHabit(item.label)}>
                    <span class="donut-legend-dot" style="background: {item.color};"></span>
                    <span class="donut-legend-label">{item.label}</span>
                    <span class="donut-legend-value">{item.subtext}</span>
                    <span class="donut-legend-percent">{item.percent}%</span>
                </button>
            {/each}
        {/if}
    </div>
</div>

<div class="habit-list">
    {#each plugin.settings.properties as prop, i}
        {@const habit = prop.name}
        {@const type = prop.type || 'timer'}
        {@const color = colors[i % colors.length]}
        {@const val = filteredRecords.filter(r => r.habit === habit).reduce((sum, r) => sum + r.durationSec, 0)}
        {@const sparkline = getSparkline(habit)}
        
        <!-- svelte-ignore a11y-no-static-element-interactions removed -->
        <div class="habit-list-item" style="border-left: 5px solid {color}"
            role="button" tabindex="0"
            on:click={() => openHabit(habit)}
            on:keydown={(e) => e.key === 'Enter' && openHabit(habit)}>
            <div class="habit-list-left">
                <span>{habit}</span>
            </div>
            
            <div class="sparkline-container">
                {#each sparkline as sp}
                    <div class="sparkline-bar" style="height: {Math.max(sp.perc, 5)}%; background-color: {sp.isMet ? 'var(--ht-success)' : 'var(--text-muted)'};" title={sp.title}></div>
                {/each}
            </div>
            
            <div class="habit-list-right">
                <span class="habit-list-time">
                    <span>{type === 'timer' ? formatDurationShort(val, lang) : val}</span>
                </span>
            </div>
        </div>
    {/each}
</div>

<div class="stats-section-header" style="display:flex; justify-content:space-between; align-items:center; margin-top:30px;">
    <h3 class="stats-section-title" style="margin:0;">📅 {t(lang, 'yearly_activity')}</h3>
</div>

<Heatmap 
    records={unifiedHeatmapData} 
    days={plugin.settings.heatmapDays} 
    cellSize={plugin.settings.heatmapCellSize} 
    groupByMonth={plugin.settings.heatmapGroupByMonth} 
    formatValue={(v) => formatDurationShort(v, lang)}
    onBoxClick={showDaySummary}
/>
