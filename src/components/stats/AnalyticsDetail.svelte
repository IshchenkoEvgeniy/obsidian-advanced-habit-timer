<script lang="ts">
    import type { App } from 'obsidian';
    import type HabitTimerPlugin from '../../main';
    import { t } from '../../i18n';
    import { allRecords, currentPeriod, selectedStatsHabit, viewMode } from '../../store/StatsStore';
    import { formatDurationShort } from '../../utils';
    import { moment } from 'obsidian';
    import BarChart from '../charts/BarChart.svelte';
    import Heatmap from '../charts/Heatmap.svelte';
    import { DaySummaryModal } from '../../session-modals';

    export let plugin: HabitTimerPlugin;
    export let app: App;
    // view is passed for external reference but not used internally
    export const view: any = undefined;

    const _keep = [BarChart, Heatmap, t, allRecords, currentPeriod, selectedStatsHabit, viewMode, formatDurationShort, DaySummaryModal];
    let lang = plugin.settings.language;

    $: habitName = $selectedStatsHabit!;
    $: prop = plugin.settings.properties.find(p => p.name === habitName);
    $: type = prop?.type || 'timer';
    
    $: habitAllRecords = $allRecords.filter(r => r.habit === habitName);
    
    // Filtered by currentPeriod
    $: records = (() => {
        const now = window.moment();
        const p = $currentPeriod;
        return habitAllRecords.filter(rec => {
            if (p === 'all') return true;
            const recDate = window.moment(rec.date);
            if (p === 'day') return recDate.isSame(now, 'day');
            if (p === 'week') return recDate.isSame(now, 'week');
            if (p === 'month') return recDate.isSame(now, 'month');
            return true;
        });
    })();

    $: maxDaily = Math.max(...habitAllRecords.map(r => r.durationSec), 0);
    $: longestSession = Math.max(...habitAllRecords.flatMap(r => r.sessions?.map(s => s.durationSec) || [0]), 0);

    $: bestStreak = (() => {
        if (!prop || habitAllRecords.length === 0) return 0;
        const sortedDates = habitAllRecords
            .filter(r => r.state === 'completed' || r.state === 'partial')
            .map(r => (prop.goalMode || 'daily') === 'weekly' ? window.moment(r.date).startOf('isoWeek').format('YYYY-MM-DD') : r.date)
            .filter((date, index, all) => all.indexOf(date) === index)
            .sort();
        if (sortedDates.length === 0) return 0;
        
        let max = 1, temp = 1;
        for (let i = 1; i < sortedDates.length; i++) {
            const unit = (prop.goalMode || 'daily') === 'weekly' ? 'weeks' : 'days';
            const diff = window.moment(sortedDates[i]).diff(window.moment(sortedDates[i - 1]), unit);
            if (diff === 1) { temp++; if (temp > max) max = temp; }
            else { temp = 1; }
        }
        return max;
    })();

    $: currentStreak = (() => {
        if (!prop) return 0;
        if ((prop.goalMode || 'daily') === 'weekly') {
            const successfulWeeks = new Set(habitAllRecords
                .filter(record => record.state === 'completed' || record.state === 'partial')
                .map(record => window.moment(record.date).startOf('isoWeek').format('YYYY-MM-DD')));
            let weeklyStreak = 0;
            const week = window.moment().subtract(1, 'week').startOf('isoWeek');
            for (let i = 0; i < 520; i++) {
                if (!successfulWeeks.has(week.format('YYYY-MM-DD'))) break;
                weeklyStreak++;
                week.subtract(1, 'week');
            }
            if (successfulWeeks.has(window.moment().startOf('isoWeek').format('YYYY-MM-DD'))) weeklyStreak++;
            return weeklyStreak;
        }
        const index = new Map<string, any>(habitAllRecords.map(r => [r.date, r]));
        let streak = 0;
        let checkDate = window.moment().subtract(1, 'days');
        for (let i = 0; i < 3650; i++) {
            const dStr = checkDate.format('YYYY-MM-DD');
            const rec = index.get(dStr);
            if (!rec || rec.state === 'skipped' || rec.state === 'missed' || rec.state === 'pending') break;
            if (rec.state === 'completed' || rec.state === 'partial') streak++;
            checkDate.subtract(1, 'days');
        }
        const todayRec = index.get(window.moment().format('YYYY-MM-DD'));
        if (todayRec && (todayRec.state === 'completed' || todayRec.state === 'partial')) streak++;
        return streak;
    })();

    $: weeklyData = (() => {
        const last7Days: string[] = [];
        for (let i = 6; i >= 0; i--) last7Days.push(window.moment().subtract(i, 'days').format('YYYY-MM-DD'));
        
        return last7Days.map(dateStr => {
            const rec = habitAllRecords.find(r => r.date === dateStr);
            const val = rec ? rec.durationSec : 0;
            return {
                label: window.moment(dateStr).format('ddd'),
                date: dateStr,
                total: val,
                segments: [{
                    label: habitName,
                    value: val,
                    color: "var(--ht-accent)",
                    subtext: type === 'timer' ? formatDurationShort(val, lang) : String(val)
                }]
            };
        });
    })();

    $: totalVal = records.reduce((sum, r) => sum + r.durationSec, 0);
    $: minVal = records.length > 0 ? Math.min(...records.map(r => r.durationSec)) : 0;
    $: maxVal = records.length > 0 ? Math.max(...records.map(r => r.durationSec)) : 0;
    $: avgVal = records.length > 0 ? totalVal / records.length : 0;

    function formatVal(v: number) { return type === 'timer' ? formatDurationShort(v, lang) : String(v); }

    function showDaySummary(date: string) {
        const recordsForDay = $allRecords.filter(r => r.date === date);
        const sessions: any[] = [];
        recordsForDay.forEach(r => { r.sessions?.forEach(s => { sessions.push({ habit: r.habit, subTask: s.subTask, durationSec: s.durationSec, task: s.task, startHour: s.startHour }); }); });
        new DaySummaryModal(app, date, sessions, lang).open();
    }
</script>

<div class="detail-header">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <button class="back-btn" on:click={() => viewMode.set('main')}>←</button>
    <h2 style="margin:0;">{habitName}</h2>
</div>

<div style="text-align:center; color:#a6adc8; font-size:0.8em; margin: 15px 0 5px; text-transform: uppercase;">
    {t(lang, 'personal_bests')}
</div>
<div class="stats-grid-3">
    <div class="stat-box">
        <div class="stat-box-val">🏆 {formatVal(maxDaily)}</div>
        <div class="stat-box-lbl">{t(lang, 'best_day')}</div>
    </div>
    {#if type === 'timer'}
        <div class="stat-box">
            <div class="stat-box-val">🌟 {formatDurationShort(longestSession, lang)}</div>
            <div class="stat-box-lbl">{t(lang, 'best_session')}</div>
        </div>
    {/if}
    <div class="stat-box">
        <div class="stat-box-val">🔥 {bestStreak}</div>
        <div class="stat-box-lbl">{t(lang, 'best_streak')}</div>
    </div>
</div>

<div class="weekly-chart-container" style="margin-top: 20px;">
    <div class="weekly-chart-title">{t(lang, 'last_7_days')}</div>
    <BarChart data={weeklyData} height={120} />
</div>

<div class="stats-grid-2" style="margin-top: 20px;">
    <div class="stat-box">
        <div class="stat-box-val">{formatVal(totalVal)}</div>
        <div class="stat-box-lbl">{type === 'timer' ? t(lang, 'total_time') : t(lang, 'total_count')}</div>
    </div>
    <div class="stat-box">
        <div class="stat-box-val streak-color">🔥 {currentStreak}</div>
        <div class="stat-box-lbl">{t(lang, 'current_streak')}</div>
    </div>
</div>

<div style="text-align:center; color:#a6adc8; font-size:0.8em; margin: 15px 0 5px;">
    {type === 'timer' ? t(lang, 'daily_time') : t(lang, 'daily_stats')}
</div>
<div class="stats-grid-3">
    <div class="stat-box">
        <div class="stat-box-val">{type === 'count' ? minVal : formatShort(minVal)}</div>
        <div class="stat-box-lbl">{t(lang, 'min_label')}</div>
    </div>
    <div class="stat-box">
        <div class="stat-box-val">{type === 'count' ? avgVal.toFixed(1) : formatShort(avgVal)}</div>
        <div class="stat-box-lbl">{t(lang, 'avg_label')}</div>
    </div>
    <div class="stat-box">
        <div class="stat-box-val">{type === 'count' ? maxVal : formatShort(maxVal)}</div>
        <div class="stat-box-lbl">{t(lang, 'max_label')}</div>
    </div>
</div>

<div class="heatmap-detail-container" style="margin-top: 25px;">
    <div class="heatmap-detail-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div class="heatmap-detail-title">{t(lang, 'heatmap_90_days')}</div>
    </div>
    
    <Heatmap 
        records={habitAllRecords.map(r => ({ date: r.date, value: r.durationSec, isMet: ['completed', 'partial', 'excused', 'deferred'].includes(r.state || '') }))}
        days={plugin.settings.heatmapDays} 
        cellSize={plugin.settings.heatmapCellSize} 
        groupByMonth={plugin.settings.heatmapGroupByMonth} 
        formatValue={(v) => formatVal(v)}
        onBoxClick={showDaySummary}
    />
</div>

<script context="module">
    // Helper needed in markup context
    import { formatDurationShort as formatShortLocal } from '../../utils';
    function formatShort(v: number) { return formatShortLocal(v, 'en'); } // Simplified for this scope
</script>
