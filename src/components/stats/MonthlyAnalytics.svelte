<script lang="ts">
    import { Notice, moment } from 'obsidian';
    import type HabitTimerPlugin from '../../main';
    import { t } from '../../i18n';
    import { allRecords, selectedStatsHabit, selectedStatsMonth, viewMode } from '../../store/StatsStore';
    import { buildMonthlyStats } from '../../stats/monthly';

    export let plugin: HabitTimerPlugin;

    const lang = plugin.settings.language;
    const chartLeft = 20;
    const chartRight = 700;
    const chartTop = 24;
    const chartBottom = 198;
    const palette = ['#55d5a2', '#ffb629', '#49b5ff', '#cba6f7', '#f38ba8', '#94e2d5', '#f9e2af'];
    const goodStates = new Set(['completed', 'partial', 'excused', 'deferred']);

    $: report = buildMonthlyStats(
        $allRecords,
        plugin.settings.properties,
        $selectedStatsMonth,
        moment().format('YYYY-MM-DD')
    );
    $: monthDate = moment(`${$selectedStatsMonth}-01`, 'YYYY-MM-DD').locale(lang);
    $: monthTitle = monthDate.format('MMMM YYYY');
    $: monthName = monthDate.format('MMMM');
    $: isCurrentMonth = $selectedStatsMonth >= moment().format('YYYY-MM');
    $: chartTicks = getChartTicks(report.days);
    $: chartGrid = [0, 1, 2, 3].map(index => chartTop + ((chartBottom - chartTop) * index / 3));

    function changeMonth(offset: number) {
        const nextMonth = moment(`${$selectedStatsMonth}-01`, 'YYYY-MM-DD').add(offset, 'month');
        if (nextMonth.isAfter(moment(), 'month')) return;
        selectedStatsMonth.set(nextMonth.format('YYYY-MM'));
    }

    function seriesColor(index: number): string {
        return palette[index % palette.length] || palette[0]!;
    }

    function xFor(index: number, count: number): number {
        return count <= 1 ? (chartLeft + chartRight) / 2 : chartLeft + index * (chartRight - chartLeft) / (count - 1);
    }

    function yFor(value: number): number {
        const maximum = Math.max(report.maxDailyFocusSec * 1.15, 3600);
        return chartBottom - (value / maximum) * (chartBottom - chartTop);
    }

    function pointsFor(habit: string): string {
        const values = report.dailyFocusByHabit[habit] || [];
        return values.map((value, index) => `${xFor(index, values.length).toFixed(1)},${yFor(value).toFixed(1)}`).join(' ');
    }

    function areaFor(habit: string): string {
        const values = report.dailyFocusByHabit[habit] || [];
        if (values.length === 0) return '';
        const points = values.map((value, index) => `${xFor(index, values.length).toFixed(1)} ${yFor(value).toFixed(1)}`);
        return `M ${chartLeft} ${chartBottom} L ${points.join(' L ')} L ${chartRight} ${chartBottom} Z`;
    }

    function getChartTicks(days: string[]) {
        if (days.length === 0) return [];
        const lastIndex = days.length - 1;
        const indices = [...new Set([0, Math.round(lastIndex * 0.23), Math.round(lastIndex * 0.5), Math.round(lastIndex * 0.75), lastIndex])];
        return indices.map(index => ({
            x: xFor(index, days.length),
            label: moment(days[index] || days[0]).format('DD.MM'),
            anchor: index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle'
        }));
    }

    function formatDuration(seconds: number): string {
        const minutes = Math.max(0, Math.round(seconds / 60));
        return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    }

    function formatStartTime(minutes: number | null): string {
        if (minutes === null) return '—';
        const normalized = (Math.round(minutes) + 1440) % 1440;
        return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
    }

    function signedPercent(value: number | null, current: number): string {
        if (value === null) return current > 0 ? t(lang, 'monthly_stats_new_habit') : t(lang, 'monthly_stats_previous_data_missing');
        if (value === 0) return t(lang, 'monthly_stats_no_change');
        return `${value > 0 ? '▲ +' : '▼ '}${Math.abs(value)}% ${t(lang, 'monthly_stats_previous_month_short')}`;
    }

    function signedDurationDelta(value: number | null): string {
        if (value === null) return t(lang, 'monthly_stats_previous_data_missing');
        if (Math.round(value / 60) === 0) return t(lang, 'monthly_stats_no_change');
        const rounded = Math.round(Math.abs(value) / 60) * 60;
        return `${value > 0 ? '▲ +' : '▼ '}${formatDuration(rounded)} ${t(lang, 'monthly_stats_previous_month_short')}`;
    }

    function sessionDeltaText(value: number | null): string {
        if (value === null) return t(lang, 'monthly_stats_previous_data_missing');
        if (value === 0) return t(lang, 'monthly_stats_no_change');
        return `${value > 0 ? '▲ +' : '▼ '}${Math.abs(value)} ${t(lang, 'monthly_stats_previous_month_short')}`;
    }

    function missLabel(count: number): string {
        if (lang !== 'ru') return `${count} ${count === 1 ? 'missed day' : 'missed days'}`;
        const lastTwo = count % 100;
        const last = count % 10;
        const noun = lastTwo >= 11 && lastTwo <= 14 ? 'пропусков' : last === 1 ? 'пропуск' : last >= 2 && last <= 4 ? 'пропуска' : 'пропусков';
        return `${count} ${noun}`;
    }

    function goalContext(): string {
        if (report.trackedDays === 0 || report.goalPercent === null) return t(lang, 'no_data');
        if (report.missedDays === 0) return `▲ ${t(lang, 'monthly_stats_all_days_met', report.completedDays, report.trackedDays)}`;
        return `▼ ${missLabel(report.missedDays)}`;
    }

    function bestSessionContext(): string {
        const best = report.bestSession;
        if (!best) return t(lang, 'no_data');
        const weekday = moment(best.date).locale(lang).format('ddd');
        return `${best.habit} · ${weekday} ${formatStartTime(best.startTimeMinutes)}`;
    }

    function averageStartContext(): string {
        const delta = report.averageStartDeltaMinutes;
        if (delta === null) return t(lang, 'monthly_stats_previous_data_missing');
        if (delta === 0) return t(lang, 'monthly_stats_no_change');
        const earlier = delta < 0;
        const text = t(lang, earlier ? 'monthly_stats_earlier_by' : 'monthly_stats_later_by', Math.abs(delta));
        return `${earlier ? '▲' : '▼'} ${text}`;
    }

    function bestDuration(row: typeof report.habits[number]): string {
        return row.bestSession ? formatDuration(row.bestSession.durationSec) : '—';
    }

    function averageStart(row: typeof report.habits[number]): string {
        return formatStartTime(row.averageStartMinutes);
    }

    function habitDelta(row: typeof report.habits[number]): string {
        if (row.type !== 'timer') return '—';
        return signedPercent(row.focusDeltaPct, row.focusSec);
    }

    function habitGoal(row: typeof report.habits[number]): string {
        if (row.goalPercent === null) return '—';
        return `${row.goalPercent}%`;
    }

    function openHabit(habit: string) {
        selectedStatsHabit.set(habit);
        viewMode.set('detail');
    }

    function csvCell(value: string | number): string {
        return `"${String(value).replace(/"/g, '""')}"`;
    }

    function exportFile(name: string, content: string, mime: string) {
        const url = URL.createObjectURL(new Blob([content], { type: mime }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        new Notice(t(lang, 'monthly_stats_exported', name));
    }

    function exportJson() {
        const payload = {
            month: $selectedStatsMonth,
            summary: {
                totalFocusSec: report.totalFocusSec,
                averagePerDaySec: Math.round(report.averagePerDaySec),
                goalPercent: report.goalPercent,
                completedDays: report.completedDays,
                trackedDays: report.trackedDays,
                sessions: report.sessionCount,
                bestSession: report.bestSession,
                averageStart: report.averageStartMinutes
            },
            habits: report.habits,
            dailyFocusByHabit: report.dailyFocusByHabit
        };
        exportFile(`analytics-${$selectedStatsMonth}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    }

    function exportCsv() {
        const headers = [
            t(lang, 'stats_col_habit'), t(lang, 'monthly_stats_total_focus'), t(lang, 'monthly_stats_col_change'),
            t(lang, 'stats_col_sessions'), t(lang, 'monthly_stats_col_average_session'), t(lang, 'stats_col_goal'),
            t(lang, 'monthly_stats_col_best_session'), t(lang, 'monthly_stats_col_average_start')
        ];
        const rows = report.habits.map(row => [
            row.name,
            row.type === 'timer' ? formatDuration(row.focusSec) : '—',
            habitDelta(row),
            row.type === 'timer' ? row.sessions : '—',
            row.type === 'timer' && row.sessions ? formatDuration(row.averageSessionSec) : '—',
            habitGoal(row),
            row.type === 'timer' ? bestDuration(row) : '—',
            row.type === 'timer' ? averageStart(row) : '—'
        ]);
        const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
        exportFile(`analytics-${$selectedStatsMonth}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
    }

    function exportMarkdown() {
        const tableRows = report.habits.map(row =>
            `| ${row.name.replace(/\|/g, '\\|')} | ${row.type === 'timer' ? formatDuration(row.focusSec) : '—'} | ${habitDelta(row)} | ${row.type === 'timer' ? row.sessions : '—'} | ${row.type === 'timer' && row.sessions ? formatDuration(row.averageSessionSec) : '—'} | ${habitGoal(row)} | ${row.type === 'timer' ? bestDuration(row) : '—'} | ${row.type === 'timer' ? averageStart(row) : '—'} |`
        );
        const markdown = [
            `# ${t(lang, 'monthly_stats_title')} · ${monthTitle}`,
            '',
            `- ${t(lang, 'monthly_stats_total_focus')}: ${formatDuration(report.totalFocusSec)}`,
            `- ${t(lang, 'monthly_stats_average_per_day')}: ${formatDuration(report.averagePerDaySec)}`,
            `- ${t(lang, 'monthly_stats_days_with_goal')}: ${report.goalPercent === null ? '—' : `${report.goalPercent}% (${report.completedDays}/${report.trackedDays})`}`,
            `- ${t(lang, 'monthly_stats_total_sessions')}: ${report.sessionCount}`,
            `- ${t(lang, 'best_session')}: ${report.bestSession ? formatDuration(report.bestSession.durationSec) : '—'}`,
            `- ${t(lang, 'monthly_stats_average_start')}: ${formatStartTime(report.averageStartMinutes)}`,
            '',
            `## ${t(lang, 'monthly_stats_table')}`,
            '',
            `| ${t(lang, 'stats_col_habit')} | ${t(lang, 'monthly_stats_total_focus')} | ${t(lang, 'monthly_stats_col_change')} | ${t(lang, 'stats_col_sessions')} | ${t(lang, 'monthly_stats_col_average_session')} | ${t(lang, 'stats_col_goal')} | ${t(lang, 'monthly_stats_col_best_session')} | ${t(lang, 'monthly_stats_col_average_start')} |`,
            '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
            ...tableRows,
            ''
        ].join('\n');
        exportFile(`analytics-${$selectedStatsMonth}.md`, markdown, 'text/markdown;charset=utf-8');
    }
</script>

<div class="monthly-analytics">
    <header class="report-header">
        <div class="title-group">
            <h1>{t(lang, 'monthly_stats_title')} · {monthTitle}</h1>
            <div class="month-navigation" aria-label={t(lang, 'monthly_stats_title')}>
                <button class="month-step" type="button" aria-label={t(lang, 'monthly_stats_previous_month_action')} on:click={() => changeMonth(-1)}>‹</button>
                <button class="month-step" type="button" aria-label={t(lang, 'monthly_stats_next_month_action')} disabled={isCurrentMonth} on:click={() => changeMonth(1)}>›</button>
            </div>
        </div>
        <div class="export-actions" aria-label={t(lang, 'monthly_stats_summary')}>
            <button class="export-button" type="button" on:click={exportCsv}>{t(lang, 'monthly_stats_export_csv')}</button>
            <button class="export-button" type="button" on:click={exportJson}>{t(lang, 'monthly_stats_export_json')}</button>
            <button class="export-button" type="button" on:click={exportMarkdown}>{t(lang, 'monthly_stats_export_md')}</button>
        </div>
    </header>

    <section class="panel trend-panel" aria-labelledby="monthly-trend-heading">
        <div class="panel-heading">
            <h2 class="eyebrow" id="monthly-trend-heading">{t(lang, 'monthly_stats_trend')}</h2>
            <span class="month-tag">{monthName}</span>
        </div>

        {#if report.totalFocusSec > 0 && report.timerHabits.length > 0}
            <svg class="focus-chart" viewBox="0 0 720 240" role="img" aria-label={`${t(lang, 'monthly_stats_trend')} · ${monthTitle}`}>
                {#each chartGrid as y}
                    <line class="chart-grid" x1={chartLeft} y1={y} x2={chartRight} y2={y} />
                {/each}
                {#if report.timerHabits[0]}
                    <path d={areaFor(report.timerHabits[0])} fill={seriesColor(0)} opacity="0.09" />
                {/if}
                {#each report.timerHabits as habit, index (habit)}
                    <polyline class="chart-line" points={pointsFor(habit)} stroke={seriesColor(index)} aria-label={`${habit}: ${formatDuration(report.habits.find(row => row.name === habit)?.focusSec || 0)}`} />
                {/each}
                {#each chartTicks as tick, index}
                    <text class="axis-label" x={tick.x} y="228" text-anchor={tick.anchor}>{tick.label}</text>
                {/each}
            </svg>
            <div class="legend" aria-label={t(lang, 'stats_col_habit')}>
                {#each report.timerHabits as habit, index (habit)}
                    {@const row = report.habits.find(value => value.name === habit)}
                    <span class="legend-item">
                        <i class="legend-mark" style={`background:${seriesColor(index)}`}></i>
                        <span>{habit}</span>
                        <b>{formatDuration(row?.focusSec || 0)}</b>
                    </span>
                {/each}
            </div>
        {:else}
            <div class="empty-chart">{t(lang, 'no_data')}</div>
        {/if}
    </section>

    <section class="panel summary-panel" aria-labelledby="monthly-summary-heading">
        <h2 class="eyebrow" id="monthly-summary-heading">{t(lang, 'monthly_stats_summary')}</h2>
        <div class="metric-grid">
            <article class="metric-card">
                <p class="metric-value">{formatDuration(report.totalFocusSec)}</p>
                <p class="metric-label">{t(lang, 'monthly_stats_total_focus')}</p>
                <p class="metric-delta" class:positive={report.focusDeltaPct === null || report.focusDeltaPct >= 0} class:negative={report.focusDeltaPct !== null && report.focusDeltaPct < 0}>{signedPercent(report.focusDeltaPct, report.totalFocusSec)}</p>
            </article>
            <article class="metric-card">
                <p class="metric-value">{formatDuration(report.averagePerDaySec)}</p>
                <p class="metric-label">{t(lang, 'monthly_stats_average_per_day')}</p>
                <p class="metric-delta" class:positive={report.averagePerDayDeltaSec === null || report.averagePerDayDeltaSec >= 0} class:negative={report.averagePerDayDeltaSec !== null && report.averagePerDayDeltaSec < 0}>{signedDurationDelta(report.averagePerDayDeltaSec)}</p>
            </article>
            <article class="metric-card">
                <p class="metric-value">{report.goalPercent === null ? '—' : `${report.goalPercent}%`}</p>
                <p class="metric-label">{t(lang, 'monthly_stats_days_with_goal')}</p>
                <p class="metric-delta" class:positive={report.missedDays === 0} class:negative={report.missedDays > 0}>{goalContext()}</p>
            </article>
            <article class="metric-card">
                <p class="metric-value">{report.sessionCount}</p>
                <p class="metric-label">{t(lang, 'monthly_stats_total_sessions')}</p>
                <p class="metric-delta" class:positive={report.sessionDelta === null || report.sessionDelta >= 0} class:negative={report.sessionDelta !== null && report.sessionDelta < 0}>{sessionDeltaText(report.sessionDelta)}</p>
            </article>
            <article class="metric-card">
                <p class="metric-value">{report.bestSession ? formatDuration(report.bestSession.durationSec) : '—'}</p>
                <p class="metric-label">{t(lang, 'best_session')}</p>
                <p class="metric-delta positive">{bestSessionContext()}</p>
            </article>
            <article class="metric-card">
                <p class="metric-value">{formatStartTime(report.averageStartMinutes)}</p>
                <p class="metric-label">{t(lang, 'monthly_stats_average_start')}</p>
                <p class="metric-delta" class:positive={report.averageStartDeltaMinutes === null || report.averageStartDeltaMinutes <= 0} class:negative={report.averageStartDeltaMinutes !== null && report.averageStartDeltaMinutes > 0}>{averageStartContext()}</p>
            </article>
        </div>
    </section>

    <section class="panel table-panel" aria-labelledby="monthly-habits-heading">
        <div class="table-heading">
            <h2 class="eyebrow" id="monthly-habits-heading">{t(lang, 'monthly_stats_table')}</h2>
            <span class="table-period">{monthTitle} · {t(lang, 'monthly_stats_previous_month_short')}</span>
        </div>
        <div class="table-scroll">
            <table>
                <caption>{t(lang, 'monthly_stats_table')} · {monthTitle}</caption>
                <thead>
                    <tr>
                        <th scope="col">{t(lang, 'stats_col_habit')}</th>
                        <th scope="col" class="numeric">{t(lang, 'monthly_stats_total_focus')}</th>
                        <th scope="col" class="numeric">{t(lang, 'monthly_stats_col_change')}</th>
                        <th scope="col" class="numeric">{t(lang, 'stats_col_sessions')}</th>
                        <th scope="col" class="numeric">{t(lang, 'monthly_stats_col_average_session')}</th>
                        <th scope="col" class="numeric">{t(lang, 'stats_col_goal')}</th>
                        <th scope="col" class="numeric">{t(lang, 'monthly_stats_col_best_session')}</th>
                        <th scope="col" class="numeric">{t(lang, 'monthly_stats_col_average_start')}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each report.habits as row, index (row.name)}
                        <tr>
                            <td>
                                <button class="habit-link" type="button" on:click={() => openHabit(row.name)}>
                                    {#if row.type === 'timer'}<i class="habit-dot" style={`background:${seriesColor(report.timerHabits.indexOf(row.name))}`}></i>{/if}
                                    {row.name}
                                </button>
                            </td>
                            <td class="numeric">{row.type === 'timer' ? formatDuration(row.focusSec) : '—'}</td>
                            <td class="numeric" class:positive={row.focusDeltaPct === null || row.focusDeltaPct >= 0} class:negative={row.focusDeltaPct !== null && row.focusDeltaPct < 0}>{habitDelta(row)}</td>
                            <td class="numeric">{row.type === 'timer' ? row.sessions : '—'}</td>
                            <td class="numeric">{row.type === 'timer' && row.sessions ? formatDuration(row.averageSessionSec) : '—'}</td>
                            <td class="numeric">{habitGoal(row)}</td>
                            <td class="numeric">{row.type === 'timer' ? bestDuration(row) : '—'}</td>
                            <td class="numeric">{row.type === 'timer' ? averageStart(row) : '—'}</td>
                        </tr>
                    {:else}
                        <tr><td class="empty-row" colspan="8">{t(lang, 'no_data')}</td></tr>
                    {/each}
                </tbody>
                {#if report.habits.length > 0}
                    <tfoot>
                        <tr>
                            <td>{t(lang, 'total')}</td>
                            <td class="numeric">{formatDuration(report.totalFocusSec)}</td>
                            <td class="numeric" class:positive={report.focusDeltaPct === null || report.focusDeltaPct >= 0} class:negative={report.focusDeltaPct !== null && report.focusDeltaPct < 0}>{signedPercent(report.focusDeltaPct, report.totalFocusSec)}</td>
                            <td class="numeric">{report.sessionCount}</td>
                            <td class="numeric">{report.sessionCount ? formatDuration(report.totalFocusSec / report.sessionCount) : '—'}</td>
                            <td class="numeric">{report.goalPercent === null ? '—' : `${report.goalPercent}%`}</td>
                            <td class="numeric">{report.bestSession ? formatDuration(report.bestSession.durationSec) : '—'}</td>
                            <td class="numeric">{formatStartTime(report.averageStartMinutes)}</td>
                        </tr>
                    </tfoot>
                {/if}
            </table>
        </div>
    </section>
</div>

<style>
    .monthly-analytics {
        --report-bg: #0b0c0d;
        --report-panel: #101112;
        --report-card: #1b1c1d;
        --report-border: #292b2d;
        --report-text: #eceeef;
        --report-muted: #777a7d;
        --report-green: #55d5a2;
        --report-red: #ff6868;
        display: flex;
        flex-direction: column;
        gap: 15px;
        padding: 0 0 24px;
        color: var(--report-text);
        background: var(--report-bg);
    }
    .report-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .title-group { display: flex; align-items: center; gap: 10px; min-width: 0; }
    h1 { margin: 0; font-size: clamp(18px, 2.5vw, 22px); line-height: 1.25; font-weight: 650; letter-spacing: -.025em; }
    .month-navigation, .export-actions { display: flex; align-items: center; gap: 7px; }
    .monthly-analytics button {
        margin: 0 !important;
        box-shadow: none !important;
        transform: none !important;
        cursor: pointer;
    }
    .month-step {
        width: 30px;
        height: 30px;
        padding: 0 !important;
        border: 1px solid var(--report-border) !important;
        border-radius: 9px !important;
        background: #191a1b !important;
        color: #c9cbcd !important;
        font-size: 21px;
        line-height: 1;
    }
    .month-step:hover, .export-button:hover { background: #27292b !important; border-color: #484b4e !important; }
    .month-step:disabled { opacity: .38; cursor: default; }
    .export-button {
        min-height: 34px;
        padding: 0 15px !important;
        border: 1px solid #303235 !important;
        border-radius: 10px !important;
        background: #1b1c1e !important;
        color: var(--report-text) !important;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
    }
    .monthly-analytics button:focus-visible { outline: 2px solid #49b5ff; outline-offset: 2px; }
    .panel { border: 1px solid var(--report-border); border-radius: 16px; background: var(--report-panel); }
    .trend-panel { padding: 18px 17px 15px; }
    .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .eyebrow { margin: 0; color: var(--report-muted); font: 500 11px/1.4 ui-monospace, "SFMono-Regular", Consolas, monospace; letter-spacing: .055em; text-transform: uppercase; }
    .month-tag { color: #c9cbcd; font: 500 11px/1.4 ui-monospace, "SFMono-Regular", Consolas, monospace; text-transform: uppercase; }
    .focus-chart { display: block; width: 100%; height: auto; overflow: visible; }
    .chart-grid { stroke: #222426; stroke-width: 1; }
    .chart-line { fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
    .axis-label { fill: #777a7d; font: 10px ui-monospace, "SFMono-Regular", Consolas, monospace; letter-spacing: .04em; }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 22px; padding: 5px 1px 0; }
    .legend-item { display: inline-flex; align-items: center; gap: 8px; color: #aaacae; font: 11px ui-monospace, "SFMono-Regular", Consolas, monospace; }
    .legend-item b { color: #d0d1d2; font-weight: 500; }
    .legend-mark { width: 13px; height: 3px; border-radius: 5px; }
    .empty-chart, .empty-row { padding: 38px 12px; color: var(--report-muted); text-align: center; font-size: 13px; }
    .summary-panel { padding: 18px 17px 17px; }
    .metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
    .metric-card { min-width: 0; min-height: 103px; padding: 14px 15px 11px; border: 1px solid #303234; border-radius: 12px; background: var(--report-card); }
    .metric-value { margin: 0 0 6px; color: var(--report-text); font: 500 clamp(20px, 2.8vw, 23px)/1.15 ui-monospace, "SFMono-Regular", Consolas, monospace; letter-spacing: .025em; font-variant-numeric: tabular-nums; }
    .metric-label { margin: 0; color: var(--report-muted); font-size: 11px; line-height: 1.4; letter-spacing: .05em; text-transform: uppercase; }
    .metric-delta { margin: 6px 0 0; color: var(--report-green); font: 500 11px/1.35 ui-monospace, "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }
    .positive { color: var(--report-green) !important; }
    .negative { color: var(--report-red) !important; }
    .table-panel { padding: 18px 17px 8px; }
    .table-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 11px; }
    .table-period { color: var(--report-muted); font-size: 11px; }
    .table-scroll { overflow-x: auto; scrollbar-color: #45484b transparent; }
    table { width: 100%; min-width: 820px; border-collapse: collapse; text-align: left; }
    caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
    th { padding: 10px 9px; border-bottom: 1px solid var(--report-border); color: var(--report-muted); font-size: 10px; font-weight: 550; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
    td { padding: 12px 9px; border-bottom: 1px solid #222426; color: #c6c8ca; font-size: 12px; white-space: nowrap; }
    th.numeric, td.numeric { text-align: right; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-variant-numeric: tabular-nums; }
    tbody tr:last-child td { border-bottom-color: var(--report-border); }
    tfoot td { color: #f0f0f0; font-weight: 600; }
    .habit-link { display: inline-flex; align-items: center; gap: 8px; padding: 0 !important; border: 0 !important; background: transparent !important; color: var(--report-text) !important; font-size: 12px; font-weight: 550; text-align: left; }
    .habit-link:hover { color: #fff !important; text-decoration: underline; }
    .habit-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }

    @media (max-width: 680px) {
        .report-header { align-items: flex-start; flex-direction: column; }
        .export-actions { width: 100%; }
        .export-button { flex: 1; padding: 0 10px !important; }
    }
    @media (max-width: 540px) {
        .monthly-analytics { gap: 11px; }
        .title-group { gap: 7px; }
        h1 { font-size: 18px; }
        .month-navigation { gap: 4px; }
        .month-step { width: 27px; height: 27px; }
        .trend-panel, .summary-panel, .table-panel { padding-left: 12px; padding-right: 12px; border-radius: 13px; }
        .metric-grid { grid-template-columns: 1fr; gap: 8px; }
        .metric-card { min-height: 88px; }
        .legend { gap: 9px 14px; }
        .legend-item { font-size: 10px; }
        .table-heading { align-items: flex-start; flex-direction: column; gap: 5px; }
    }
</style>
