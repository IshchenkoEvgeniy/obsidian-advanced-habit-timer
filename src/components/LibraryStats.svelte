<script lang="ts">
    import { t } from '../i18n';
    import type { Language } from '../i18n';
    import type HabitTimerPlugin from '../main';
    import type { MediaItem } from '../store/StateManager';
    import type { MediaCollectionConfig } from '../types';
    import { getRatingValue, parseRating } from '../utils/rating';
    import { collectionDailyGoal, collectionDailyGoalEnabled, collectionDailyGoalUnit, dailyGoalUnitLabel } from '../library/daily-goals';

    export let items: MediaItem[] = [];
    export let collections: MediaCollectionConfig[] = [];
    export let lang: Language = 'en';
    export let plugin: HabitTimerPlugin;
    export let collectionId = 'all';

    interface DailyActivity {
        collectionId: string;
        value: number;
        goal: number;
        percent: number;
        streak: number;
        unit: string;
    }

    const MONTH_NAMES = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const MONTH_NAMES_RU = [
        'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
        'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'
    ];

    const colors = [
        "#89b4fa", "#fab387", "#a6e3a1", "#f9e2af", "#f5c2e7",
        "#94e2d5", "#cba6f7", "#eba0ac", "#f2cdcd", "#b4befe"
    ];

    // ── Reactive state ─────────────────────────────────────────────────────────
    let totalItems = 0;
    let finishedItemsCount = 0;
    let finishedThisYearCount = 0;
    let activeItemsCount = 0;
    let plannedItemsCount = 0;
    let averageRating: number | null = null;
    let dailyActivities: DailyActivity[] = [];
    let activeDaysThisMonth = 0;
    let activityVersion = 0;
    let genresData: { label: string; value: number; color: string; perc: number }[] = [];
    let ratingsData: { label: string; value: number; color: string; perc: number }[] = [];
    let monthlyData: { month: number; label: string; value: number; perc: number; isCurrent: boolean }[] = [];
    let avgDays: number | null = null;
    let yearGoal: number = plugin.settings.libraryYearGoal || 12;
    let editingGoal = false;
    let goalInputVal = yearGoal;
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth(); // 0-indexed

    // ── Core calculation ───────────────────────────────────────────────────────
    function recalculateStats(data: MediaItem[]) {
        try {
            totalItems = data.length;

            const finished = data.filter(i => {
                const col = collections.find(c => c.id === i.collectionId);
                return col && i.status === col.finishedStatusName;
            });
            finishedItemsCount = finished.length;
            const active = data.filter(i => {
                const col = collections.find(c => c.id === i.collectionId);
                return col && i.status === col.readingStatusName;
            });
            activeItemsCount = active.length;
            plannedItemsCount = Math.max(0, totalItems - finishedItemsCount - activeItemsCount);
            finishedThisYearCount = finished.filter(i => {
                const date = i.endDate ? new Date(i.endDate) : null;
                return date && !isNaN(date.getTime()) && date.getFullYear() === currentYear;
            }).length;
            const ratingValues = finished.map(i => getRatingValue(i.rating)).filter(value => value > 0);
            averageRating = ratingValues.length
                ? ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length
                : null;

            // Genre & Rating counts
            const gCounts: Record<string, number> = {};
            const rCounts: Record<string, number> = {};
            // Monthly counts (current year only)
            const mCounts: number[] = new Array(12).fill(0);
            // Average reading duration
            let totalDays = 0;
            let durationCount = 0;

            finished.forEach(i => {
                // Genres
                const itemGenres = i.genres.length ? i.genres : ['Unknown'];
                itemGenres.forEach(g => { gCounts[g] = (gCounts[g] || 0) + 1; });

                // Ratings
                const parsedRating = parseRating(i.rating);
                if (parsedRating) {
                    rCounts[parsedRating.label] = (rCounts[parsedRating.label] || 0) + 1;
                }

                // Monthly — use endDate
                if (i.endDate) {
                    const d = new Date(i.endDate);
                    if (!isNaN(d.getTime()) && d.getFullYear() === currentYear) {
                        mCounts[d.getMonth()]++;
                    }
                }

                // Average reading days
                if (i.startDate && i.endDate) {
                    const start = new Date(i.startDate);
                    const end = new Date(i.endDate);
                    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                        const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                        if (diff > 0) {
                            totalDays += diff;
                            durationCount++;
                        }
                    }
                }
            });

            // Build genre bars
            let gArr = Object.entries(gCounts).map(([label, value], i) => ({
                label, value, color: colors[i % colors.length], perc: 0
            })).sort((a, b) => b.value - a.value);
            const gTotal = gArr.reduce((s, x) => s + x.value, 0) || 1;
            gArr.forEach(x => { x.perc = (x.value / gTotal) * 100; });
            genresData = gArr;

            // Build rating bars
            let rArr = Object.entries(rCounts)
                .sort((a, b) => getRatingValue(b[0]) - getRatingValue(a[0]))
                .map(([rating, value], i) => ({ label: `${rating} ⭐`, value, color: colors[i % colors.length], perc: 0 }));
            const rTotal = rArr.reduce((s, x) => s + x.value, 0) || 1;
            rArr.forEach(x => { x.perc = (x.value / rTotal) * 100; });
            ratingsData = rArr;

            // Build monthly bars
            const months = lang === 'ru' ? MONTH_NAMES_RU : MONTH_NAMES;
            const maxM = Math.max(...mCounts, 1);
            monthlyData = mCounts.map((value, idx) => ({
                month: idx,
                label: months[idx],
                value,
                perc: (value / maxM) * 100,
                isCurrent: idx === currentMonth
            }));

            // Average days
            avgDays = durationCount > 0 ? Math.round(totalDays / durationCount) : null;

        } catch (e) {
            console.error("Error calculating stats:", e);
        }
    }

    $: recalculateStats(items);
    $: void recalculateDailyActivity(items);

    async function recalculateDailyActivity(data: MediaItem[]): Promise<void> {
        const version = ++activityVersion;
        const unitsByCollectionDate = new Map<string, number>();
        await Promise.all(data.map(async item => {
            const collection = collections.find(value => value.id === item.collectionId);
            if (!collection) return;
            const unit = collectionDailyGoalUnit(collection);
            if (unit === 'items') {
                const date = item.endDate?.slice(0, 10) || '';
                if (item.status === collection.finishedStatusName && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
                    const key = `${item.collectionId}\u0000${date}`;
                    unitsByCollectionDate.set(key, (unitsByCollectionDate.get(key) || 0) + 1);
                }
                return;
            }
            try {
                const content = await plugin.app.vault.cachedRead(item.file);
                content.split('\n').filter(line => line.trimStart().startsWith('|')).forEach(line => {
                    const columns = line.split('|');
                    const date = columns[1]?.trim() || '';
                    const progress = columns[3]?.trim().match(/^-?\d+(?:\.\d+)?/)?.[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && progress) {
                        const key = `${item.collectionId}\u0000${date}`;
                        unitsByCollectionDate.set(key, (unitsByCollectionDate.get(key) || 0) + Math.max(0, Number(progress)));
                    }
                });
            } catch {
                // A missing or temporarily unavailable media file should not break statistics.
            }
        }));
        if (version !== activityVersion) return;

        const today = new Date();
        const todayKey = toDateKey(today);
        const monthPrefix = todayKey.slice(0, 7);
        activeDaysThisMonth = new Set([...unitsByCollectionDate.entries()]
            .filter(([key, units]) => key.split('\u0000')[1]?.startsWith(monthPrefix) && units > 0)
            .map(([key]) => key.split('\u0000')[1])).size;

        const visibleCollections = collections.filter(collection =>
            collection.enabled
            && collectionDailyGoalEnabled(collection)
            && (collectionId === 'all' || collection.id === collectionId)
        );
        dailyActivities = visibleCollections.map(collection => {
            const goal = collectionDailyGoal(collection, plugin.settings.dailyPagesGoal);
            const value = unitsByCollectionDate.get(`${collection.id}\u0000${todayKey}`) || 0;
            let cursor = new Date(today);
            if (value < goal) cursor.setDate(cursor.getDate() - 1);
            let streak = 0;
            while ((unitsByCollectionDate.get(`${collection.id}\u0000${toDateKey(cursor)}`) || 0) >= goal) {
                streak++;
                cursor.setDate(cursor.getDate() - 1);
            }
            return {
                collectionId: collection.id,
                value,
                goal,
                percent: Math.min(100, value / goal * 100),
                streak,
                unit: dailyGoalUnitLabel(collectionDailyGoalUnit(collection), lang)
            };
        });
    }

    function toDateKey(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // ── Year goal ──────────────────────────────────────────────────────────────
    function saveGoal() {
        const val = Number(goalInputVal);
        if (!isNaN(val) && val > 0) {
            yearGoal = val;
            plugin.settings.libraryYearGoal = val;
            plugin.saveSettings();
        }
        editingGoal = false;
    }

    $: yearGoalPerc = yearGoal > 0 ? Math.min(100, (finishedThisYearCount / yearGoal) * 100) : 0;
</script>

<div class="library-stats-container">

    <!-- ── SUMMARY CARDS ─────────────────────────────────────────────────────── -->
    <div class="stats-summary-grid">
        <div class="stat-card">
            <div class="stat-value">{totalItems}</div>
            <div class="stat-label">{t(lang, 'lib_total_items') || 'Total in Library'}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{activeItemsCount}</div>
            <div class="stat-label">{t(lang, 'lib_in_progress') || 'In Progress'}</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{plannedItemsCount}</div>
            <div class="stat-label">{lang === 'ru' ? 'В планах' : 'Planned'}</div>
        </div>
        <div class="stat-card"><div class="stat-value">{finishedThisYearCount}</div><div class="stat-label">{lang === 'ru' ? `Завершено в ${currentYear}` : `Finished in ${currentYear}`}</div></div>
        {#if averageRating !== null}<div class="stat-card"><div class="stat-value">{averageRating.toFixed(1)}</div><div class="stat-label">{lang === 'ru' ? 'Средняя оценка' : 'Average rating'}</div></div>{/if}
        {#if avgDays !== null}
            <div class="stat-card stat-card-accent">
                <div class="stat-value">{avgDays}</div>
                <div class="stat-label">{lang === 'ru' ? 'Avg дней на ед.' : 'Avg days per item'}</div>
            </div>
        {/if}
    </div>

    <section class="daily-activity-block">
        <header><div><strong>{lang === 'ru' ? 'Цели на сегодня' : 'Today goals'}</strong><small>{activeDaysThisMonth} {lang === 'ru' ? 'активных дней в этом месяце' : 'active days this month'}</small></div></header>
        <div class="daily-goal-list">
            {#each dailyActivities as activity (activity.collectionId)}
                <div class="daily-goal-row">
                    <div><strong>{activity.collectionId}</strong><span>{activity.value} / {activity.goal} {activity.unit}</span><small>{activity.streak} {lang === 'ru' ? 'дн. серия' : 'day streak'}</small></div>
                    <div class="daily-goal-track"><span style:width={`${activity.percent}%`}></span></div>
                </div>
            {/each}
        </div>
    </section>

    <!-- ── YEAR GOAL ─────────────────────────────────────────────────────────── -->
    <div class="year-goal-block">
        <div class="year-goal-header">
            <span class="year-goal-title">
                🎯 {lang === 'ru' ? `Цель ${currentYear}` : `Goal ${currentYear}`}
            </span>
            {#if editingGoal}
                <div class="goal-edit-row">
                    <input
                        class="goal-input"
                        type="number"
                        min="1"
                        max="9999"
                        bind:value={goalInputVal}
                        on:keydown={(e) => e.key === 'Enter' && saveGoal()}
                    />
                    <button class="goal-save-btn" on:click={saveGoal}>✓</button>
                    <button class="goal-cancel-btn" on:click={() => editingGoal = false}>✕</button>
                </div>
            {:else}
                <span class="year-goal-count">
                    {finishedThisYearCount} / {yearGoal} ({Math.round(yearGoalPerc)}%)
                </span>
                <button class="goal-edit-icon" title="Edit goal" on:click={() => { goalInputVal = yearGoal; editingGoal = true; }}>✏️</button>
            {/if}
        </div>
        <div class="year-goal-bar-track">
            <div
                class="year-goal-bar-fill"
                class:goal-complete={yearGoalPerc >= 100}
                style="width: {yearGoalPerc}%"
            ></div>
        </div>
        {#if yearGoalPerc >= 100}
            <div class="goal-done-badge">🏆 {lang === 'ru' ? 'Цель выполнена!' : 'Goal complete!'}</div>
        {/if}
    </div>

    <!-- ── MONTHLY CHART ──────────────────────────────────────────────────────── -->
    {#if finishedItemsCount > 0}
        <div class="chart-box">
            <div class="chart-title">
                📅 {lang === 'ru' ? `Завершено по месяцам (${currentYear})` : `Finished by month (${currentYear})`}
            </div>
            <div class="monthly-chart">
                {#each monthlyData as m}
                    <div class="month-col" class:current-month={m.isCurrent}>
                        <div class="month-bar-wrap">
                            <div
                                class="month-bar"
                                class:month-bar-current={m.isCurrent}
                                style="height: {Math.max(m.perc, m.value > 0 ? 8 : 0)}%;"
                                title="{m.label}: {m.value}"
                            ></div>
                        </div>
                        {#if m.value > 0}
                            <div class="month-val">{m.value}</div>
                        {:else}
                            <div class="month-val month-val-empty">—</div>
                        {/if}
                        <div class="month-label">{m.label}</div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- ── GENRE & RATING BARS ───────────────────────────────────────────────── -->
    <div class="stats-charts-grid">
        {#if genresData.length > 0}
            <div class="chart-box">
                <div class="chart-title">🏷️ {t(lang, 'lib_genres_finished') || 'Genres (Finished)'}</div>
                <div class="html-bars-container">
                    {#each genresData as item}
                        <div class="bar-row">
                            <div class="bar-label" title={item.label}>{item.label}</div>
                            <div class="bar-track">
                                <div class="bar-fill" style="width: {item.perc}%; background-color: {item.color};"></div>
                            </div>
                            <div class="bar-value">{item.value}</div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        {#if ratingsData.length > 0}
            <div class="chart-box">
                <div class="chart-title">⭐ {t(lang, 'lib_ratings_finished') || 'Ratings (Finished)'}</div>
                <div class="html-bars-container">
                    {#each ratingsData as item}
                        <div class="bar-row">
                            <div class="bar-label">{item.label}</div>
                            <div class="bar-track">
                                <div class="bar-fill" style="width: {item.perc}%; background-color: {item.color};"></div>
                            </div>
                            <div class="bar-value">{item.value}</div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>

    {#if finishedItemsCount === 0}
        <div class="stats-empty">{lang === 'ru' ? 'Нет завершённых элементов. Завершите что-нибудь, чтобы увидеть статистику!' : 'No finished items yet. Complete something to see stats!'}</div>
    {/if}
</div>

<style>
    .library-stats-container {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 24px;
    }

    /* ── SUMMARY CARDS ── */
    .stats-summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 16px;
    }
    .stat-card {
        padding: 20px;
        text-align: center;
        border-radius: 8px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        transition: border-color 0.2s;
    }
    .stat-card:hover { border-color: var(--interactive-accent); }
    .stat-card-accent { border-color: rgba(var(--color-accent-rgb), 0.4); }
    .stat-value {
        font-size: 2.5em;
        font-weight: 800;
        color: var(--text-accent);
        margin-bottom: 5px;
        line-height: 1;
    }
    .stat-label {
        font-size: 0.8em;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.8px;
    }

    .daily-activity-block {
        display:flex;
        flex-direction:column;
        gap:12px;
        padding: 16px 18px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-secondary);
    }
    .daily-activity-block > header div { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
    .daily-activity-block > header strong { font-size:.9rem; }.daily-activity-block > header small { color:var(--text-muted); }
    .daily-goal-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:8px; }
    .daily-goal-row { display:flex; flex-direction:column; gap:7px; padding:9px 10px; border:1px solid var(--background-modifier-border); border-radius:6px; background:var(--background-primary); }
    .daily-goal-row > div:first-child { display:grid; grid-template-columns:1fr auto; gap:2px 8px; align-items:baseline; }.daily-goal-row strong { text-transform:capitalize; }.daily-goal-row span { color:var(--text-normal); font-size:.78rem; }.daily-goal-row small { grid-column:1/-1; color:var(--text-muted); font-size:.68rem; }
    .daily-goal-track { height: 5px; overflow: hidden; border-radius: 3px; background: var(--background-modifier-form-field); }
    .daily-goal-track span { display: block; height: 100%; background: var(--color-green); }

    /* ── YEAR GOAL ── */
    .year-goal-block {
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        padding: 18px 20px;
    }
    .year-goal-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        flex-wrap: wrap;
    }
    .year-goal-title {
        font-weight: 700;
        font-size: 1.05em;
        color: var(--text-normal);
        flex: 1;
    }
    .year-goal-count {
        color: var(--text-muted);
        font-size: 0.95em;
        font-weight: 600;
    }
    .goal-edit-icon {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 0.9em;
        opacity: 0.5;
        padding: 2px 4px;
        border-radius: 4px;
        transition: opacity 0.2s;
    }
    .goal-edit-icon:hover { opacity: 1; }
    .goal-edit-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .goal-input {
        width: 70px;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid var(--interactive-accent);
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: 0.9em;
    }
    .goal-save-btn, .goal-cancel-btn {
        padding: 4px 8px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 0.85em;
    }
    .goal-save-btn { background: var(--interactive-accent); color: var(--text-on-accent); }
    .goal-cancel-btn { background: var(--background-modifier-form-field); color: var(--text-muted); }
    .year-goal-bar-track {
        height: 12px;
        background: var(--background-modifier-form-field);
        border-radius: 6px;
        overflow: hidden;
    }
    .year-goal-bar-fill {
        height: 100%;
        background: var(--interactive-accent);
        border-radius: 6px;
        transition: width 0.6s ease-out;
    }
    .goal-complete { background: #4ade80; }
    .goal-done-badge {
        margin-top: 8px;
        text-align: center;
        font-size: 0.85em;
        color: #4ade80;
        font-weight: bold;
        letter-spacing: 0.5px;
    }

    /* ── MONTHLY CHART ── */
    .monthly-chart {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        height: 110px;
        padding-top: 8px;
    }
    .month-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
    }
    .month-bar-wrap {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: flex-end;
        justify-content: center;
    }
    .month-bar {
        width: 70%;
        min-height: 2px;
        background: rgba(var(--color-accent-rgb), 0.5);
        border-radius: 3px 3px 0 0;
        transition: height 0.4s ease-out, background 0.2s;
    }
    .month-bar-current { background: var(--interactive-accent); }
    .month-col.current-month .month-label { color: var(--interactive-accent); font-weight: bold; }
    .month-val {
        font-size: 0.65em;
        color: var(--text-normal);
        font-weight: bold;
        margin-top: 2px;
        height: 14px;
    }
    .month-val-empty { color: var(--text-faint); font-weight: normal; }
    .month-label {
        font-size: 0.6em;
        color: var(--text-muted);
        text-align: center;
        margin-top: 1px;
        white-space: nowrap;
    }

    /* ── CHART BOX ── */
    .chart-box {
        padding: 20px;
        border-radius: 8px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
    }
    .chart-title {
        margin-bottom: 16px;
        font-weight: 600;
        color: var(--text-normal);
        font-size: 1em;
    }
    .stats-charts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
    }

    /* ── BAR ROWS ── */
    .html-bars-container { display: flex; flex-direction: column; gap: 12px; }
    .bar-row { display: flex; align-items: center; gap: 10px; }
    .bar-label {
        flex: 0 0 100px;
        font-size: 0.82em;
        color: var(--text-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
    }
    .bar-track {
        flex: 1;
        height: 10px;
        background: var(--background-modifier-form-field);
        border-radius: 5px;
        overflow: hidden;
    }
    .bar-fill {
        height: 100%;
        border-radius: 5px;
        transition: width 0.5s ease-out;
    }
    .bar-value {
        flex: 0 0 28px;
        text-align: right;
        font-size: 0.85em;
        font-weight: bold;
        color: var(--text-normal);
    }

    /* ── EMPTY ── */
    .stats-empty {
        text-align: center;
        padding: 40px;
        color: var(--text-muted);
        font-style: italic;
    }
    @media (max-width: 620px) {
        .library-stats-container { padding: 8px; }
        .daily-activity-block > header div { align-items:flex-start; flex-direction:column; }
    }
</style>
